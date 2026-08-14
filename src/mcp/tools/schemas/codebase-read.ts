import { z } from "zod";
import { normalizeRepo } from "../../utils/normalize";

/**
 * Unified schema for codebase-read (TRACE / SEARCH / FILE / ARCHITECTURE / CODE).
 *
 * Auto-infer rules (checked in order — only ONE of the mutual-exclusive params):
 * - `name`     → TRACE (was trace_symbol)
 * - `filePath` → FILE (was get_file_symbols)
 * - `content`  → CODE (TASK-316 — grep file contents, symbol-enriched)
 * - `query`    → SEARCH (unified: was search_symbols + codebase_search)
 * - none       → ARCHITECTURE (was get_architecture — tree overview)
 *
 * Per ADR-005: "Zero oneOf — auto-infer dari parameter mana yang diisi"
 */
export const CodebaseReadSchema = z.object({
	// ── Mutual-exclusive params — agent fills exactly 1 ──────────────────
	/** Symbol name to trace. Presence triggers TRACE mode. */
	name: z.string().optional(),
	/** Relative file path to get symbols for. Presence triggers FILE mode. */
	filePath: z.string().optional(),
	/**
	 * Search query — code-like term or natural language. Presence triggers
	 * SEARCH mode (symbol names / signatures).
	 *
	 * Supports inline key:value tags (e.g. `kind:function language:php`) which
	 * are auto-extracted into filters.
	 */
	query: z
		.string()
		.optional()
		.describe(
			"Search query for symbols. Supports inline key:value tags (e.g. kind:function language:php file:src/foo.ts) which are auto-extracted into filters."
		),
	/**
	 * Content to grep for in indexed file CONTENTS. Presence triggers CODE
	 * mode (TASK-316): substring (case-insensitive) or regex match against
	 * every file in the codebase_files index, enriched with the enclosing
	 * symbol definition. Requires `repo` + `repoPath`.
	 */
	content: z.string().optional(),

	// ── Optional filters ──────────────────────────────────────────────────
	/** Filter by symbol kind(s) — single string or array. */
	kind: z.union([z.string(), z.array(z.string())]).optional(),
	/** Only exported symbols. */
	exportedOnly: z.boolean().optional(),
	/** Tree depth limit for ARCHITECTURE mode (1–5, default 2). */
	depth: z.coerce.number().min(1).max(5).optional(),
	/** Include usage references in TRACE output. */
	includeReferences: z.coerce.boolean().default(true),
	/** Include symbol counts in ARCHITECTURE tree. */
	includeSymbolCounts: z.coerce.boolean().default(true),
	/** CODE mode: treat `content` as a regular expression (default: substring). */
	regex: z.boolean().default(false),
	/** CODE mode: only grep files with this `codebase_files.language`. */
	language: z.string().optional(),
	/**
	 * Absolute path of the repo root on disk. Required for CODE mode (grep
	 * file contents); OPTIONAL for ARCHITECTURE mode, where it enables the
	 * dead-code entry-point exclusion (package.json bin/main/exports + shebang
	 * scan — absent ⇒ public-API-anchor exclusion only, noted in coverageNote).
	 * The index stores no repo→path registry — the caller supplies it, exactly
	 * as index_repository does. CODE mode absent ⇒ REPO_PATH_REQUIRED error
	 * envelope; ARCHITECTURE absent ⇒ graceful degradation.
	 */
	repoPath: z.string().min(1).optional(),

	// ── Common ─────────────────────────────────────────────────────────────
	owner: z.string().optional().default(""),
	/**
	 * Single-repo scope. Backward compatible — a single value is validated and
	 * normalized exactly as before. Now optional so SEARCH can be scoped with
	 * `repos` alone; the handler enforces "repo or repos required".
	 */
	repo: z.string().min(1).transform(normalizeRepo).optional(),
	/**
	 * Cross-repo scope for SEARCH — each value is normalized like `repo`.
	 * When provided (with or without `repo`), results are restricted to these
	 * repos. Documented limitation: `codebase_symbols` has no owner column, so
	 * scanning is tenant-unscoped at the DB level. When BOTH `repo` and `repos`
	 * are absent, SEARCH mode rejects to prevent cross-tenant leaks.
	 *
	 * Capped at 50 entries — an unbounded IN clause would exceed SQLite variable
	 * limits and allow a single oversized request to blow up the query (DoS).
	 */
	repos: z.array(z.string().min(1).transform(normalizeRepo)).max(50).nonempty().optional(),

	// ── Pagination ─────────────────────────────────────────────────────────
	/**
	 * Max results. No schema-level default (TASK-316): each mode applies its
	 * own — SEARCH `CODEBASE_SEARCH_DEFAULT_LIMIT` (50, the historical schema
	 * default) and CODE `CODE_SEARCH_DEFAULT_LIMIT` (10). Max 200.
	 */
	limit: z.coerce.number().min(1).max(200).optional(),
	/** Pagination offset. */
	offset: z.coerce.number().min(0).default(0),

	// ── Output ─────────────────────────────────────────────────────────────
	/** Return raw JSON without Markdown wrapping. */
	json: z.boolean().default(false)
});

export type CodebaseReadInput = z.infer<typeof CodebaseReadSchema>;
export type CodebaseReadMode = "trace" | "search" | "file" | "architecture" | "code";
