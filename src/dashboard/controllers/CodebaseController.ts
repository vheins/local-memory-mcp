import express from "express";
import { handleController, HttpError } from "../lib/jsonApi";
import { CodebaseService, errorCodeToHttp } from "../services/codebase.service";

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

/**
 * Thin request/response adapter for codebase endpoints.
 * Business logic delegated to CodebaseService.
 */
export class CodebaseController {
	// GET /api/codebase/architecture?repo=owner/repo&depth=2&includeSymbolCounts=true
	static async getArchitecture(req: express.Request, res: express.Response) {
		await handleController(
			req,
			res,
			async () => {
				const repo = (req.query.repo as string)?.trim();
				if (!repo) throw new HttpError(400, "repo query parameter is required", "MISSING_REPO");

				const result = await CodebaseService.readArchitecture(
					repo,
					req.query.depth as string,
					req.query.includeSymbolCounts as string
				);

				return result;
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

				const result = await CodebaseService.readFileSymbols(repo, filePath);
				assertNoToolError(result as Record<string, unknown>, "GET_SYMBOLS_FAILED");
				return result;
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

				const result = await CodebaseService.searchSymbols(params);
				assertNoToolError(result as Record<string, unknown>, "SEARCH_FAILED");
				return result;
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

				const result = await CodebaseService.traceSymbol(
					name,
					req.query.repo as string,
					req.query.includeReferences as string
				);

				const data = result as Record<string, unknown>;
				assertNoToolError(
					data,
					"TRACE_FAILED",
					data.disambiguation ? { disambiguation: data.disambiguation } : undefined
				);
				return result;
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

				const result = await CodebaseService.getIndexStatus(repo);
				return result;
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

				const result = await CodebaseService.startIndex(
					repo,
					reqRepoPath,
					req.body.force as boolean,
					req.body.includeGlobs as string[],
					req.body.excludeGlobs as string[]
				);

				assertNoToolError(result as Record<string, unknown>, "INDEX_FAILED");
				return result;
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

				const result = await CodebaseService.autoIndex(repo, reqRepoPath);
				return result;
			},
			{ onError: onCodebaseError }
		);
	}
}
