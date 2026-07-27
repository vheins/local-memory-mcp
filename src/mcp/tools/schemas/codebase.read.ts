import { z } from "zod";
import { normalizeRepo } from "../../utils/normalize";

/**
 * Unified schema for codebase-read (STATUS / TRACE / FILE / ARCHITECTURE / SEARCH_SYMBOLS / NL_SEARCH).
 *
 * Auto-infer logic (checked in order):
 * - `action` param → explicit mode override
 * - `filePath` → FILE (was get_file_symbols)
 * - `depth` → ARCHITECTURE (was get_architecture)
 * - `query` with spaces → NL_SEARCH (was codebase_search)
 * - `query` single term → SEARCH_SYMBOLS (was search_symbols)
 * - `name` or `symbol` → TRACE (was trace_symbol)
 * - none → STATUS (was index_status)
 */
export const CodebaseReadSchema = z.object({
	// ── Mode override (optional — auto-inferred otherwise) ─────────────────
	action: z.enum(["status", "trace", "file", "architecture", "search_symbols", "nl_search"]).optional(),

	// ── Common ─────────────────────────────────────────────────────────────
	owner: z.string().optional().default(""),
	repo: z.string().min(1).transform(normalizeRepo),

	// ── TRACE params ──────────────────────────────────────────────────────
	/** Symbol name to trace. Alias: `symbol`. */
	name: z.string().optional(),
	/** Alias for `name`. */
	symbol: z.string().optional(),
	/** Include usage references in trace output. */
	includeReferences: z.coerce.boolean().default(true),

	// ── FILE SYMBOLS params ───────────────────────────────────────────────
	/** Relative file path to get symbols for. */
	filePath: z.string().optional(),

	// ── ARCHITECTURE params ───────────────────────────────────────────────
	/** Tree depth limit (1–5). */
	depth: z.coerce.number().min(1).max(5).optional(),
	/** Include symbol counts in architecture tree. */
	includeSymbolCounts: z.coerce.boolean().default(true),

	// ── SEARCH params (symbol + NL) ───────────────────────────────────────
	/** Search query — single term for symbol search, multi-word for NL search. */
	query: z.string().optional(),
	/** Filter by symbol kind. */
	kind: z.string().optional(),
	/** Only exported symbols. */
	exportedOnly: z.boolean().optional(),

	// ── Pagination ─────────────────────────────────────────────────────────
	/** Max results (default 50, max 200). */
	limit: z.coerce.number().min(1).max(200).default(50),
	/** Pagination offset. */
	offset: z.coerce.number().min(0).default(0),

	// ── STATUS params ─────────────────────────────────────────────────────
	/** Absolute path for staleness detection. */
	repoPath: z.string().optional(),

	// ── Output ─────────────────────────────────────────────────────────────
	/** Return raw JSON without Markdown wrapping. */
	json: z.boolean().default(false)
});

export type CodebaseReadInput = z.infer<typeof CodebaseReadSchema>;
export type CodebaseReadMode = NonNullable<CodebaseReadInput["action"]>;
