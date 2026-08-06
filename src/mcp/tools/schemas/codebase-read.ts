import { z } from "zod";
import { normalizeRepo } from "../../utils/normalize";

/**
 * Unified schema for codebase-read (TRACE / SEARCH / FILE / ARCHITECTURE).
 *
 * Auto-infer rules (checked in order — only ONE of the 3 mutual-exclusive params):
 * - `name` → TRACE (was trace_symbol)
 * - `filePath` → FILE (was get_file_symbols)
 * - `query` → SEARCH (unified: was search_symbols + codebase_search)
 * - none   → ARCHITECTURE (was get_architecture — tree overview)
 *
 * Per ADR-005: "Zero oneOf — auto-infer dari parameter mana yang diisi"
 */
export const CodebaseReadSchema = z.object({
	// ── 3 mutual-exclusive params — agent fills exactly 1 ─────────────────
	/** Symbol name to trace. Presence triggers TRACE mode. */
	name: z.string().optional(),
	/** Relative file path to get symbols for. Presence triggers FILE mode. */
	filePath: z.string().optional(),
	/** Search query — code-like term or natural language. Presence triggers SEARCH mode. */
	query: z.string().optional(),

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
	/** Max results (default 50, max 200). */
	limit: z.coerce.number().min(1).max(200).default(50),
	/** Pagination offset. */
	offset: z.coerce.number().min(0).default(0),

	// ── Output ─────────────────────────────────────────────────────────────
	/** Return raw JSON without Markdown wrapping. */
	json: z.boolean().default(false)
});

export type CodebaseReadInput = z.infer<typeof CodebaseReadSchema>;
export type CodebaseReadMode = "trace" | "search" | "file" | "architecture";
