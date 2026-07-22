import express from "express";
import fs from "node:fs";
import path from "node:path";
import { db } from "../lib/context";
import {
	handleGetArchitecture,
	handleGetFileSymbols,
	handleSearchSymbols,
	handleTraceSymbol,
	handleCodebaseIndexStatus,
	handleCodebaseIndexRepository
} from "../../mcp/tools/codebase-index";
import { autoIndexIfStale } from "../../mcp/codebase-index/services/indexing-service";
import type { ParserPool } from "../../mcp/codebase-index/parser/language-visitor";
import { TreeSitterParserPool } from "../../mcp/codebase-index/parser/parser-pool";
import type { VectorStore } from "../../mcp/types";

// ── Parser pool singleton (lazy, shared across endpoints) ─────────────

let parserPool: ParserPool | null = null;

function getParserPool(): ParserPool {
	if (!parserPool) {
		parserPool = new TreeSitterParserPool();
	}
	return parserPool;
}

// ── No‑op vector store (codebase tools don't use vectors) ─────────────

const noopVectors: VectorStore = {
	async upsert(_id: string, _text: string, _kind?: "memory" | "standard") {},
	async remove(_id: string, _kind?: "memory" | "standard") {},
	async search(_query: string, _limit: number, _repo?: string, _kind?: "memory" | "standard") {
		return [];
	}
};

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Resolve the filesystem path for a repo when `repoPath` is not provided
 * by the UI. The dashboard doesn't know filesystem paths, so we attempt
 * to derive it from the environment:
 *   1. CODEBASE_REPOS_DIR env var (explicit base directory)
 *   2. The repo name as a relative directory (for repo-only names like "local-memory-mcp")
 *   3. The repo short-name (after "/") relative to CWD's parent
 */
function resolveRepoPath(repo: string, repoPath?: string): string | null {
	if (repoPath) return repoPath;

	const baseDir = process.env.CODEBASE_REPOS_DIR || path.resolve("..");
	const candidates: string[] = [];

	// Try the base directory directly (e.g., /home/user/Projects/local-memory-mcp)
	candidates.push(path.resolve(baseDir, repo));
	// Try as a subdirectory of the base (e.g., /home/user/Projects/owner/local-memory-mcp)
	const parts = repo.split("/");
	const shortName = parts[parts.length - 1];
	if (shortName !== repo) {
		candidates.push(path.resolve(baseDir, shortName));
	}
	// Try CWD itself (for the current project)
	candidates.push(path.resolve(repo));
	candidates.push(path.resolve(shortName));

	for (const candidate of candidates) {
		try {
			if (fs.statSync(candidate).isDirectory()) return candidate;
		} catch {
			// Not found at this path, continue
		}
	}
	return null;
}

function errorCodeToHttp(code: string): number {
	switch (code) {
		case "PATH_NOT_FOUND":
		case "NOT_A_DIRECTORY":
			return 400;
		case "SYMBOL_NOT_FOUND":
		case "FILE_NOT_INDEXED":
			return 404;
		case "AMBIGUOUS_SYMBOL":
			return 409;
		case "INDEX_FAILED":
		case "TRACE_FAILED":
			return 500;
		default:
			return 500;
	}
}

function respondSuccess(res: express.Response, data: unknown): void {
	res.json(data);
}

function respondError(
	res: express.Response,
	status: number,
	error: string,
	code: string,
	extra?: Record<string, unknown>
): void {
	const body: Record<string, unknown> = { error, code };
	if (extra) Object.assign(body, extra);
	res.status(status).json(body);
}

// ── Controller ────────────────────────────────────────────────────────

export class CodebaseController {
	// GET /api/codebase/architecture?repo=owner/repo&depth=2&includeSymbolCounts=true
	static async getArchitecture(req: express.Request, res: express.Response) {
		try {
			const repo = (req.query.repo as string)?.trim();
			if (!repo) {
				return respondError(res, 400, "repo query parameter is required", "MISSING_REPO");
			}

			const params: Record<string, unknown> = { repo };
			if (req.query.depth !== undefined) params.depth = req.query.depth;
			if (req.query.includeSymbolCounts !== undefined) params.includeSymbolCounts = req.query.includeSymbolCounts;

			const result = await handleGetArchitecture(params, db, noopVectors);

			if (result.structuredContent) {
				respondSuccess(res, result.structuredContent);
			} else {
				respondError(res, 500, "Unexpected empty response", "EMPTY_RESPONSE");
			}
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			respondError(res, 500, message, "GET_ARCHITECTURE_FAILED");
		}
	}

	// GET /api/codebase/symbols?repo=owner/repo&filePath=src/main.ts
	static async getFileSymbols(req: express.Request, res: express.Response) {
		try {
			const repo = (req.query.repo as string)?.trim();
			const filePath = (req.query.filePath as string)?.trim();

			if (!repo) return respondError(res, 400, "repo query parameter is required", "MISSING_REPO");
			if (!filePath) return respondError(res, 400, "filePath query parameter is required", "MISSING_FILE_PATH");

			const result = await handleGetFileSymbols({ repo, filePath }, db, noopVectors);

			if (result.structuredContent) {
				const data = result.structuredContent as Record<string, unknown>;
				if (data.error) {
					return respondError(
						res,
						errorCodeToHttp(data.code as string),
						data.error as string,
						(data.code as string) ?? "GET_SYMBOLS_FAILED"
					);
				}
				respondSuccess(res, data);
			} else {
				respondError(res, 500, "Unexpected empty response", "EMPTY_RESPONSE");
			}
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			respondError(res, 500, message, "GET_SYMBOLS_FAILED");
		}
	}

	// GET /api/codebase/search?repo=owner/repo&query=handler&kind=Function&limit=20&offset=0
	static async searchSymbols(req: express.Request, res: express.Response) {
		try {
			const params: Record<string, unknown> = {};

			if (req.query.query !== undefined) params.query = req.query.query;
			if (req.query.repo !== undefined) params.repo = (req.query.repo as string).trim();
			if (req.query.kind !== undefined) params.kind = req.query.kind;
			if (req.query.filePath !== undefined) params.filePath = req.query.filePath;
			if (req.query.exportedOnly !== undefined) params.exportedOnly = req.query.exportedOnly;
			if (req.query.limit !== undefined) params.limit = req.query.limit;
			if (req.query.offset !== undefined) params.offset = req.query.offset;

			const result = await handleSearchSymbols(params, db, noopVectors);

			if (result.structuredContent) {
				const data = result.structuredContent as Record<string, unknown>;
				if (data.error) {
					return respondError(
						res,
						errorCodeToHttp(data.code as string),
						data.error as string,
						(data.code as string) ?? "SEARCH_FAILED"
					);
				}
				respondSuccess(res, data);
			} else {
				respondError(res, 500, "Unexpected empty response", "EMPTY_RESPONSE");
			}
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			respondError(res, 500, message, "SEARCH_FAILED");
		}
	}

	// GET /api/codebase/trace?name=handleSearchSymbols&repo=owner/repo&includeReferences=true
	static async traceSymbol(req: express.Request, res: express.Response) {
		try {
			const name = (req.query.name as string)?.trim();
			if (!name) return respondError(res, 400, "name query parameter is required", "MISSING_NAME");

			const params: Record<string, unknown> = { name };
			if (req.query.repo !== undefined) params.repo = (req.query.repo as string).trim();
			if (req.query.includeReferences !== undefined) params.includeReferences = req.query.includeReferences;

			const result = await handleTraceSymbol(params, db, noopVectors);

			if (result.structuredContent) {
				const data = result.structuredContent as Record<string, unknown>;
				if (data.error) {
					return respondError(
						res,
						errorCodeToHttp(data.code as string),
						data.error as string,
						(data.code as string) ?? "TRACE_FAILED",
						data.disambiguation ? { disambiguation: data.disambiguation } : undefined
					);
				}
				respondSuccess(res, data);
			} else {
				respondError(res, 500, "Unexpected empty response", "EMPTY_RESPONSE");
			}
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			respondError(res, 500, message, "TRACE_FAILED");
		}
	}

	// GET /api/codebase/index-status?repo=owner/repo
	static async getIndexStatus(req: express.Request, res: express.Response) {
		try {
			const repo = (req.query.repo as string)?.trim();
			if (!repo) return respondError(res, 400, "repo query parameter is required", "MISSING_REPO");

			const result = await handleCodebaseIndexStatus({ repo }, db, noopVectors);

			if (result.structuredContent) {
				respondSuccess(res, result.structuredContent);
			} else {
				respondError(res, 500, "Unexpected empty response", "EMPTY_RESPONSE");
			}
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			respondError(res, 500, message, "INDEX_STATUS_FAILED");
		}
	}

	// POST /api/codebase/index
	// Body: { repo, repoPath?, force?, includeGlobs?, excludeGlobs? }
	static async startIndex(req: express.Request, res: express.Response) {
		try {
			const repo = (req.body.repo as string)?.trim();
			const reqRepoPath = (req.body.repoPath as string)?.trim();

			if (!repo) return respondError(res, 400, "repo is required in body", "MISSING_REPO");

			// Resolve repoPath server-side if not provided (UI doesn't know filesystem paths)
			const repoPath = resolveRepoPath(repo, reqRepoPath);
			if (!repoPath) {
				return respondError(
					res,
					400,
					`repoPath is required and could not be resolved automatically for "${repo}". ` +
						"Set CODEBASE_REPOS_DIR env var or provide repoPath in the request body.",
					"MISSING_REPO_PATH"
				);
			}

			const params: Record<string, unknown> = { repo, repoPath };
			if (req.body.force !== undefined) params.force = req.body.force;
			if (req.body.includeGlobs !== undefined) params.includeGlobs = req.body.includeGlobs;
			if (req.body.excludeGlobs !== undefined) params.excludeGlobs = req.body.excludeGlobs;

			const result = await handleCodebaseIndexRepository(params, db, noopVectors);

			if (result.structuredContent) {
				const data = result.structuredContent as Record<string, unknown>;
				if (data.error) {
					return respondError(
						res,
						errorCodeToHttp(data.code as string),
						data.error as string,
						(data.code as string) ?? "INDEX_FAILED"
					);
				}
				respondSuccess(res, data);
			} else {
				respondError(res, 500, "Unexpected empty response", "EMPTY_RESPONSE");
			}
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			respondError(res, 500, message, "INDEX_FAILED");
		}
	}

	// POST /api/codebase/auto-index
	// Body: { repo, repoPath? }
	static async autoIndex(req: express.Request, res: express.Response) {
		try {
			const repo = (req.body.repo as string)?.trim();
			const reqRepoPath = (req.body.repoPath as string)?.trim();

			if (!repo) return respondError(res, 400, "repo is required in body", "MISSING_REPO");

			const repoPath = resolveRepoPath(repo, reqRepoPath);
			if (!repoPath) {
				return respondError(
					res,
					400,
					`repoPath is required and could not be resolved automatically for "${repo}"`,
					"MISSING_REPO_PATH"
				);
			}

			const pool = getParserPool();
			const result = await autoIndexIfStale(repo, repoPath, db, pool);

			respondSuccess(res, {
				status: result.status,
				reason: result.reason
			});
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			respondError(res, 500, message, "AUTO_INDEX_FAILED");
		}
	}
}
