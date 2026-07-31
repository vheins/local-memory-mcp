import { toJSONSchema, type z } from "zod";

/**
 * Single-source-of-truth tool input contracts (TASK-036).
 *
 * The MCP tool `inputSchema` (JSON Schema) is DERIVED from the Zod schemas in
 * `src/mcp/tools/schemas/*` — the Zod schema is the only place a tool's input
 * contract is declared. Hand-editing the `inputSchema` inside `definitions/*`
 * is forbidden; change the Zod schema instead, and the tool contract follows.
 *
 * ## Generation engine
 *
 * Uses Zod 4's native JSON Schema generator (`z.toJSONSchema`, exported as
 * `toJSONSchema`) with:
 *   - `io: "input"`     — emit the INPUT contract (what clients send). This
 *     resolves `.transform()` fields (e.g. `repo` with `normalizeRepo`) to
 *     their pre-transform string type.
 *   - `target: "draft-07"` — matches the MCP tool-schema conventions used
 *     throughout this repo (draft-07 keyword set).
 *   - `unrepresentable: "any"` — never throw on exotic schema shapes.
 *
 * Note: `zod-to-json-schema` v3.25.x was evaluated but REJECTED — it only
 * reads Zod 3-style `_def.typeName` internals (`zod/v3`), so it emits empty
 * schemas for Zod 4.x instances (`{ $schema }` only). Zod 4's built-in
 * `toJSONSchema` is the maintained successor.
 *
 * ## Normalization (documented, generic — not per-tool hacks)
 *
 * The raw generator output is post-processed so the emitted contract matches
 * the repo's existing MCP tool-schema conventions and — critically — preserves
 * the runtime validation semantics of the `@modelcontextprotocol/server` SDK
 * (tool args are validated against `inputSchema` via AJV BEFORE the handler /
 * `normalizeToolArguments` run):
 *
 *   1. Strip `$schema` — the SDK's default validator supports JSON Schema
 *      2020-12 only and throws on any other declared dialect.
 *   2. Drop `required` arrays (at any nesting level) whose members are all
 *      session-injectable fields (`owner`/`repo`). Those fields are
 *      auto-injected/healed from session/roots by `normalizeToolArguments`
 *      (including nested `scope.owner`/`scope.repo`), so marking them required
 *      would reject valid calls before injection. Pass `{ required }` to
 *      keep/force a root list (e.g. `codebase-index` requires `repo`).
 *   3. Drop `additionalProperties: false` on plain objects — absent means
 *      "allowed" in draft-07/AJV, preserving pass-through of legacy/unknown
 *      arguments (current behavior).
 *   4. Collapse open records (`z.record(z.string(), z.unknown())`) to
 *      `{ type: "object" }` — matches the repo convention for `metadata` etc.
 *   5. Drop `minLength: 1` only on fields named `owner`/`repo` (any level) —
 *      the empty-string session auto-heal (`!args.owner && session.owner`)
 *      would break if the SDK rejected `""` first. `minLength`/`minItems` on
 *      other fields are kept (they mirror the handler Zod validation).
 *   6. `type: "integer"` → `"number"` — repo convention; `z.coerce.number()
 *      .int()` still enforces integers at the handler.
 *   7. Drop `minimum`/`maximum` equal to ±`Number.MAX_SAFE_INTEGER` — artifacts
 *      of `z.number().int()`.
 *   8. Drop `pattern` when `format` is present — Zod's uuid regex artifact
 *      (the repo only ever used `format: "uuid"`).
 *
 * `description` fields (from `.describe()`) are kept — they are part of the
 * Zod contract and richer than the old handwritten copies.
 */

/** Fields that `normalizeToolArguments` injects/heals from the session when absent or empty. */
const SESSION_INJECTABLE = new Set(["owner", "repo"]);

/** Raw JSON Schema nodes produced by `toJSONSchema`. */
type JsonNode = unknown;

/**
 * Recursively apply the normalization rules above.
 *
 * @param node     current JSON Schema node
 * @param propName the property name this node is bound to (for rule 5)
 */
function normalizeNode(node: JsonNode, propName?: string): JsonNode {
	if (Array.isArray(node)) {
		return node.map((item) => normalizeNode(item));
	}
	if (node === null || typeof node !== "object") {
		return node;
	}

	const obj = node as Record<string, unknown>;
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(obj)) {
		if (key === "$schema") continue; // rule 1
		out[key] = normalizeNode(value, key);
	}

	const hasProperties = "properties" in out;
	const isRecord = !hasProperties && "propertyNames" in out;

	// Rule 2: session-injectable-only required arrays — any level
	const required = out.required;
	if (Array.isArray(required) && required.length > 0 && required.every((f) => SESSION_INJECTABLE.has(f as string))) {
		delete out.required;
	}

	// Rule 4: open records → { type: "object" }
	if (isRecord) {
		const recordValue = out.additionalProperties;
		const isOpen =
			recordValue === undefined ||
			recordValue === true ||
			(typeof recordValue === "object" && recordValue !== null && Object.keys(recordValue).length === 0);
		if (isOpen) {
			const rec: Record<string, unknown> = {};
			if (typeof out.type === "string") rec.type = out.type;
			return rec;
		}
		// Typed record (value schema known) — keep the value schema, drop the key schema
		delete out.propertyNames;
		return out;
	}

	// Rule 3: plain objects stay open to additional properties
	if (hasProperties && out.additionalProperties === false) {
		delete out.additionalProperties;
	}

	// Rule 5: empty-string session auto-heal only applies to owner/repo fields
	if (out.minLength === 1 && propName !== undefined && SESSION_INJECTABLE.has(propName)) {
		delete out.minLength;
	}

	// Rule 6: integer → number (repo convention)
	if (out.type === "integer") out.type = "number";

	// Rule 7: safe-integer bounds are artifacts of z.number().int()
	if (out.minimum === -Number.MAX_SAFE_INTEGER) delete out.minimum;
	if (out.maximum === Number.MAX_SAFE_INTEGER) delete out.maximum;

	// Rule 8: uuid regex pattern artifact
	if (typeof out.format === "string" && "pattern" in out) {
		delete out.pattern;
	}

	return out;
}

export interface InputSchemaOptions {
	/**
	 * Explicit root `required` array for the tool contract. When omitted, the
	 * derived `required` array is kept only if it contains a non
	 * session-injectable field (e.g. `objective`, `signals`), and dropped when
	 * it only lists `owner`/`repo` (any nesting level).
	 *
	 * Pass this for tools whose contract intentionally requires a
	 * session-injectable field anyway (e.g. `codebase-index`/`codebase-read`
	 * require `repo`).
	 */
	required?: readonly string[];
}

/**
 * Derive the MCP tool `inputSchema` (JSON Schema) from a Zod schema.
 *
 * The Zod schema in `schemas/*` is the single source of truth; the returned
 * JSON Schema is the derived, normalized contract. See the module header for
 * the exact generation + normalization rules.
 */
export function inputSchemaFromSchema(schema: z.ZodType, options?: InputSchemaOptions): Record<string, unknown> {
	const raw = toJSONSchema(schema, { io: "input", target: "draft-07", unrepresentable: "any" });
	const normalized = normalizeNode(raw) as Record<string, unknown>;

	// Root `required` may have been dropped by rule 2 — restore explicit contract
	if (options?.required) {
		normalized.required = [...options.required];
	}

	return normalized;
}
