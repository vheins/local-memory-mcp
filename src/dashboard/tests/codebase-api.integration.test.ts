/**
 * Codebase API Integration Tests.
 *
 * Tests the dashboard codebase endpoints against an in-memory SQLiteStore,
 * using vi.mock to bypass the real context.ts module.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { AddressInfo } from "node:net";

// ── Env overrides for bounded payloads (TASK-324) ───────────────────────────
// Read by constants.ts at module load (beforeAll's dynamic route import) —
// must be set before that import runs. Keeps the graph edge-cap and the
// file-content line-cap tests cheap (10 edges / 10 lines instead of the
// production 400 / 2000).
process.env.CODE_GRAPH_MAX_EDGES = "10";
process.env.FILE_CONTENT_MAX_LINES = "10";

// ── Mock context.ts (must be BEFORE any imports that transitively load it) ──

vi.mock("../../dashboard/lib/context", async () => {
	const { SQLiteStore } = await import("../../mcp/storage/sqlite");
	const db = new SQLiteStore(":memory:");

	return {
		db,
		vectors: {
			upsert: vi.fn(),
			remove: vi.fn(),
			search: vi.fn().mockResolvedValue([])
		},
		mcpClient: { start: vi.fn(), stop: vi.fn(), isConnected: vi.fn(() => false), getPendingCount: vi.fn(() => 0) },
		logger: {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			debug: vi.fn()
		},
		startTime: Date.now()
	};
});

// ── Helpers ───────────────────────────────────────────────────────────────

function createTempTsFile(dir: string, filename: string, content: string): string {
	const filePath = path.join(dir, filename);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content, "utf-8");
	return filePath;
}

function createTempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "codebase-api-test-"));
}

/**
 * Seed the `callers-repo` fixture used by the symbol-callers describe block:
 * `startServer` (callers-repo/src/target.ts) referenced by `invoke`
 * (callers-repo/src/callers.ts) via one `call` and one `import` row.
 */
async function seedCallersRepo(): Promise<void> {
	const { db } = await import("../../dashboard/lib/context");

	db.codebaseFiles.upsertFile({
		repo: "callers-repo",
		file_path: "src/target.ts",
		language: "typescript",
		checksum: "ct1",
		lines: 20,
		size_bytes: 200
	});
	db.codebaseFiles.upsertFile({
		repo: "callers-repo",
		file_path: "src/callers.ts",
		language: "typescript",
		checksum: "ct2",
		lines: 30,
		size_bytes: 300
	});

	db.codebaseSymbols.bulkUpsertSymbols([
		{
			id: "sym-start-server",
			repo: "callers-repo",
			file_path: "src/target.ts",
			name: "startServer",
			kind: "Function",
			exported: true,
			default_export: false,
			start_line: 3,
			start_col: 0,
			end_line: 12,
			end_col: 1,
			signature: null,
			doc_comment: null,
			parent_symbol_id: null
		},
		{
			id: "sym-invoke",
			repo: "callers-repo",
			file_path: "src/callers.ts",
			name: "invoke",
			kind: "Function",
			exported: false,
			default_export: false,
			start_line: 5,
			start_col: 0,
			end_line: 9,
			end_col: 1,
			signature: null,
			doc_comment: null,
			parent_symbol_id: null
		}
	]);

	db.codebaseReferences.bulkUpsertReferences("callers-repo", [
		{
			repo: "callers-repo",
			symbol_name: "startServer",
			caller_file: "src/callers.ts",
			caller_line: 6,
			caller_name: "invoke",
			kind: "call",
			target_file: "src/target.ts",
			target_symbol_id: "sym-start-server"
		},
		{
			repo: "callers-repo",
			symbol_name: "startServer",
			caller_file: "src/callers.ts",
			caller_line: 7,
			caller_name: "invoke",
			kind: "import",
			target_file: "src/target.ts",
			target_symbol_id: "sym-start-server"
		}
	]);
}

/**
 * Seed the `graph-repo` fixture used by the code-graph describe block:
 * two files, three symbols (Alpha/Beta co-defined in a.ts, Gamma in b.ts),
 * two call reference rows (Beta→Gamma, Gamma→Alpha). Yields exactly
 * 3 edges in default mode: 2 calls + 1 co_defined chain (Alpha→Beta).
 */
async function seedGraphRepo(): Promise<void> {
	const { db } = await import("../../dashboard/lib/context");

	db.codebaseFiles.upsertFile({
		repo: "graph-repo",
		file_path: "src/a.ts",
		language: "typescript",
		checksum: "graph-a",
		lines: 20,
		size_bytes: 200
	});
	db.codebaseFiles.upsertFile({
		repo: "graph-repo",
		file_path: "src/b.ts",
		language: "typescript",
		checksum: "graph-b",
		lines: 10,
		size_bytes: 100
	});

	db.codebaseSymbols.bulkUpsertSymbols([
		{
			id: "graph-alpha",
			repo: "graph-repo",
			file_path: "src/a.ts",
			name: "Alpha",
			kind: "Function",
			exported: true,
			default_export: false,
			start_line: 1,
			start_col: 0,
			end_line: 10,
			end_col: 1,
			signature: null,
			doc_comment: null,
			parent_symbol_id: null
		},
		{
			id: "graph-beta",
			repo: "graph-repo",
			file_path: "src/a.ts",
			name: "Beta",
			kind: "Function",
			exported: true,
			default_export: false,
			start_line: 11,
			start_col: 0,
			end_line: 20,
			end_col: 1,
			signature: null,
			doc_comment: null,
			parent_symbol_id: null
		},
		{
			id: "graph-gamma",
			repo: "graph-repo",
			file_path: "src/b.ts",
			name: "Gamma",
			kind: "Function",
			exported: true,
			default_export: false,
			start_line: 1,
			start_col: 0,
			end_line: 10,
			end_col: 1,
			signature: null,
			doc_comment: null,
			parent_symbol_id: null
		}
	]);

	db.codebaseReferences.bulkUpsertReferences("graph-repo", [
		{
			repo: "graph-repo",
			symbol_name: "Alpha",
			caller_file: "src/b.ts",
			caller_line: 5,
			caller_name: "Gamma",
			kind: "call",
			target_file: "src/a.ts",
			target_symbol_id: "graph-alpha"
		},
		{
			repo: "graph-repo",
			symbol_name: "Gamma",
			caller_file: "src/a.ts",
			caller_line: 15,
			caller_name: "Beta",
			kind: "call",
			target_file: "src/b.ts",
			target_symbol_id: "graph-gamma"
		}
	]);
}

/**
 * Seed the `heritage-repo` fixture for TASK-374: heritage (extends) and
 * module-scope import reference rows carry caller_name=null (the TS emitter
 * hard-codes null — ts-reference-emission.ts / typescript-visitor.ts), so the
 * caller symbol must be resolved by SPAN. Fixture (src/child.ts):
 *   - ChildService class lines 5-30 (top-level), NestedConfig class lines
 *     7-10 (parent ChildService);
 *   - an extends row at caller_line 7 — contained by BOTH ChildService and
 *     NestedConfig, so the INNERMOST (NestedConfig) must win;
 *   - a module-scope import row at caller_line 2 — above every symbol span,
 *     so it falls back to the file's first top-level symbol (ChildService).
 */
async function seedHeritageRepo(): Promise<void> {
	const { db } = await import("../../dashboard/lib/context");

	db.codebaseFiles.upsertFile({
		repo: "heritage-repo",
		file_path: "src/base.ts",
		language: "typescript",
		checksum: "her-base",
		lines: 12,
		size_bytes: 200
	});
	db.codebaseFiles.upsertFile({
		repo: "heritage-repo",
		file_path: "src/logger.ts",
		language: "typescript",
		checksum: "her-logger",
		lines: 6,
		size_bytes: 100
	});
	db.codebaseFiles.upsertFile({
		repo: "heritage-repo",
		file_path: "src/child.ts",
		language: "typescript",
		checksum: "her-child",
		lines: 30,
		size_bytes: 400
	});

	db.codebaseSymbols.bulkUpsertSymbols([
		{
			id: "her-base",
			repo: "heritage-repo",
			file_path: "src/base.ts",
			name: "BaseService",
			kind: "Class",
			exported: true,
			default_export: false,
			start_line: 1,
			start_col: 0,
			end_line: 12,
			end_col: 1,
			signature: null,
			doc_comment: null,
			parent_symbol_id: null
		},
		{
			id: "her-logger",
			repo: "heritage-repo",
			file_path: "src/logger.ts",
			name: "Logger",
			kind: "Function",
			exported: true,
			default_export: false,
			start_line: 1,
			start_col: 0,
			end_line: 6,
			end_col: 1,
			signature: null,
			doc_comment: null,
			parent_symbol_id: null
		},
		{
			id: "her-child",
			repo: "heritage-repo",
			file_path: "src/child.ts",
			name: "ChildService",
			kind: "Class",
			exported: true,
			default_export: false,
			start_line: 5,
			start_col: 0,
			end_line: 30,
			end_col: 1,
			signature: null,
			doc_comment: null,
			parent_symbol_id: null
		},
		{
			id: "her-nested",
			repo: "heritage-repo",
			file_path: "src/child.ts",
			name: "NestedConfig",
			kind: "Class",
			exported: false,
			default_export: false,
			start_line: 7,
			start_col: 2,
			end_line: 10,
			end_col: 1,
			signature: null,
			doc_comment: null,
			parent_symbol_id: "her-child"
		}
	]);

	db.codebaseReferences.bulkUpsertReferences("heritage-repo", [
		// Heritage row: caller_name null, caller_line 7 inside BOTH ChildService
		// (5-30) and NestedConfig (7-10) — the innermost span must win.
		{
			repo: "heritage-repo",
			symbol_name: "BaseService",
			caller_file: "src/child.ts",
			caller_line: 7,
			caller_name: null,
			kind: "extends",
			target_file: "src/base.ts",
			target_symbol_id: "her-base"
		},
		// Module-scope import row: caller_name null, caller_line 2 above every
		// symbol span → top-level fallback → ChildService.
		{
			repo: "heritage-repo",
			symbol_name: "Logger",
			caller_file: "src/child.ts",
			caller_line: 2,
			caller_name: null,
			kind: "import",
			target_file: "src/logger.ts",
			target_symbol_id: "her-logger"
		}
	]);
}

/**
 * Seed the `dup-repo` fixture for TASK-373: the name `handleInit` exists in
 * TWO files (src/a.ts + src/b.ts), with one call row targeting each
 * definition. Before the fix getSymbolCallers silently picked matches[0]
 * (src/a.ts by file_path ordering) — now it must 409 without filePath and
 * scope cleanly (symbol AND pairs) with it.
 */
async function seedDuplicateRepo(): Promise<void> {
	const { db } = await import("../../dashboard/lib/context");

	db.codebaseFiles.upsertFile({
		repo: "dup-repo",
		file_path: "src/a.ts",
		language: "typescript",
		checksum: "dup-a",
		lines: 10,
		size_bytes: 100
	});
	db.codebaseFiles.upsertFile({
		repo: "dup-repo",
		file_path: "src/b.ts",
		language: "typescript",
		checksum: "dup-b",
		lines: 10,
		size_bytes: 100
	});
	db.codebaseFiles.upsertFile({
		repo: "dup-repo",
		file_path: "src/callers.ts",
		language: "typescript",
		checksum: "dup-c",
		lines: 20,
		size_bytes: 200
	});

	db.codebaseSymbols.bulkUpsertSymbols([
		{
			id: "dup-init-a",
			repo: "dup-repo",
			file_path: "src/a.ts",
			name: "handleInit",
			kind: "Function",
			exported: true,
			default_export: false,
			start_line: 1,
			start_col: 0,
			end_line: 10,
			end_col: 1,
			signature: null,
			doc_comment: null,
			parent_symbol_id: null
		},
		{
			id: "dup-init-b",
			repo: "dup-repo",
			file_path: "src/b.ts",
			name: "handleInit",
			kind: "Function",
			exported: true,
			default_export: false,
			start_line: 1,
			start_col: 0,
			end_line: 10,
			end_col: 1,
			signature: null,
			doc_comment: null,
			parent_symbol_id: null
		},
		{
			id: "dup-run",
			repo: "dup-repo",
			file_path: "src/callers.ts",
			name: "run",
			kind: "Function",
			exported: false,
			default_export: false,
			start_line: 1,
			start_col: 0,
			end_line: 20,
			end_col: 1,
			signature: null,
			doc_comment: null,
			parent_symbol_id: null
		}
	]);

	db.codebaseReferences.bulkUpsertReferences("dup-repo", [
		{
			repo: "dup-repo",
			symbol_name: "handleInit",
			caller_file: "src/callers.ts",
			caller_line: 3,
			caller_name: "run",
			kind: "call",
			target_file: "src/a.ts",
			target_symbol_id: "dup-init-a"
		},
		{
			repo: "dup-repo",
			symbol_name: "handleInit",
			caller_file: "src/callers.ts",
			caller_line: 6,
			caller_name: "run",
			kind: "call",
			target_file: "src/b.ts",
			target_symbol_id: "dup-init-b"
		}
	]);
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("Codebase API", () => {
	let app: express.Express;
	let server: ReturnType<express.Express["listen"]>;
	let baseUrl: string;

	beforeAll(async () => {
		const codebaseRoutes = (await import("../../dashboard/routes/codebase.routes")).default;
		app = express();
		app.use(express.json());
		app.use("/api/codebase", codebaseRoutes);
		server = app.listen(0);
		const { port } = server.address() as AddressInfo;
		baseUrl = `http://127.0.0.1:${port}`;
	});

	afterAll(async () => {
		await new Promise<void>((resolve, reject) => {
			server.close((err) => (err ? reject(err) : resolve()));
		});
	});

	describe("index-status", () => {
		it("returns 400 when repo is missing", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/index-status?repo=`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("MISSING_REPO");
		});

		it("returns index status for a known repo", async () => {
			const { db } = await import("../../dashboard/lib/context");
			db.codebaseFiles.upsertFile({
				repo: "test-repo",
				file_path: "src/index.ts",
				language: "typescript",
				checksum: "abc123",
				lines: 10,
				size_bytes: 200
			});

			const res = await fetch(`${baseUrl}/api/codebase/index-status?repo=test-owner/test-repo`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			// Repo is normalized by the schema (owner prefix stripped)
			expect(body.repo).toBe("test-repo");
			expect(body.isIndexed).toBe(true);
			expect(body.totalFiles).toBeGreaterThanOrEqual(1);
		});
	});

	describe("architecture", () => {
		it("returns 400 when repo is missing", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/architecture`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("MISSING_REPO");
		});

		it("returns architecture tree for indexed repo", async () => {
			const { db } = await import("../../dashboard/lib/context");

			// DB stores repo as short name (after schema normalizeRepo strips owner prefix)
			db.codebaseFiles.upsertFile({
				repo: "arch-repo",
				file_path: "src/controllers/user.controller.ts",
				language: "typescript",
				checksum: "def456",
				lines: 42,
				size_bytes: 1200
			});
			db.codebaseFiles.upsertFile({
				repo: "arch-repo",
				file_path: "src/services/auth.service.ts",
				language: "typescript",
				checksum: "ghi789",
				lines: 88,
				size_bytes: 2400
			});

			db.codebaseSymbols.bulkUpsertSymbols([
				{
					repo: "arch-repo",
					file_path: "src/controllers/user.controller.ts",
					name: "UserController",
					kind: "Class",
					exported: true,
					default_export: false,
					start_line: 1,
					start_col: 0,
					end_line: 42,
					end_col: 1,
					signature: "class UserController",
					doc_comment: null,
					parent_symbol_id: null
				},
				{
					repo: "arch-repo",
					file_path: "src/services/auth.service.ts",
					name: "authenticate",
					kind: "Function",
					exported: true,
					default_export: false,
					start_line: 10,
					start_col: 0,
					end_line: 30,
					end_col: 1,
					signature: "function authenticate(token: string): User | null",
					doc_comment: "Authenticates a user by token",
					parent_symbol_id: null
				}
			]);

			const res = await fetch(`${baseUrl}/api/codebase/architecture?repo=test-owner/arch-repo&depth=3`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.root).toBeDefined();
			expect(body.root.type).toBe("directory");
			expect(body.summary.totalFiles).toBe(2);
			expect(body.summary.totalSymbols).toBe(2);
			expect(body.summary.topLevelExports.length).toBe(2);
		});
	});

	describe("symbols", () => {
		it("returns 400 when repo is missing", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/symbols?filePath=foo.ts`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("MISSING_REPO");
		});

		it("returns 400 when filePath is missing", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/symbols?repo=test/test`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("MISSING_FILE_PATH");
		});

		it("returns symbols for an indexed file", async () => {
			const { db } = await import("../../dashboard/lib/context");

			db.codebaseFiles.upsertFile({
				repo: "sym-repo",
				file_path: "src/lib/helpers.ts",
				language: "typescript",
				checksum: "sym123",
				lines: 50,
				size_bytes: 1800
			});

			db.codebaseSymbols.bulkUpsertSymbols([
				{
					repo: "sym-repo",
					file_path: "src/lib/helpers.ts",
					name: "formatDate",
					kind: "Function",
					exported: true,
					default_export: false,
					start_line: 5,
					start_col: 0,
					end_line: 12,
					end_col: 1,
					signature: "function formatDate(date: Date): string",
					doc_comment: "Formats a date to ISO string",
					parent_symbol_id: null
				},
				{
					repo: "sym-repo",
					file_path: "src/lib/helpers.ts",
					name: "parseNumber",
					kind: "Function",
					exported: false,
					default_export: false,
					start_line: 15,
					start_col: 0,
					end_line: 20,
					end_col: 1,
					signature: null,
					doc_comment: null,
					parent_symbol_id: null
				}
			]);

			const res = await fetch(`${baseUrl}/api/codebase/symbols?repo=test-owner/sym-repo&filePath=src/lib/helpers.ts`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.file).toBeDefined();
			expect(body.file.language).toBe("typescript");
			expect(body.symbols).toHaveLength(2);
			expect(body.total).toBe(2);
		});
	});

	describe("search", () => {
		it("returns empty result for a search with no matches", async () => {
			const { db } = await import("../../dashboard/lib/context");

			db.codebaseFiles.upsertFile({
				repo: "search-repo",
				file_path: "src/main.ts",
				language: "typescript",
				checksum: "search123",
				lines: 5,
				size_bytes: 100
			});

			db.codebaseSymbols.bulkUpsertSymbols([
				{
					repo: "search-repo",
					file_path: "src/main.ts",
					name: "main",
					kind: "Function",
					exported: false,
					default_export: false,
					start_line: 1,
					start_col: 0,
					end_line: 5,
					end_col: 1,
					signature: null,
					doc_comment: null,
					parent_symbol_id: null
				}
			]);

			const res = await fetch(`${baseUrl}/api/codebase/search?repo=test-owner/search-repo&query=zzTopNotFound`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.total).toBe(0);
			expect(body.symbols).toEqual([]);
		});

		it("finds symbols by name", async () => {
			const { db } = await import("../../dashboard/lib/context");

			db.codebaseFiles.upsertFile({
				repo: "search-repo-2",
				file_path: "src/app.ts",
				language: "typescript",
				checksum: "srch2",
				lines: 20,
				size_bytes: 300
			});

			db.codebaseSymbols.bulkUpsertSymbols([
				{
					repo: "search-repo-2",
					file_path: "src/app.ts",
					name: "startServer",
					kind: "Function",
					exported: true,
					default_export: false,
					start_line: 10,
					start_col: 0,
					end_line: 20,
					end_col: 1,
					signature: "function startServer(): void",
					doc_comment: null,
					parent_symbol_id: null
				}
			]);

			const res = await fetch(`${baseUrl}/api/codebase/search?repo=test-owner/search-repo-2&query=start`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.total).toBeGreaterThanOrEqual(1);
			expect(body.symbols[0].name).toBe("startServer");
		});
	});

	describe("trace", () => {
		it("returns 400 when name is missing", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/trace`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("MISSING_NAME");
		});

		it("returns symbol details for a unique match", async () => {
			const { db } = await import("../../dashboard/lib/context");

			db.codebaseFiles.upsertFile({
				repo: "trace-repo",
				file_path: "src/utils/logger.ts",
				language: "typescript",
				checksum: "trace001",
				lines: 30,
				size_bytes: 600
			});

			db.codebaseSymbols.bulkUpsertSymbols([
				{
					repo: "trace-repo",
					file_path: "src/utils/logger.ts",
					name: "createLogger",
					kind: "Function",
					exported: true,
					default_export: false,
					start_line: 3,
					start_col: 0,
					end_line: 10,
					end_col: 1,
					signature: "function createLogger(name: string): Logger",
					doc_comment: "Creates a named logger instance",
					parent_symbol_id: null
				}
			]);

			const res = await fetch(`${baseUrl}/api/codebase/trace?name=createLogger&repo=test-owner/trace-repo`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.symbol).toBeDefined();
			expect(body.symbol.name).toBe("createLogger");
			expect(body.symbol.kind).toBe("Function");
			expect(body.definition.file).toBe("src/utils/logger.ts");
		});
	});

	describe("index", () => {
		let tmpDir: string;

		beforeEach(() => {
			tmpDir = createTempDir();
		});

		afterEach(() => {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		});

		it("returns 400 when repo is missing", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/index`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ repoPath: "/tmp/some-path" })
			});
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("MISSING_REPO");
		});

		it("returns 400 when repoPath is missing", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/index`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ repo: "test/test" })
			});
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("MISSING_REPO_PATH");
		});

		it("indexes a small TypeScript file in a temp directory", async () => {
			createTempTsFile(
				tmpDir,
				"src/index.ts",
				`export function hello(): string {
  return "world";
}
`
			);

			const res = await fetch(`${baseUrl}/api/codebase/index`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ repo: "test-owner/index-test", repoPath: tmpDir })
			});
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.success).toBe(true);
			expect(body.totalFiles).toBe(1);
			expect(body.totalSymbols).toBeGreaterThanOrEqual(1);
		});
	});

	describe("auto-index", () => {
		let tmpDir: string;

		beforeEach(() => {
			tmpDir = createTempDir();
		});

		afterEach(() => {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		});

		it("returns 400 when repo is missing", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/auto-index`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ repoPath: "/tmp/some-path" })
			});
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("MISSING_REPO");
		});

		it("indexes when no prior index exists", async () => {
			createTempTsFile(
				tmpDir,
				"src/main.ts",
				`export function bootstrap(): void {
  console.log("boot");
}
`
			);

			const res = await fetch(`${baseUrl}/api/codebase/auto-index`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ repo: "test-owner/auto-index-test", repoPath: tmpDir })
			});
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			// Controller returns { status, reason } from autoIndexIfStale
			expect(body.status).toBe("started");
			expect(body.reason).toBeDefined();
			expect(typeof body.reason).toBe("string");
		});

		it("returns status for an already-indexed repo", async () => {
			createTempTsFile(tmpDir, "src/app.ts", `export const VERSION = "1.0";\n`);

			// Pre-populate the index so auto-index detects existing files
			const { db } = await import("../../dashboard/lib/context");
			db.codebaseFiles.upsertFile({
				repo: "test-owner/auto-skip",
				file_path: "src/app.ts",
				language: "typescript",
				checksum: null,
				lines: 1,
				size_bytes: 30
			});

			const res = await fetch(`${baseUrl}/api/codebase/auto-index?threshold=0.0`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ repo: "test-owner/auto-skip", repoPath: tmpDir })
			});
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			// Controller returns { status, reason } from autoIndexIfStale
			expect(body.status).toBeDefined();
			expect(["started", "skipped"]).toContain(body.status);
			expect(body.reason).toBeDefined();
		});
	});

	describe("file-content", () => {
		let tmpDir: string;

		beforeEach(() => {
			tmpDir = createTempDir();
		});

		afterEach(() => {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		});

		it("returns 400 when repo is missing", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/file/content?path=src/main.ts`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("MISSING_REPO");
		});

		it("returns 400 when path is missing", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/file/content?repo=test-owner/x`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("MISSING_FILE_PATH");
		});

		it("returns 400 when repoPath cannot be resolved", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/file/content?repo=test-owner/no-such-dir&path=src/main.ts`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("MISSING_REPO_PATH");
		});

		it("serves an indexed file from disk through the shared cache", async () => {
			const content = `export function hello(): string {\n  return "world";\n}\n`;
			createTempTsFile(tmpDir, "src/index.ts", content);

			const { db } = await import("../../dashboard/lib/context");
			db.codebaseFiles.upsertFile({
				repo: "fc-repo",
				file_path: "src/index.ts",
				language: "typescript",
				checksum: "fc123",
				lines: 3,
				size_bytes: 60
			});

			const res = await fetch(
				`${baseUrl}/api/codebase/file/content?repo=test-owner/fc-repo&path=src/index.ts&repoPath=${tmpDir}`
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.file_path).toBe("src/index.ts");
			expect(body.language).toBe("typescript");
			// Same convention as the index's countLines (1 + # of \n).
			expect(body.lines).toBe(content.split(/\r?\n/).length);
			expect(body.size_bytes).toBe(Buffer.byteLength(content, "utf-8"));
			expect(body.content).toContain('return "world"');
			expect(body.truncated).toBe(false);
		});

		it("serves a non-indexed file with extension-derived language", async () => {
			const content = `# Notes\n\nSome markdown for the FileViewer.\n`;
			createTempTsFile(tmpDir, "docs/notes.md", content);

			const res = await fetch(
				`${baseUrl}/api/codebase/file/content?repo=test-owner/fc-raw&path=docs/notes.md&repoPath=${tmpDir}`
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.file_path).toBe("docs/notes.md");
			expect(body.language).toBe("markdown");
			expect(body.content).toContain("# Notes");
			expect(body.truncated).toBe(false);
		});

		it("accepts POST with body params", async () => {
			createTempTsFile(tmpDir, "src/post.ts", `export const V = 1;\n`);

			const res = await fetch(`${baseUrl}/api/codebase/file/content`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ repo: "test-owner/fc-post", path: "src/post.ts", repoPath: tmpDir })
			});
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.file_path).toBe("src/post.ts");
			expect(body.content).toContain("export const V");
		});

		it("truncates content beyond the line cap", async () => {
			// FILE_CONTENT_MAX_LINES is overridden to 10 for this file. No
			// trailing newline so the fixture is exactly 25 lines.
			const lines = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`);
			createTempTsFile(tmpDir, "src/long.ts", lines.join("\n"));

			const res = await fetch(
				`${baseUrl}/api/codebase/file/content?repo=test-owner/fc-long&path=src/long.ts&repoPath=${tmpDir}`
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.lines).toBe(25);
			expect(body.truncated).toBe(true);
			expect(body.content.split("\n")).toHaveLength(10);
		});

		it("returns 404 for a file missing on disk", async () => {
			const res = await fetch(
				`${baseUrl}/api/codebase/file/content?repo=test-owner/fc-missing&path=src/nope.ts&repoPath=${tmpDir}`
			);
			expect(res.status).toBe(404);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("FILE_NOT_FOUND");
		});

		it("rejects path traversal (relative escape)", async () => {
			createTempTsFile(tmpDir, "src/ok.ts", `const a = 1;\n`);
			// ../../etc/passwd resolves outside tmpDir → path traversal.
			const res = await fetch(
				`${baseUrl}/api/codebase/file/content?repo=test-owner/fc-trav&path=../../etc/passwd&repoPath=${tmpDir}`
			);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("PATH_TRAVERSAL");
		});

		it("rejects path traversal (absolute path)", async () => {
			const res = await fetch(
				`${baseUrl}/api/codebase/file/content?repo=test-owner/fc-abs&path=/etc/passwd&repoPath=${tmpDir}`
			);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("PATH_TRAVERSAL");
		});
	});

	describe("symbol-callers", () => {
		// Seed runs ONCE (bulkUpsertSymbols is a plain INSERT — re-seeding would
		// violate the id PK); the kind-filter and 404 tests share the fixture.
		beforeAll(seedCallersRepo);

		it("returns 400 when repo is missing", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/symbol/callers?name=startServer`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("MISSING_REPO");
		});

		it("returns 400 when name is missing", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/symbol/callers?repo=test-owner/callers-repo`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("MISSING_NAME");
		});

		it("returns caller/callee pairs grouped by caller symbol", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/symbol/callers?repo=test-owner/callers-repo&name=startServer`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.symbol.name).toBe("startServer");
			expect(body.symbol.kind).toBe("Function");
			expect(body.total).toBe(2);
			expect(body.pairs).toHaveLength(2);
			expect(body.pairs[0].caller).toEqual({ name: "invoke", filePath: "src/callers.ts", line: 6 });
			expect(body.pairs[0].callee).toEqual({ name: "startServer", filePath: "src/target.ts" });
			expect(body.pairs[0].kind).toBe("call");
			// Grouped by caller symbol, caller kind resolved from codebase_symbols.
			expect(body.groupedByCaller).toHaveLength(1);
			expect(body.groupedByCaller[0].caller).toEqual({ name: "invoke", filePath: "src/callers.ts", kind: "Function" });
			expect(body.groupedByCaller[0].count).toBe(2);
		});

		it("filters pairs by reference kind", async () => {
			const res = await fetch(
				`${baseUrl}/api/codebase/symbol/callers?repo=test-owner/callers-repo&name=startServer&kind=call`
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.total).toBe(1);
			expect(body.pairs[0].kind).toBe("call");
		});

		it("returns 404 for an unknown symbol", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/symbol/callers?repo=test-owner/callers-repo&name=TotallyMadeUp`);
			expect(res.status).toBe(404);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("SYMBOL_NOT_FOUND");
		});
	});

	describe("symbol-callers disambiguation (TASK-373)", () => {
		// Seed runs ONCE (bulkUpsertSymbols is a plain INSERT — re-seeding
		// would violate the id PK).
		beforeAll(seedDuplicateRepo);

		it("returns 409 AMBIGUOUS_SYMBOL for duplicate names without filePath", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/symbol/callers?repo=test-owner/dup-repo&name=handleInit`);
			expect(res.status).toBe(409);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("AMBIGUOUS_SYMBOL");
			// Candidates listed deterministically (file_path:start_line).
			expect(body.error).toContain("src/a.ts:1");
			expect(body.error).toContain("src/b.ts:1");
		});

		it("scopes the symbol AND its pairs by filePath (src/a.ts)", async () => {
			const res = await fetch(
				`${baseUrl}/api/codebase/symbol/callers?repo=test-owner/dup-repo&name=handleInit&filePath=src/a.ts`
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.symbol.filePath).toBe("src/a.ts");
			// Pairs are scoped to the chosen definition too — the drilldown
			// node and its edges describe the SAME symbol.
			expect(body.total).toBe(1);
			expect(body.pairs[0].callee).toEqual({ name: "handleInit", filePath: "src/a.ts" });
		});

		it("scopes the symbol AND its pairs by filePath (src/b.ts)", async () => {
			const res = await fetch(
				`${baseUrl}/api/codebase/symbol/callers?repo=test-owner/dup-repo&name=handleInit&filePath=src/b.ts`
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.symbol.filePath).toBe("src/b.ts");
			expect(body.total).toBe(1);
			expect(body.pairs[0].callee).toEqual({ name: "handleInit", filePath: "src/b.ts" });
		});

		it("returns 404 when filePath has no symbol of that name", async () => {
			const res = await fetch(
				`${baseUrl}/api/codebase/symbol/callers?repo=test-owner/dup-repo&name=handleInit&filePath=src/nope.ts`
			);
			expect(res.status).toBe(404);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("SYMBOL_NOT_FOUND");
		});
	});

	describe("code-graph", () => {
		// Seed runs ONCE (bulkUpsertSymbols is a plain INSERT — re-seeding
		// would violate the id PK); the kind-filter tests share the fixture.
		beforeAll(seedGraphRepo);

		it("returns 400 when repo is missing", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/graph`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("MISSING_REPO");
		});

		it("returns 404 for an empty (unindexed) repo", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/graph?repo=test-owner/no-index-repo`);
			expect(res.status).toBe(404);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("REPO_NOT_INDEXED");
		});

		it("returns 400 for an invalid kind", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/graph?repo=test-owner/graph-repo&kind=bogus`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("INVALID_GRAPH_KIND");
		});

		it("returns degree-ranked nodes and call + co_defined edges", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/graph?repo=test-owner/graph-repo`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.nodes).toHaveLength(3);
			for (const node of body.nodes) {
				expect(node.id).toMatch(/^sym-/);
				expect(node.name).toBeDefined();
				expect(node.kind).toBeDefined();
				expect(node.filePath).toBeDefined();
				expect(typeof node.size).toBe("number");
				expect(typeof node.degree).toBe("number");
			}
			// Alpha←Gamma (call), Gamma←Beta (call), Alpha→Beta (co_defined).
			expect(body.edges).toHaveLength(3);
			const relationTypes = (body.edges as Array<{ relation_type: string }>).map((e) => e.relation_type).sort();
			expect(relationTypes).toEqual(["call", "call", "co_defined"]);
			for (const edge of body.edges) {
				expect(typeof edge.source).toBe("string");
				expect(typeof edge.target).toBe("string");
			}
			// All three symbols have reference degrees (Gamma=2, Alpha=1, Beta=1)
			// — none isolated.
			expect(body.truncated).toBe(false);
		});

		it("filters edges by kind=call", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/graph?repo=test-owner/graph-repo&kind=call`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.edges).toHaveLength(2);
			expect(body.edges.every((e: any) => e.relation_type === "call")).toBe(true);
		});

		it("filters edges by kind=import", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/graph?repo=test-owner/graph-repo&kind=import`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			// No import rows seeded — graph still shows the node universe
			// (file-order fallback when no edge-family degrees exist).
			expect(body.edges).toHaveLength(0);
			expect(body.nodes).toHaveLength(3);
		});

		it("filters edges by kind=co_defined", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/graph?repo=test-owner/graph-repo&kind=co_defined`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.edges).toHaveLength(1);
			expect(body.edges[0].relation_type).toBe("co_defined");
		});

		it("caps edges at CODE_GRAPH_MAX_EDGES and reports truncated", async () => {
			// CODE_GRAPH_MAX_EDGES is overridden to 10 for this file. A single
			// file with 12 symbols yields 11 co_defined edges > cap.
			const { db } = await import("../../dashboard/lib/context");
			db.codebaseFiles.upsertFile({
				repo: "graph-cap-repo",
				file_path: "src/big.ts",
				language: "typescript",
				checksum: "cap1",
				lines: 100,
				size_bytes: 400
			});
			db.codebaseSymbols.bulkUpsertSymbols(
				Array.from({ length: 12 }, (_, i) => ({
					id: `cap-sym-${i}`,
					repo: "graph-cap-repo",
					file_path: "src/big.ts",
					name: `Sym${i}`,
					kind: "Function",
					exported: true,
					default_export: false,
					start_line: i * 5 + 1,
					start_col: 0,
					end_line: i * 5 + 5,
					end_col: 1
				}))
			);

			const res = await fetch(`${baseUrl}/api/codebase/graph?repo=test-owner/graph-cap-repo`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.edges).toHaveLength(10);
			expect(body.truncated).toBe(true);
			expect(body.stats.edgeCap).toBe(10);
			expect(body.stats.totalSymbols).toBe(12);
		});
	});

	describe("code-graph heritage/import (caller_name null → span fallback, TASK-374)", () => {
		// Seed runs ONCE (bulkUpsertSymbols is a plain INSERT — re-seeding
		// would violate the id PK).
		beforeAll(seedHeritageRepo);

		it("resolves extends + module-scope import edges by span", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/graph?repo=test-owner/heritage-repo`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			// 2 reference edges (extends + import) + 1 same-file co_defined
			// chain (ChildService→NestedConfig).
			expect(body.edges).toHaveLength(3);
			const relationTypes = (body.edges as Array<{ relation_type: string }>).map((e) => e.relation_type).sort();
			expect(relationTypes).toEqual(["co_defined", "extends", "import"]);

			// extends: innermost symbol containing caller_line 7 = NestedConfig
			// (7-10 wins over the enclosing ChildService 5-30).
			const extendsEdge = (body.edges as any[]).find((e) => e.relation_type === "extends");
			expect(extendsEdge.source).toBe("sym-her-nested");
			expect(extendsEdge.target).toBe("sym-her-base");

			// import: caller_line 2 has no containing span → first top-level
			// symbol of src/child.ts = ChildService.
			const importEdge = (body.edges as any[]).find((e) => e.relation_type === "import");
			expect(importEdge.source).toBe("sym-her-child");
			expect(importEdge.target).toBe("sym-her-logger");
		});

		it("surfaces the module-scope import edge under kind=import", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/graph?repo=test-owner/heritage-repo&kind=import`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.edges).toHaveLength(1);
			expect(body.edges[0]).toEqual({
				source: "sym-her-child",
				target: "sym-her-logger",
				relation_type: "import"
			});
		});
	});

	describe("error handling", () => {
		it("returns structured error with code on bad request", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/architecture`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body).toHaveProperty("error");
			expect(body).toHaveProperty("code");
		});

		it("returns 404 for file not in index", async () => {
			// File not inserted → handler returns FILE_NOT_INDEXED
			const res = await fetch(`${baseUrl}/api/codebase/symbols?repo=test-owner/nonexist&filePath=src/nope.ts`);
			expect(res.status).toBe(404);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("FILE_NOT_INDEXED");
		});

		it("returns 404 for unknown symbol in trace", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/trace?name=TotallyMadeUpSymbol&repo=test-owner/nonexist`);
			expect(res.status).toBe(404);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("SYMBOL_NOT_FOUND");
		});

		it("returns 404 for POST to GET-only endpoint", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/architecture?repo=test/test`, {
				method: "POST"
			});
			// Express default: no POST route registered, returns default 404 HTML
			expect(res.status).toBe(404);
		});
	});
});
