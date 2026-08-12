import type { CodebaseReadInput } from "../schemas/codebase-read";
import { SQLiteStore } from "../../storage/sqlite";
import { VectorStore, type CodebaseSymbol } from "../../types";
import { createMcpResponse, type McpResponse } from "../../utils/mcp-response";
import { rankSymbols, filterSymbols, RankTier, type RankedSymbol } from "../../codebase-index/services/symbol-ranking";
import { blendVectorRanking } from "../../codebase-index/services/vector-ranking";
import { CODEBASE_SEARCH_DEFAULT_LIMIT } from "../../utils/constants";

// ── UNIFIED SEARCH ───────────────────────────────────────────────────────

/**
 * Build a grouped-by-file list of search results in token-efficient format.
 *
 * Format:
 *   ### Results: N symbols for "query" (showing M)
 *
 *   **file/path.ts**
 *   - `kind` name Lstart-Lend (score: 0.XX)
 */
function formatSearchResultsGrouped(
	results: Array<CodebaseSymbol & { rankTier: RankTier; score: number }>,
	total: number,
	query: string
): string {
	if (results.length === 0) return `### Results: 0 symbols for "${query}"`;

	let out = `### Results: ${total} symbols for "${query}" (showing ${results.length})\n`;

	// Group by file_path, preserving result order within each file
	const groups = new Map<string, Array<CodebaseSymbol & { rankTier: RankTier; score: number }>>();
	const groupOrder: string[] = [];
	for (const s of results) {
		if (!groups.has(s.file_path)) {
			groups.set(s.file_path, []);
			groupOrder.push(s.file_path);
		}
		groups.get(s.file_path)!.push(s);
	}

	for (const filePath of groupOrder) {
		const symbols = groups.get(filePath)!;
		out += `\n**${filePath}**\n`;
		for (const s of symbols) {
			const lineRange =
				s.start_line != null
					? s.end_line != null && s.end_line !== s.start_line
						? `L${s.start_line}-L${s.end_line}`
						: `L${s.start_line}`
					: "-";
			const scorePart = s.score != null ? ` (score: ${s.score.toFixed(2)})` : "";
			out += `- \`${s.kind}\` ${s.name} ${lineRange}${scorePart}\n`;
		}
	}

	return out;
}

/**
 * Unified search handler combining code-like 5-tier ranking with NL semantic search.
 *
 * Strategy:
 * 1. DB-level name search via getSymbolByName / LIKE
 * 2. If name search returns 0 AND query has spaces, try word-split content search
 * 3. Text ranking via SymbolRankingService (5 tiers: Exact → CamelCase → Prefix → Substring → FTS5)
 * 4. Vector similarity tiebreaker within each rank tier (semantic blending)
 * 5. Apply filters (kind, exportedOnly) + pagination
 */
async function handleSearchMode(
	validated: CodebaseReadInput,
	db: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	const query = (validated.query ?? "").trim();
	if (query.length < 2) {
		return createMcpResponse(
			{ symbols: [], total: 0, hasMore: false, mode: "search" },
			"Search query too short (minimum 2 characters)",
			{ includeJson: true }
		);
	}

	// Normalize kind: accept string or string[], use first if array
	const kindFilter: string | undefined = Array.isArray(validated.kind) ? validated.kind[0] : validated.kind;

	// Cross-repo scope wins over single-repo scope. When `repos` is provided
	// (even alongside a session-injected `repo`), results are restricted to the
	// requested set and the single `repo` value is ignored.
	const repos = validated.repos && validated.repos.length > 0 ? validated.repos : undefined;
	const repo = repos && repos.length > 0 ? undefined : validated.repo;

	// Per-mode default limit (TASK-316): the schema no longer defaults `limit`
	// (was 50 for every mode), so SEARCH applies its historical default here —
	// behavior is unchanged for callers that omit it.
	const limit = validated.limit ?? CODEBASE_SEARCH_DEFAULT_LIMIT;

	// Phase 1: DB-level name search (LIKE on symbol name + kind/filePath filtering)
	const dbResult = db.codebaseSymbols.searchSymbols({
		query,
		repo,
		repos,
		kind: kindFilter,
		filePath: validated.filePath,
		exportedOnly: validated.exportedOnly,
		limit: 200,
		offset: 0
	});

	let symbols: CodebaseSymbol[] = dbResult.symbols;

	// Apply in-memory filters as complement — filterSymbols accepts string[]
	const inMemoryKind: string[] | undefined = Array.isArray(validated.kind)
		? validated.kind
		: validated.kind
			? [validated.kind]
			: undefined;

	symbols = filterSymbols(symbols, {
		kind: inMemoryKind,
		repo,
		repos,
		filePath: validated.filePath,
		exportedOnly: validated.exportedOnly
	});

	// Phase 2: If name search returned 0 results AND query has spaces, try word-split search
	if (symbols.length === 0 && query.includes(" ")) {
		const words = query.split(/\s+/).filter((w) => w.length >= 2);
		for (const word of words) {
			const wordResult = db.codebaseSymbols.searchSymbols({
				query: word,
				repo,
				repos,
				kind: kindFilter,
				filePath: validated.filePath,
				exportedOnly: validated.exportedOnly,
				limit: 200,
				offset: 0
			});
			if (wordResult.symbols.length > 0) {
				symbols = filterSymbols(wordResult.symbols, {
					kind: inMemoryKind,
					repo,
					repos,
					filePath: validated.filePath,
					exportedOnly: validated.exportedOnly
				});
				break;
			}
		}
	}

	// Phase 3: Text ranking via SymbolRankingService (5 tiers)
	let ranked: RankedSymbol[] = rankSymbols(symbols, query);

	// Phase 4: Vector similarity tiebreaker within each rank tier. For a
	// cross-repo search the vector stage is unscoped (`repo` empty) so vector
	// candidates aren't wrongly limited to the single repo; blendVectorRanking
	// degrades to text-only ranking when vector search is unavailable.
	ranked = await blendVectorRanking(ranked, query, repo ?? "", vectors);

	// Apply pagination
	const paginated = ranked.slice(validated.offset, validated.offset + limit);

	const results = paginated.map((r) => ({
		...r.symbol,
		rankTier: r.rankTier,
		score: r.score
	}));

	const total = ranked.length;

	const contentSummary = formatSearchResultsGrouped(results, total, query);

	return createMcpResponse(
		{
			symbols: results,
			total,
			hasMore: validated.offset + limit < total,
			offset: validated.offset,
			limit,
			query,
			mode: "search"
		},
		`Found ${total} matching symbols for "${query}" (showing ${results.length}).`,
		{ includeJson: true, contentSummary }
	);
}

export { handleSearchMode };
