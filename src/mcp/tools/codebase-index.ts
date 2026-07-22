import fs from "node:fs";
import path from "node:path";
import {
	IndexRepoSchema,
	IndexStatusSchema,
	GetArchitectureSchema,
	GetFileSymbolsSchema,
	SearchSymbolsSchema,
	TraceSymbolSchema
} from "./schemas";
import { SQLiteStore } from "../storage/sqlite";
import { VectorStore } from "../types";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";
import { createCodebaseIndexService } from "../codebase-index/services/indexing-service";
import { buildArchitecture } from "../codebase-index/services/architecture-service";
import { rankSymbols, filterSymbols, type RankedSymbol } from "../codebase-index/services/symbol-ranking";
import { traceSymbol, AmbiguousSymbolError } from "../codebase-index/services/trace-service";
import type { CodebaseSymbol } from "../types/codebase-symbol";
import type { ParserPool } from "../codebase-index/parser/language-visitor";
import { TreeSitterParserPool } from "../codebase-index/parser/parser-pool";
import { logger } from "../utils/logger";

// ── Parser pool singleton ───────────────────────────────────────────────

let parserPool: ParserPool | null = null;

function getParserPool(): ParserPool {
	if (!parserPool) {
		parserPool = new TreeSitterParserPool();
	}
	return parserPool;
}

// ── Handlers ────────────────────────────────────────────────────────────

export async function handleCodebaseIndexRepository(
	params: Record<string, unknown>,
	db: SQLiteStore,
	_vectors: VectorStore
): Promise<McpResponse> {
	const validated = IndexRepoSchema.parse(params);

	const repo = validated.repo.trim();
	const resolvedPath = path.resolve(validated.repoPath.trim());

	// Validate path exists and is a directory
	let stat: fs.Stats;
	try {
		stat = fs.statSync(resolvedPath);
	} catch {
		return createMcpResponse(
			{ success: false, error: "PATH_NOT_FOUND", message: `Repository path not found: ${resolvedPath}` },
			`Repository path not found: ${resolvedPath}`,
			{ includeJson: true }
		);
	}

	if (!stat.isDirectory()) {
		return createMcpResponse(
			{
				success: false,
				error: "NOT_A_DIRECTORY",
				message: `Repository path is not a directory: ${resolvedPath}`
			},
			`Repository path is not a directory: ${resolvedPath}`,
			{ includeJson: true }
		);
	}

	const pool = getParserPool();
	const service = createCodebaseIndexService(db, pool);

	try {
		const result = await service.indexRepository(repo, resolvedPath, {
			force: validated.force,
			includeGlobs: validated.includeGlobs,
			excludeGlobs: validated.excludeGlobs
		});

		const errorLines =
			result.errors.length > 0
				? `\nErrors:\n${result.errors.map((err) => `- ${err.filePath}: ${err.error}`).join("\n")}`
				: "";
		const contentSummary = `Indexed ${repo}: ${result.totalSymbols} symbols across ${result.totalFiles} files in ${result.durationMs}ms\nParsed: ${result.parsedFiles} | Skipped: ${result.skippedFiles} | Errors: ${result.failedFiles}${errorLines}`;

		return createMcpResponse(
			result,
			`Indexed ${result.totalSymbols} symbols across ${result.totalFiles} files in ${result.durationMs}ms`,
			{ includeJson: true, contentSummary }
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.error("[handleCodebaseIndexRepository] Index failed", { repo, error: message });
		return createMcpResponse(
			{ success: false, error: "INDEX_FAILED", message },
			`Index failed for ${repo}: ${message}`,
			{ includeJson: true }
		);
	}
}

export async function handleCodebaseIndexStatus(
	params: Record<string, unknown>,
	db: SQLiteStore,
	_vectors: VectorStore
): Promise<McpResponse> {
	const validated = IndexStatusSchema.parse(params);
	const repo = validated.repo.trim();
	const repoPath = validated.repoPath?.trim();

	const service = createCodebaseIndexService(db, getParserPool());
	const status = await service.getIndexStatus(repo, repoPath);

	let summary = `Status for ${repo}: ${status.totalFiles} files, ${status.totalSymbols} symbols`;
	if (status.lastIndexedAt) summary += ` (last indexed: ${status.lastIndexedAt})`;
	if (status.stale !== undefined) {
		summary += status.stale
			? ` — INDEX STALE (${Math.round((status.staleRatio ?? 0) * 100)}% of files changed)`
			: " — up to date";
	}

	return createMcpResponse(status, summary, {
		includeJson: true
	});
}

export async function handleGetArchitecture(
	params: Record<string, unknown>,
	db: SQLiteStore,
	_vectors: VectorStore
): Promise<McpResponse> {
	const validated = GetArchitectureSchema.parse(params);
	const repo = validated.repo.trim();

	const files = db.codebaseFiles.getFilesByRepo(repo);
	const symbols = validated.includeSymbolCounts ? db.codebaseSymbols.getSymbolsByRepo(repo) : [];

	const result = buildArchitecture(files, symbols, validated.depth);

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
		result,
		`Architecture: ${result.summary.totalFiles} files, ${result.summary.totalSymbols} symbols across ${Object.keys(result.summary.languageBreakdown).length} languages`,
		{ includeJson: true, contentSummary: archSummary }
	);
}

export async function handleGetFileSymbols(
	params: Record<string, unknown>,
	db: SQLiteStore,
	_vectors: VectorStore
): Promise<McpResponse> {
	const validated = GetFileSymbolsSchema.parse(params);
	const repo = validated.repo.trim();
	const filePath = validated.filePath.trim();

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
			? `\n\n| kind | line | name | exported |\n|------|------|------|----------|\n${symbols
					.slice(0, 30)
					.map((s) => `| ${s.kind} | ${s.start_line ?? "-"} | ${s.name} | ${s.exported ? "yes" : "no"} |`)
					.join("\n")}`
			: "";

	const contentSummary = `Found ${symbols.length} symbols in ${filePath}${symTable}${symbols.length > 30 ? `\n... and ${symbols.length - 30} more` : ""}`;

	return createMcpResponse(
		{
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

export async function handleTraceSymbol(
	params: Record<string, unknown>,
	db: SQLiteStore,
	_vectors: VectorStore
): Promise<McpResponse> {
	const validated = TraceSymbolSchema.parse(params);

	const name = validated.name.trim();
	const repo = validated.repo?.trim();

	// Fetch symbols scoped to repo if provided, otherwise global
	const allSymbols: CodebaseSymbol[] = repo
		? db.codebaseSymbols.getSymbolsByRepo(repo)
		: db.codebaseSymbols.getAllSymbols();

	// If repo filter yielded nothing, try without filter
	const symbols = allSymbols.length > 0 ? allSymbols : [];

	try {
		const result = traceSymbol(name, repo, symbols, validated.includeReferences);

		const refTable =
			result.references.length > 0
				? `\n\n### References (${result.references.length})\n\n| file | line |\n|------|------|\n${result.references
						.slice(0, 20)
						.map((r) => `| ${r.filePath} | ${r.startLine} |`)
						.join("\n")}${result.references.length > 20 ? `\n... and ${result.references.length - 20} more` : ""}`
				: "";

		const contentSummary = `Symbol "${name}"\nDefined: ${result.definition.file}:${result.definition.line}${refTable}`;

		return createMcpResponse(
			result,
			`Symbol "${name}": defined in ${result.definition.file}:${result.definition.line}, ` +
				`${result.references.length} references found`,
			{ includeJson: true, contentSummary }
		);
	} catch (err) {
		if (err instanceof Error && err.name === "SymbolNotFoundError") {
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
		logger.error("[handleTraceSymbol] Unexpected error", { name, repo, error: message });
		return createMcpResponse({ error: message, code: "TRACE_FAILED" }, message, {
			includeJson: true
		});
	}
}

export async function handleSearchSymbols(
	params: Record<string, unknown>,
	db: SQLiteStore,
	_vectors: VectorStore
): Promise<McpResponse> {
	const validated = SearchSymbolsSchema.parse(params);

	// Require at least 2 characters for a meaningful search
	const query = (validated.query ?? "").trim();
	if (query.length === 0 || query.length < 2) {
		return createMcpResponse(
			{ symbols: [], total: 0, hasMore: false },
			query.length === 0
				? "Empty query — provide at least 2 characters to search"
				: "Search query too short (minimum 2 characters)",
			{ includeJson: true }
		);
	}

	// Query all matching symbols from DB (handles LIKE + FTS5 internally)
	// Fetch up to 200 for ranking; we paginate after ranking
	const dbResult = db.codebaseSymbols.searchSymbols({
		query,
		repo: validated.repo,
		kind: validated.kind,
		filePath: validated.filePath,
		exportedOnly: validated.exportedOnly,
		limit: 200,
		offset: 0
	});

	let symbols: CodebaseSymbol[] = dbResult.symbols;

	// Apply in-memory filters (kind, filePath, exportedOnly) — complementing DB-level ones
	symbols = filterSymbols(symbols, {
		kind: validated.kind ? [validated.kind] : undefined,
		repo: validated.repo,
		filePath: validated.filePath,
		exportedOnly: validated.exportedOnly
	});

	// Rank results using SymbolRankingService
	const ranked: RankedSymbol[] = rankSymbols(symbols, query);

	// Apply pagination (offset + limit) after ranking
	const paginated = ranked.slice(validated.offset, validated.offset + validated.limit);

	const results = paginated.map((r) => ({
		...r.symbol,
		rankTier: r.rankTier,
		score: r.score
	}));

	const total = ranked.length;

	const summary =
		`| kind | file | score | symbol |\n` +
		`|------|------|-------|--------|\n` +
		results.map((s) => `| ${s.kind} | ${s.file_path} | ${s.score?.toFixed(2) || "-"} | ${s.name} |`).join("\n");

	return createMcpResponse(
		{
			symbols: results,
			total,
			hasMore: validated.offset + validated.limit < total,
			offset: validated.offset,
			limit: validated.limit
		},
		`Found ${total} matching symbols${query ? ` for "${query}"` : ""} (showing ${results.length}).`,
		{ includeJson: true, contentSummary: summary }
	);
}
