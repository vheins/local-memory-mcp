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

import { CodebaseReadSchema, type CodebaseReadInput, type CodebaseReadMode } from "./schemas/codebase-read";
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
 * Apply SPEC-001 hybrid scoring to ranking results.
 *
 * Blends vector similarity (cosine) with the existing 5-tier text ranking score:
 *   final = (vector × 0.30) + (tier_score × 0.70)
 *
 * Within each rank tier, symbols are re-sorted by their blended score.
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

		// Re-score within each tier using SPEC-001 hybrid formula
		// final = (vector × 0.30) + (tier_score × 0.70)
		const result: RankedSymbol[] = [];
		for (const tier of [RankTier.Exact, RankTier.CamelCase, RankTier.Prefix, RankTier.Substring, RankTier.FTS5]) {
			const group = tierGroups.get(tier);
			if (!group || group.length === 0) continue;

			// Compute blended score, sort by it descending
			const withBlend = group.map((rs) => {
				const vecScore = vectorMap.get(rs.symbol.id) ?? 0;
				const blended = vecScore * 0.3 + rs.score * 0.7;
				return { ...rs, blended };
			});

			withBlend.sort((a, b) => b.blended - a.blended);

			// Write blended score back for output consistency
			for (const item of withBlend) {
				item.score = parseFloat(item.blended.toFixed(4));
				delete (item as Record<string, unknown>).blended;
			}

			result.push(...withBlend);
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
	if (params.query !== undefined) return "search";
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

	function tryTrace(traceName: string): McpResponse | null {
		try {
			const result = traceSymbol(traceName, repo, symbols, validated.includeReferences);

			const refTable =
				result.references.length > 0
					? `\n\n### References (${result.references.length})\n\n| file | start_line | end_line |\n|------|------------|----------|\n${result.references
							.slice(0, 20)
							.map((r) => `| ${r.filePath} | ${r.startLine} | ${r.endLine} |`)
							.join("\n")}${result.references.length > 20 ? `\n... and ${result.references.length - 20} more` : ""}`
					: "";

			const contentSummary = `Symbol "${traceName}"\nDefined: ${result.definition.file}:${result.definition.line}-${result.definition.endLine}${refTable}`;

			return createMcpResponse(
				{ ...result, mode: "trace", originalName: traceName !== name ? name : undefined },
				`Symbol "${traceName}": defined in ${result.definition.file}:${result.definition.line}, ` +
					`${result.references.length} references found`,
				{ includeJson: true, contentSummary }
			);
		} catch (err) {
			// Re-throw ambiguous errors — they should propagate, not fall through
			if (err instanceof AmbiguousSymbolError) throw err;
			return null;
		}
	}

	function camelCaseFromHyphens(s: string): string {
		return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
	}

	// Try exact name first, then fallback variants
	const nameVariants = [name];

	// Variant 1: hyphens → dots (e.g., memory-write → memory.write)
	if (name.includes("-")) {
		nameVariants.push(name.replace(/-/g, "."));
	}

	// Variant 2: hyphens → camelCase (e.g., memory-write → memoryWrite)
	if (name.includes("-")) {
		nameVariants.push(camelCaseFromHyphens(name));
	}

	// Variant 3: dots → hyphens (e.g., memory.write → memory-write)
	if (name.includes(".")) {
		nameVariants.push(name.replace(/\./g, "-"));
	}

	// Variant 4: underscores → hyphens
	if (name.includes("_")) {
		nameVariants.push(name.replace(/_/g, "-"));
	}

	// Deduplicate
	const seen = new Set<string>();
	const uniqueVariants: string[] = [];
	for (const v of nameVariants) {
		if (!seen.has(v)) {
			seen.add(v);
			uniqueVariants.push(v);
		}
	}

	try {
		for (const v of uniqueVariants) {
			const result = tryTrace(v);
			if (result) return result;
		}
	} catch (err) {
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

	// All variants failed — return SymbolNotFoundError for the original name
	return createMcpResponse(
		{ error: `Symbol "${name}" not found`, code: "SYMBOL_NOT_FOUND" },
		`Symbol "${name}" not found`,
		{ includeJson: true }
	);
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

	// Normalize kind: accept string or string[], use first if array
	const kindFilter: string | undefined = Array.isArray(validated.kind) ? validated.kind[0] : validated.kind;

	// Phase 1: DB-level name search (LIKE on symbol name + kind/filePath filtering)
	let dbResult = db.codebaseSymbols.searchSymbols({
		query,
		repo: validated.repo,
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
				kind: kindFilter,
				filePath: validated.filePath,
				exportedOnly: validated.exportedOnly,
				limit: 200,
				offset: 0
			});
			if (wordResult.symbols.length > 0) {
				dbResult = wordResult;
				symbols = filterSymbols(wordResult.symbols, {
					kind: inMemoryKind,
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
