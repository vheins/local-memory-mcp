import { ZodError, z } from "zod";
import type { McpResponse } from "./mcp-response";

/**
 * ── Canonical error envelope (OPT-CODE-01) ────────────────────────────────
 *
 * Single source of truth for turning a thrown failure into an MCP tool error
 * result. BOTH dispatch transports call this:
 *
 *   - the native SDK path (tools/index.ts registerTool catch block), and
 *   - the upstream router (router.ts handleToolCall catch block),
 *
 * so the same failure class surfaces an identical
 * `{ content: [{ type: "text", text }], isError: true }` envelope regardless
 * of transport. Previously the SDK returned an envelope while the router
 * logged-and-rethrew a raw exception, and per-tool code hand-built `isError`
 * results with different text — all three shapes are now collapsed here.
 *
 * The message keeps the legacy `Error: ` prefix (SDK behavior) and, for Zod
 * failures, the friendly owner/repo-aware text (task-read/handoff-list
 * behavior), so existing consumers that match on message substrings keep
 * working.
 */
export function toErrorResponse(err: unknown): McpResponse {
	return {
		content: [{ type: "text" as const, text: toErrorMessage(err) }],
		isError: true
	};
}

/**
 * Message derivation for {@link toErrorResponse}.
 *
 * - `ZodError` → friendly validation text via {@link formatZodError} (the raw
 *   Zod `.message` is a serialized JSON issue dump, useless to a caller).
 * - `Error`   → `err.message` (unchanged, preserves all domain messages like
 *   "Task not found: …" thrown by handlers).
 * - anything else → `String(err)` fallback.
 */
function toErrorMessage(err: unknown): string {
	if (err instanceof ZodError) {
		return `Error: ${formatZodError(err)}`;
	}
	if (err instanceof Error && err.message) {
		return `Error: ${err.message}`;
	}
	return `Error: ${String(err)}`;
}

/**
 * Centralized validation wrapper — replaces the per-tool
 * `schema.safeParse(args) -> custom message + manual isError` duplication
 * (task-read/index.ts, handoff.manage.ts) AND the raw `Schema.parse` throw
 * (memory.read.ts).
 *
 * On failure it throws an `Error` whose message is the SAME friendly text the
 * old per-tool code produced; the transport-level catch + {@link toErrorResponse}
 * then yields an identical envelope. Handlers keep the fail-loud throw
 * contract (OPT-CODE-04) — only the transport converts to an envelope.
 */
export function parseArgs<TSchema extends z.ZodTypeAny>(schema: TSchema, data: unknown): z.output<TSchema> {
	const parsed = schema.safeParse(data);
	if (!parsed.success) {
		throw new Error(formatZodError(parsed.error));
	}
	return parsed.data;
}

/**
 * Formats a Zod failure into the established friendly text. If any issue
 * touches the `owner`/`repo` path (auto-inference failure), the missing-fields
 * message — which was previously hand-built per tool — is produced, preserving
 * its exact wording for downstream consumers.
 */
export function formatZodError(error: ZodError): string {
	const missing = error.issues
		.filter((issue) => issue.path.some((p) => p === "owner" || p === "repo"))
		.map((issue) => issue.message)
		.filter((message): message is string => Boolean(message));
	if (missing.length > 0) {
		return `Missing required fields: ${missing.join("; ")}. Pass owner/repo explicitly or configure MCP workspace roots so they can be auto-inferred.`;
	}
	return `Validation error: ${error.message}`;
}
