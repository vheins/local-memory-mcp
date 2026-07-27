/**
 * codebase-read — unified read-only access to the codebase index.
 *
 * Replaces 5 individual read-only tools with auto-inferred modes.
 * Per ADR-005: "Zero oneOf — auto-infer dari parameter mana yang diisi"
 *
 * Modes (auto-inferred from mutual-exclusive params):
 *   name     → TRACE  (was trace_symbol)
 *   filePath → FILE   (was get_file_symbols)
 *   query    → SEARCH (unified: was search_symbols + codebase_search)
 *   nothing  → ARCHITECTURE (was get_architecture — tree overview)
 */

import { CodebaseReadSchema, type CodebaseReadInput, type CodebaseReadMode } from "./schemas/codebase.read";
import { SQLiteStore } from "../storage/sqlite";
import { VectorStore } from "../types";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";
import { buildArchitecture } from "../codebase-index/services/architecture-service";
import { rankSymbols, filterSymbols, RankTier, type RankedSymbol } from "../codebase-index/services/symbol-ranking";
import { traceSymbol, AmbiguousSymbolError, SymbolNotFoundError } from "../codebase-index/services/trace-service";
import type { CodebaseSymbol } from "../types/codebase-symbol";
import { logger } from "../utils/logger";

// ═══════════════════════════════════════════════════════════════════════════
// VECTOR BLENDING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Blend vector similarity scores into existing ranking as a tiebreaker.
 *
 * Within each rank tier, re-sorts by (existing score desc, vector similarity desc)
 * so semantically similar symbols rank higher within their tier.
 * Falls back gracefully if vector search fails or returns nothing.
 */
async function blendVectorRanking(
	ranked: RankedSymbol[],
	query: string,
	repo: string,
	vectors: VectorStore
): Promise<RankedSymbol[]> {
	if (ranked.length === 0) return ranked;

	try {
		const vectorResults = await vectors.search(query, ranked.length, repo, "codebase_symbol");
		if (vectorResults.length === 0) return ranked;

		// Build symbol_id → vector_score map
		const vectorMap = new Map<string, number>();
		for (const vr of vectorResults) {
			vectorMap.set(vr.id, vr.score);
		}

		// Group by rank tier, preserving tier order
		const tierGroups = new Map<RankTier, RankedSymbol[]>();
		for (const rs of ranked) {
			const group = tierGroups.get(rs.rankTier);
			if (group) {
				group.push(rs);
			} else {
				tierGroups.set(rs.rankTier, [rs]);
			}
		}

		// Re-sort within each tier using vector similarity as tiebreaker
		const result: RankedSymbol[] = [];
		for (const tier of [RankTier.Exact, RankTier.CamelCase, RankTier.Prefix, RankTier.Substring, RankTier.FTS5]) {
			const group = tierGroups.get(tier);
			if (!group || group.length === 0) continue;

			group.sort((a, b) => {
				if (b.score !== a.score) return b.score - a.score;
				const vecA = vectorMap.get(a.symbol.id) ?? 0;
				const vecB = vectorMap.get(b.symbol.id) ?? 0;
				return vecB - vecA;
			});

			result.push(...group);
		}

		return result;
	} catch (err) {
		logger.warn("[blendVectorRanking] Vector search failed, falling back to text-only ranking", {
			error: err instanceof Error ? err.message : String(err)
		});
		return ranked;
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// MODE INFERENCE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Determine which mode to run based on the provided parameters.
 *
 * ADR-005 auto-infer rules (first match wins):
 * 1. `name`     → TRACE
 * 2. `filePath` → FILE
 * 3. `query`    → SEARCH (unified — code-like→5-tier ranking, NL→semantic)
 * 4. (nothing)  → ARCHITECTURE (tree overview)
 */
function inferMode(params: CodebaseReadInput): CodebaseReadMode {
	if (params.name) return "trace";
	if (params.filePath) return "file";
	if (params.query) return "search";
	return "architecture";
}

// ═══════════════════════════════════════════════════════════════════════════
// MODE HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

// ── TRACE ────────────────────────────────────────────────────────────────

async function handleTraceMode(validated: CodebaseReadInput, db: SQLiteStore): Promise<McpResponse> {
	const name = validated.name!.trim();

	const repo = validated.repo?.trim();

	const allSymbols: CodebaseSymbol[] = repo
		? db.codebaseSymbols.getSymbolsByRepo(repo)
		: db.codebaseSymbols.getAllSymbols();

	const symbols = allSymbols.length > 0 ? allSymbols : [];

	try {
		const result = traceSymbol(name, repo, symbols, validated.includeReferences);

		const refTable =
			result.references.length > 0
				? `\n\n### References (${result.references.length})\n\n| file | start_line | end_line |\n|------|------------|----------|\n${result.references
						.slice(0, 20)
						.map((r) => `| ${r.filePath} | ${r.startLine} | ${r.endLine} |`)
						.join("\n")}${result.references.length > 20 ? `\n... and ${result.references.length - 20} more` : ""}`
				: "";

		const contentSummary = `Symbol "${name}"\nDefined: ${result.definition.file}:${result.definition.line}-${result.definition.endLine}${refTable}`;

		return createMcpResponse(
			{ ...result, mode: "trace" },
			`Symbol "${name}": defined in ${result.definition.file}:${result.definition.line}, ` +
				`${result.references.length} references found`,
			{ includeJson: true, contentSummary }
		);
	} catch (err) {
		if (err instanceof SymbolNotFoundError) {
			return createMcpResponse({ error: err.message, code: "SYMBOL_NOT_FOUND" }, err.message, {
				includeJson: true
			});
		}

		if (err instanceof AmbiguousSymbolError) {
			return createMcpResponse(
				{
					error: err.message,
					code: "AMBIGUOUS_SYMBOL",
					disambiguation: err.disambiguation.map((s) => ({
						name: s.name,
						kind: s.kind,
						file: s.file_path,
						line: s.start_line,
						exported: s.exported
					}))
				},
				err.message,
				{ includeJson: true }
			);
		}

		const message = err instanceof Error ? err.message : String(err);
		logger.error("[handleCodebaseRead:trace] Unexpected error", { name, repo, error: message });
		return createMcpResponse({ error: message, code: "TRACE_FAILED" }, message, {
			includeJson: true
		});
	}
}

// ── FILE SYMBOLS ─────────────────────────────────────────────────────────

async function handleFileMode(validated: CodebaseReadInput, db: SQLiteStore): Promise<McpResponse> {
	const repo = validated.repo.trim();
	const filePath = validated.filePath!.trim();

	const file = db.codebaseFiles.getFile(repo, filePath);
	if (!file) {
		return createMcpResponse(
			{ error: "File not indexed. Run index_repository first.", code: "FILE_NOT_INDEXED" },
			`File '${filePath}' not found in index`,
			{ includeJson: true }
		);
	}

	const symbols = db.codebaseSymbols.getSymbolsByFile(repo, filePath);

	const symTable =
		symbols.length > 0
			? `\n\n| kind | start_line | end_line | name | exported |\n|------|------------|----------|------|----------|\n${symbols
					.slice(0, 30)
					.map(
						(s) =>
							`| ${s.kind} | ${s.start_line ?? "-"} | ${s.end_line ?? "-"} | ${s.name} | ${s.exported ? "yes" : "no"} |`
					)
					.join("\n")}`
			: "";

	const contentSummary = `Found ${symbols.length} symbols in ${filePath}${symTable}${symbols.length > 30 ? `\n... and ${symbols.length - 30} more` : ""}`;

	return createMcpResponse(
		{
			mode: "file",
			file: {
				path: file.file_path,
				language: file.language,
				checksum: file.checksum,
				lines: file.lines,
				sizeBytes: file.size_bytes,
				lastIndexedAt: file.last_indexed_at
			},
			symbols,
			total: symbols.length
		},
		`Found ${symbols.length} symbols in ${filePath}`,
		{ includeJson: true, contentSummary }
	);
}

// ── ARCHITECTURE ─────────────────────────────────────────────────────────

async function handleArchitectureMode(validated: CodebaseReadInput, db: SQLiteStore): Promise<McpResponse> {
	const repo = validated.repo.trim();
	const depth = validated.depth ?? 2;

	const files = db.codebaseFiles.getFilesByRepo(repo);
	const symbols = validated.includeSymbolCounts ? db.codebaseSymbols.getSymbolsByRepo(repo) : [];

	const result = buildArchitecture(files, symbols, depth);

	const langEntries = Object.entries(result.summary.languageBreakdown);
	let archSummary = `Architecture: ${result.summary.totalFiles} files, ${result.summary.totalSymbols} symbols across ${langEntries.length} languages`;

	if (langEntries.length > 0) {
		archSummary += `\n\n### Languages\n\n| Language | Files |\n|----------|------|\n`;
		archSummary += langEntries.map(([lang, count]) => `| ${lang} | ${count} |`).join("\n");
	}

	const topExports = result.summary.topLevelExports;
	if (topExports && topExports.length > 0) {
		archSummary += `\n\n### Top Exports\n\n| name | kind | file |\n|------|------|------|\n`;
		archSummary += topExports
			.slice(0, 10)
			.map((s) => `| ${s.name} | ${s.kind} | ${s.file_path} |`)
			.join("\n");
		if (topExports.length > 10) archSummary += `\n... and ${topExports.length - 10} more`;
	}

	return createMcpResponse(
		{ ...result, mode: "architecture" },
		`Architecture: ${result.summary.totalFiles} files, ${result.summary.totalSymbols} symbols across ${Object.keys(result.summary.languageBreakdown).length} languages`,
		{ includeJson: true, contentSummary: archSummary }
	);
}

// ── UNIFIED SEARCH ───────────────────────────────────────────────────────

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

	// Phase 1: DB-level name search (LIKE on symbol name + kind/filePath filtering)
	let dbResult = db.codebaseSymbols.searchSymbols({
		query,
		repo: validated.repo,
		kind: validated.kind,
		filePath: validated.filePath,
		exportedOnly: validated.exportedOnly,
		limit: 200,
		offset: 0
	});

	let symbols: CodebaseSymbol[] = dbResult.symbols;

	// Apply in-memory filters as complement
	symbols = filterSymbols(symbols, {
		kind: validated.kind ? [validated.kind] : undefined,
		repo: validated.repo,
		filePath: validated.filePath,
		exportedOnly: validated.exportedOnly
	});

	// Phase 2: If name search returned 0 results AND query has spaces, try word-split search
	if (symbols.length === 0 && query.includes(" ")) {
		const words = query.split(/\s+/).filter((w) => w.length >= 2);
		for (const word of words) {
			const wordResult = db.codebaseSymbols.searchSymbols({
				query: word,
				repo: validated.repo,
				kind: validated.kind,
				filePath: validated.filePath,
				exportedOnly: validated.exportedOnly,
				limit: 200,
				offset: 0
			});
			if (wordResult.symbols.length > 0) {
				dbResult = wordResult;
				symbols = filterSymbols(wordResult.symbols, {
					kind: validated.kind ? [validated.kind] : undefined,
					repo: validated.repo,
					filePath: validated.filePath,
					exportedOnly: validated.exportedOnly
				});
				break;
			}
		}
	}

	// Phase 3: Text ranking via SymbolRankingService (5 tiers)
	let ranked: RankedSymbol[] = rankSymbols(symbols, query);

	// Phase 4: Vector similarity tiebreaker within each rank tier
	ranked = await blendVectorRanking(ranked, query, validated.repo, vectors);

	// Apply pagination
	const paginated = ranked.slice(validated.offset, validated.offset + validated.limit);

	const results = paginated.map((r) => ({
		...r.symbol,
		rankTier: r.rankTier,
		score: r.score
	}));

	const total = ranked.length;

	const summary =
		`| kind | file | start_line | end_line | score | symbol |\n` +
		`|------|------|------------|----------|-------|--------|\n` +
		results
			.map(
				(s) =>
					`| ${s.kind} | ${s.file_path} | ${s.start_line ?? "-"} | ${s.end_line ?? "-"} | ${s.score?.toFixed(2) || "-"} | ${s.name} |`
			)
			.join("\n");

	return createMcpResponse(
		{
			symbols: results,
			total,
			hasMore: validated.offset + validated.limit < total,
			offset: validated.offset,
			limit: validated.limit,
			query,
			mode: "search"
		},
		`Found ${total} matching symbols for "${query}" (showing ${results.length}).`,
		{ includeJson: true, contentSummary: summary }
	);
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Unified codebase-read handler.
 *
 * Auto-infers the mode from the provided parameters per ADR-005 rules:
 * - `name`     → TRACE (exact symbol match with disambiguation)
 * - `filePath` → FILE (symbols in a file)
 * - `query`    → SEARCH (unified: 5-tier ranking + semantic vector blending)
 * - (nothing)  → ARCHITECTURE (tree overview of the codebase)
 *
 * All old tool names route here for backward compatibility (REFACTOR-CI-003).
 */
export async function handleCodebaseRead(
	params: Record<string, unknown>,
	db: SQLiteStore,
	_vectors: VectorStore
): Promise<McpResponse> {
	const validated = CodebaseReadSchema.parse(params);
	const mode = inferMode(validated);

	logger.info("[Tool] codebase-read", {
		repo: validated.repo,
		mode
	});

	switch (mode) {
		case "trace":
			return handleTraceMode(validated, db);
		case "file":
			return handleFileMode(validated, db);
		case "search":
			return handleSearchMode(validated, db, _vectors);
		case "architecture":
			return handleArchitectureMode(validated, db);
	}
}
