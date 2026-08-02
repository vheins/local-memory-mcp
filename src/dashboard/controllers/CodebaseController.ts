import express from "express";
import fs from "node:fs";
import path from "node:path";
import { db } from "../lib/context";
import { handleController, HttpError } from "../lib/jsonApi";
import { handleCodebaseIndexStatus, handleCodebaseIndexRepository } from "../../mcp/tools/codebase-index";
import { handleCodebaseRead } from "../../mcp/tools/codebase.read";
import { autoIndexIfStale } from "../../mcp/codebase-index/services/indexing-service";
import type { ParserPool } from "../../mcp/codebase-index/parser/language-visitor";
import { TreeSitterParserPool } from "../../mcp/codebase-index/parser/parser-pool";
import type { VectorStore } from "../../mcp/types";
import { parseRepoInput } from "../../mcp/utils/normalize";

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

// ── Owner injection ──────────────────────────────────────────────────

/**
 * Injects `owner` into tool handler params when not explicitly provided.
 *
 * The dashboard REST API receives `repo` in `owner/repo` format from the UI,
 * but the MCP tool handler schemas require `owner` as a separate field
 * (`z.string().min(1)`). When called via the MCP protocol, the
 * `normalizeToolArguments()` function auto-injects `owner` from session
 * context — but the dashboard calls handlers directly in-process, so we
 * must inject `owner` ourselves.
 *
 * Strategy:
 *  1. Extract owner from `repo` param (expects `owner/repo` format)
 *  2. Fallback: infer from git remote origin of the current working directory
 */
function injectOwner(params: Record<string, unknown>): Record<string, unknown> {
	if (params.owner && typeof params.owner === "string" && params.owner.length > 0) {
		return params;
	}

	const repo = params.repo as string | undefined;
	if (!repo) return params;

	// Primary: extract owner from "owner/repo" format
	const parsed = parseRepoInput(repo);
	if (parsed.owner) {
		return { ...params, owner: parsed.owner };
	}

	// Fallback: try to infer owner from git remote origin of CWD
	try {
		const gitConfigPath = path.join(process.cwd(), ".git", "config");
		if (fs.existsSync(gitConfigPath)) {
			const content = fs.readFileSync(gitConfigPath, "utf-8");
			const match = content.match(
				/url\s*=\s*(?:git@github\.com:|https?:\/\/github\.com\/|git:\/\/github\.com\/)([^/\s]+)/
			);
			const rawOwner = match?.[1];
			if (rawOwner && /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/.test(rawOwner)) {
				return { ...params, owner: rawOwner };
			}
		}
	} catch {
		// Git config not accessible — proceed without owner, schema will fail
		// with a clear validation error
	}

	return params;
}

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

/**
 * Maps the MCP codebase tool's documented error codes to HTTP statuses.
 * The tool handlers return `{ error, code }` payloads; this keeps the
 * status derivation in one place.
 */
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

/**
 * Error responder for the codebase endpoints.
 *
 * Unlike the other dashboard controllers, the codebase API deliberately
 * returns raw payloads (no JSON:API envelope): the UI deserializer and the
 * integration tests rely on top-level fields (`code`, `symbols`, `root`,
 * `isIndexed`, ...). Errors therefore keep the `{ error, code, ...extra }`
 * shape instead of `jsonApiError`'s `{ errors: [...] }`.
 */
function onCodebaseError(res: express.Response, err: HttpError): void {
	if (res.headersSent) {
		res.end();
		return;
	}
	const body: Record<string, unknown> = { error: err.message, code: err.code || "INTERNAL_SERVER_ERROR" };
	if (err.extra) Object.assign(body, err.extra);
	res.status(err.status).json(body);
}

/**
 * Converts a tool-handler error payload (`structuredContent.error`) into a
 * thrown `HttpError` carrying the tool's code, preserving the HTTP status
 * derived by `errorCodeToHttp`.
 */
function assertNoToolError(data: Record<string, unknown>, fallbackCode: string, extra?: Record<string, unknown>): void {
	if (data.error) {
		throw new HttpError(
			errorCodeToHttp((data.code as string) ?? ""),
			data.error as string,
			(data.code as string) ?? fallbackCode,
			extra
		);
	}
}

// ── Controller ────────────────────────────────────────────────────────

export class CodebaseController {
	// GET /api/codebase/architecture?repo=owner/repo&depth=2&includeSymbolCounts=true
	static async getArchitecture(req: express.Request, res: express.Response) {
		await handleController(
			req,
			res,
			async () => {
				const repo = (req.query.repo as string)?.trim();
				if (!repo) throw new HttpError(400, "repo query parameter is required", "MISSING_REPO");

				const params: Record<string, unknown> = { repo };
				if (req.query.depth !== undefined) params.depth = req.query.depth;
				if (req.query.includeSymbolCounts !== undefined) params.includeSymbolCounts = req.query.includeSymbolCounts;

				const result = await handleCodebaseRead(injectOwner(params), db, noopVectors);

				if (!result.structuredContent) {
					throw new HttpError(500, "Unexpected empty response", "EMPTY_RESPONSE");
				}
				return result.structuredContent;
			},
			{ onError: onCodebaseError }
		);
	}

	// GET /api/codebase/symbols?repo=owner/repo&filePath=src/main.ts
	static async getFileSymbols(req: express.Request, res: express.Response) {
		await handleController(
			req,
			res,
			async () => {
				const repo = (req.query.repo as string)?.trim();
				const filePath = (req.query.filePath as string)?.trim();

				if (!repo) throw new HttpError(400, "repo query parameter is required", "MISSING_REPO");
				if (!filePath) throw new HttpError(400, "filePath query parameter is required", "MISSING_FILE_PATH");

				const result = await handleCodebaseRead(injectOwner({ repo, filePath }), db, noopVectors);

				if (!result.structuredContent) {
					throw new HttpError(500, "Unexpected empty response", "EMPTY_RESPONSE");
				}
				const data = result.structuredContent as Record<string, unknown>;
				assertNoToolError(data, "GET_SYMBOLS_FAILED");
				return data;
			},
			{ onError: onCodebaseError }
		);
	}

	// GET /api/codebase/search?repo=owner/repo&query=handler&kind=Function&limit=20&offset=0
	static async searchSymbols(req: express.Request, res: express.Response) {
		await handleController(
			req,
			res,
			async () => {
				const params: Record<string, unknown> = {};

				if (req.query.query !== undefined) params.query = req.query.query;
				if (req.query.repo !== undefined) params.repo = (req.query.repo as string).trim();
				if (req.query.kind !== undefined) params.kind = req.query.kind;
				if (req.query.filePath !== undefined) params.filePath = req.query.filePath;
				if (req.query.exportedOnly !== undefined) params.exportedOnly = req.query.exportedOnly;
				if (req.query.limit !== undefined) params.limit = req.query.limit;
				if (req.query.offset !== undefined) params.offset = req.query.offset;

				const result = await handleCodebaseRead(injectOwner(params), db, noopVectors);

				if (!result.structuredContent) {
					throw new HttpError(500, "Unexpected empty response", "EMPTY_RESPONSE");
				}
				const data = result.structuredContent as Record<string, unknown>;
				assertNoToolError(data, "SEARCH_FAILED");
				return data;
			},
			{ onError: onCodebaseError }
		);
	}

	// GET /api/codebase/trace?name=handleCodebaseRead&repo=owner/repo&includeReferences=true
	static async traceSymbol(req: express.Request, res: express.Response) {
		await handleController(
			req,
			res,
			async () => {
				const name = (req.query.name as string)?.trim();
				if (!name) throw new HttpError(400, "name query parameter is required", "MISSING_NAME");

				const params: Record<string, unknown> = { name };
				if (req.query.repo !== undefined) params.repo = (req.query.repo as string).trim();
				if (req.query.includeReferences !== undefined) params.includeReferences = req.query.includeReferences;

				const result = await handleCodebaseRead(injectOwner(params), db, noopVectors);

				if (!result.structuredContent) {
					throw new HttpError(500, "Unexpected empty response", "EMPTY_RESPONSE");
				}
				const data = result.structuredContent as Record<string, unknown>;
				assertNoToolError(
					data,
					"TRACE_FAILED",
					data.disambiguation ? { disambiguation: data.disambiguation } : undefined
				);
				return data;
			},
			{ onError: onCodebaseError }
		);
	}

	// GET /api/codebase/index-status?repo=owner/repo
	static async getIndexStatus(req: express.Request, res: express.Response) {
		await handleController(
			req,
			res,
			async () => {
				const repo = (req.query.repo as string)?.trim();
				if (!repo) throw new HttpError(400, "repo query parameter is required", "MISSING_REPO");

				const result = await handleCodebaseIndexStatus(injectOwner({ repo }), db, noopVectors);

				if (!result.structuredContent) {
					throw new HttpError(500, "Unexpected empty response", "EMPTY_RESPONSE");
				}
				return result.structuredContent;
			},
			{ onError: onCodebaseError }
		);
	}

	// POST /api/codebase/index
	// Body: { repo, repoPath?, force?, includeGlobs?, excludeGlobs? }
	static async startIndex(req: express.Request, res: express.Response) {
		await handleController(
			req,
			res,
			async () => {
				const repo = (req.body.repo as string)?.trim();
				const reqRepoPath = (req.body.repoPath as string)?.trim();

				if (!repo) throw new HttpError(400, "repo is required in body", "MISSING_REPO");
				if (!reqRepoPath) throw new HttpError(400, "repoPath is required in body", "MISSING_REPO_PATH");

				// Verify the provided repoPath actually exists
				const repoPath = resolveRepoPath(repo, reqRepoPath);
				if (!repoPath) {
					throw new HttpError(
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

				const result = await handleCodebaseIndexRepository(injectOwner(params), db, noopVectors);

				if (!result.structuredContent) {
					throw new HttpError(500, "Unexpected empty response", "EMPTY_RESPONSE");
				}
				const data = result.structuredContent as Record<string, unknown>;
				assertNoToolError(data, "INDEX_FAILED");
				return data;
			},
			{ onError: onCodebaseError }
		);
	}

	// POST /api/codebase/auto-index
	// Body: { repo, repoPath? }
	static async autoIndex(req: express.Request, res: express.Response) {
		await handleController(
			req,
			res,
			async () => {
				const repo = (req.body.repo as string)?.trim();
				const reqRepoPath = (req.body.repoPath as string)?.trim();

				if (!repo) throw new HttpError(400, "repo is required in body", "MISSING_REPO");

				const repoPath = resolveRepoPath(repo, reqRepoPath);
				if (!repoPath) {
					throw new HttpError(
						400,
						`repoPath is required and could not be resolved automatically for "${repo}"`,
						"MISSING_REPO_PATH"
					);
				}

				const pool = getParserPool();
				const result = await autoIndexIfStale(repo, repoPath, db, pool);

				return {
					status: result.status,
					reason: result.reason
				};
			},
			{ onError: onCodebaseError }
		);
	}
}
