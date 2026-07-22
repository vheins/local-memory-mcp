import fs from "node:fs";
import path from "node:path";
import { IndexRepoSchema, IndexStatusSchema } from "./schemas";
import { SQLiteStore } from "../storage/sqlite";
import { VectorStore } from "../types";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";
import { createCodebaseIndexService } from "../codebase-index/services/indexing-service";
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
	} catch (err) {
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
