/**
 * Shared auto-infer mode dispatch helpers (OPT-DRY-06).
 *
 * Every read tool used to hand-roll the same "infer mode from field presence"
 * chain — query → SEARCH, id/code/ids/codes → DETAIL, none → RECAP/LIST —
 * with subtly divergent semantics (truthy vs `!== undefined` presence checks:
 * e.g. standard-read's `if (query)` skipped `query: ""` while memory/task-read
 * treated it as a search). Every delete tool re-wrapped `resolveEntityRef` in
 * an identical `resolveIdentifier` closure whose `?? ""` sentinel diverged
 * (task.delete had to re-add a throw — TASK-123).
 *
 * This module centralizes BOTH inferences so all tools share one precedence
 * engine and one identifier collector. Per-tool mode IMPLEMENTATIONS stay in
 * the tools; only the inference and the identifier collection are shared.
 */

import { SQLiteStore } from "../storage/sqlite";
import { resolveEntityRef, type EntityRefKind } from "./entity-ref";

// ═══════════════════════════════════════════════════════════════════════════
// inferReadMode — auto-infer the read mode from param field presence
// ═══════════════════════════════════════════════════════════════════════════

export type FieldPresence = "defined" | "truthy";

export interface ReadModeRule<TMode extends string = string> {
	/** Mode selected when the rule matches. */
	mode: TMode;
	/** Discriminator fields — the rule matches when ANY field is present. */
	fields: readonly string[];
	/**
	 * Presence semantics:
	 * - `"defined"` — `value !== undefined` (canonical for query/identifier
	 *   fields; an explicit empty string still counts as present, e.g.
	 *   `query: ""` → SEARCH, matching the other read tools).
	 * - `"truthy"`  — `Boolean(value)` (canonical for boolean flags; a field
	 *   with a schema default like `claim: false` is never "present" after
	 *   parsing, so `"defined"` would always match).
	 * Defaults to `"defined"`.
	 */
	presence?: FieldPresence;
}

export interface ReadModeSpec<TMode extends string = string> {
	/** Ordered rules — first match wins (highest precedence first). */
	rules: readonly ReadModeRule<TMode>[];
	/** Mode returned when no rule matches. */
	fallback: TMode;
}

/**
 * Resolves which mode a read tool should run by checking discriminator field
 * presence against a declarative spec (first matching rule wins).
 *
 * @example
 * ```ts
 * const mode = inferReadMode(validated, {
 *   rules: [
 *     { mode: "search", fields: ["query"] },
 *     { mode: "detail", fields: ["id", "code", "ids", "codes"] }
 *   ],
 *   fallback: "recap"
 * });
 * ```
 */
export function inferReadMode<TMode extends string, T extends object>(params: T, spec: ReadModeSpec<TMode>): TMode {
	const record = params as Readonly<Record<string, unknown>>;
	for (const rule of spec.rules) {
		const matches = rule.fields.some((field) => {
			const value = record[field];
			return rule.presence === "truthy" ? Boolean(value) : value !== undefined;
		});
		if (matches) return rule.mode;
	}
	return spec.fallback;
}

// ═══════════════════════════════════════════════════════════════════════════
// collectEntityIds — resolve all entity identifiers in params to UUIDs
// ═══════════════════════════════════════════════════════════════════════════

export interface CollectEntityIdsOptions {
	/** Owner scope used for code → UUID lookups. */
	owner?: string;
	/** Repo scope used for code → UUID lookups. */
	repo?: string;
	/** In-memory code → id map checked before the DB lookup (batch self-references). */
	localMap?: Map<string, string>;
}

/** All identifier parameter keys, in canonical singular-then-bulk order. */
const IDENTIFIER_KEYS = ["id", "code", "task_code", "ids", "codes", "task_codes"] as const;

/**
 * Collects every identifier supplied in `params` (`id`, `code`, `task_code`,
 * `ids`, `codes`, `task_codes`) and resolves each to its entity UUID via
 * `resolveEntityRef`.
 *
 * Replaces the identical `resolveIdentifier` closures the three delete tools
 * used to hand-roll (memory.delete.ts, standard.delete.ts, task.delete.ts),
 * including the `?? ""` sentinel that diverged between them. Unresolvable
 * non-empty identifiers still throw from `resolveEntityRef` (the TASK-123
 * fail-loud behavior); empty strings are ignored as "not provided".
 *
 * Returns the resolved UUIDs in canonical declaration order
 * (singular identifiers first, then bulk arrays).
 */
export function collectEntityIds<T extends object>(
	params: T,
	kind: EntityRefKind,
	storage: SQLiteStore,
	opts?: CollectEntityIdsOptions
): string[] {
	const record = params as Readonly<Record<string, unknown>>;
	const ids: string[] = [];

	for (const key of IDENTIFIER_KEYS) {
		const value = record[key];
		if (typeof value === "string") {
			if (value.length > 0) {
				const resolved = resolveEntityRef(storage, kind, value, opts?.owner, opts?.repo, {
					localMap: opts?.localMap
				});
				if (resolved) ids.push(resolved);
			}
		} else if (Array.isArray(value)) {
			for (const item of value) {
				if (typeof item === "string" && item.length > 0) {
					const resolved = resolveEntityRef(storage, kind, item, opts?.owner, opts?.repo, {
						localMap: opts?.localMap
					});
					if (resolved) ids.push(resolved);
				}
			}
		}
	}

	return ids;
}
