import fs from "node:fs";
import path from "node:path";
import { IndexRepoSchema, IndexStatusSchema, GetArchitectureSchema, GetFileSymbolsSchema } from "./schemas";
import { SQLiteStore } from "../storage/sqlite";
import { VectorStore } from "../types";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";
import { createCodebaseIndexService } from "../codebase-index/services/indexing-service";
import { buildArchitecture } from "../codebase-index/services/architecture-service";
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
			{ includeSerializedStructuredContent: true }
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
			{ includeSerializedStructuredContent: true }
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

		return createMcpResponse(
			result,
			`Indexed ${result.totalSymbols} symbols across ${result.totalFiles} files in ${result.durationMs}ms`,
			{ includeSerializedStructuredContent: true }
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.error("[handleCodebaseIndexRepository] Index failed", { repo, error: message });
		return createMcpResponse(
			{ success: false, error: "INDEX_FAILED", message },
			`Index failed for ${repo}: ${message}`,
			{ includeSerializedStructuredContent: true }
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

	const service = createCodebaseIndexService(db, getParserPool());
	const status = await service.getIndexStatus(repo);

	return createMcpResponse(status, `Status for ${repo}: ${status.totalFiles} files, ${status.totalSymbols} symbols`, {
		includeSerializedStructuredContent: true
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

	return createMcpResponse(
		result,
		`Architecture: ${result.summary.totalFiles} files, ${result.summary.totalSymbols} symbols across ${Object.keys(result.summary.languageBreakdown).length} languages`,
		{ includeSerializedStructuredContent: true }
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
			{ includeSerializedStructuredContent: true }
		);
	}

	const symbols = db.codebaseSymbols.getSymbolsByFile(repo, filePath);

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
		{ includeSerializedStructuredContent: true }
	);
}
