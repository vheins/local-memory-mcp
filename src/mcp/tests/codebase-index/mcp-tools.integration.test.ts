/**
 * MCP Codebase-Read Integration Tests — unified handler covering
 * search_symbols, file, architecture, and trace modes.
 *
 * Uses an in-memory SQLiteStore seeded with fixture data via entity methods.
 * Tests handleCodebaseRead end-to-end (schema validation → mode inference →
 * entity lookup → service processing → response formatting).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { handleCodebaseRead } from "../../tools/codebase.read";
import { createTestStore, SQLiteStore } from "../../storage/sqlite";
import type { VectorStore } from "../../types";
import type { CodebaseSymbolInsert } from "../../types/codebase-symbol";
import type { CodebaseFileInsert } from "../../types/codebase-file";
import type { McpResponse } from "../../utils/mcp-response";

// ── Helpers ────────────────────────────────────────────────────────────────

function noopVectorStore(): VectorStore {
	return {
		async upsert(): Promise<void> {},
		async remove(): Promise<void> {},
		async search(): Promise<[]> {
			return [];
		}
	};
}

const REPO = "search-test";

// ── Test suite ─────────────────────────────────────────────────────────────

describe("handleCodebaseRead (integration)", () => {
	let store: SQLiteStore;
	let vectors: VectorStore;
	let tempDir: string;

	beforeAll(async () => {
		// ── 1. Create temp directory with fixture files ────────────────────
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-tools-int-"));

		const fixtureSrc = path.resolve(import.meta.dirname, "../fixtures/codebase-index/search-test-fixture");
		const destDir = path.join(tempDir, "search-test-fixture");
		copyDirSync(fixtureSrc, destDir);

		// ── 2. Initialize store ────────────────────────────────────────────
		store = await createTestStore();
		vectors = noopVectorStore();

		// ── 3. Insert file records ─────────────────────────────────────────
		const fileInserts: CodebaseFileInsert[] = [
			{ repo: REPO, file_path: "index.ts", language: "typescript", lines: 41, size_bytes: 900 },
			{ repo: REPO, file_path: "utils.ts", language: "typescript", lines: 38, size_bytes: 750 },
			{ repo: REPO, file_path: "types.ts", language: "typescript", lines: 45, size_bytes: 600 },
			{
				repo: REPO,
				file_path: "components/Button.tsx",
				language: "tsx",
				lines: 30,
				size_bytes: 700
			}
		];
		for (const f of fileInserts) {
			store.codebaseFiles.upsertFile(f);
		}

		// ── 4. Insert symbol records ───────────────────────────────────────
		const symbols: CodebaseSymbolInsert[] = [
			// index.ts
			{
				repo: REPO,
				file_path: "index.ts",
				name: "AppConfig",
				kind: "interface",
				exported: true,
				default_export: false,
				start_line: 6,
				start_col: 1,
				end_line: 11,
				end_col: 1,
				signature: "interface AppConfig",
				doc_comment: "Configuration for the application.",
				parent_symbol_id: null
			},
			{
				repo: REPO,
				file_path: "index.ts",
				name: "initializeApp",
				kind: "function",
				exported: true,
				default_export: false,
				start_line: 13,
				start_col: 1,
				end_line: 15,
				end_col: 1,
				signature: "function initializeApp(config: AppConfig): string",
				doc_comment: "Initialize the application with the given config.",
				parent_symbol_id: null
			},
			{
				repo: REPO,
				file_path: "index.ts",
				name: "Application",
				kind: "class",
				exported: true,
				default_export: false,
				start_line: 17,
				start_col: 1,
				end_line: 33,
				end_col: 1,
				signature: "class Application",
				doc_comment: "Main application class. Wraps start, getVersion, and isDebug utilities.",
				parent_symbol_id: null
			},
			{
				repo: REPO,
				file_path: "index.ts",
				name: "DEFAULT_CONFIG",
				kind: "variable",
				exported: true,
				default_export: false,
				start_line: 35,
				start_col: 1,
				end_line: 40,
				end_col: 2,
				signature: "const DEFAULT_CONFIG: AppConfig",
				doc_comment: null,
				parent_symbol_id: null
			},
			{
				repo: REPO,
				file_path: "index.ts",
				name: "createAppRunner",
				kind: "function",
				exported: true,
				default_export: false,
				start_line: 42,
				start_col: 1,
				end_line: 44,
				end_col: 1,
				signature: "function createAppRunner(config: AppConfig): () => string",
				doc_comment: null,
				parent_symbol_id: null
			},

			// utils.ts
			{
				repo: REPO,
				file_path: "utils.ts",
				name: "formatSize",
				kind: "function",
				exported: true,
				default_export: false,
				start_line: 5,
				start_col: 1,
				end_line: 9,
				end_col: 1,
				signature: "function formatSize(bytes: number): string",
				doc_comment: "Format byte count into a human-readable string.",
				parent_symbol_id: null
			},
			{
				repo: REPO,
				file_path: "utils.ts",
				name: "slugify",
				kind: "function",
				exported: true,
				default_export: false,
				start_line: 11,
				start_col: 1,
				end_line: 15,
				end_col: 1,
				signature: "function slugify(text: string): string",
				doc_comment: null,
				parent_symbol_id: null
			},
			{
				repo: REPO,
				file_path: "utils.ts",
				name: "clamp",
				kind: "function",
				exported: true,
				default_export: false,
				start_line: 17,
				start_col: 1,
				end_line: 19,
				end_col: 1,
				signature: "function clamp(value: number, min: number, max: number): number",
				doc_comment: null,
				parent_symbol_id: null
			},
			{
				repo: REPO,
				file_path: "utils.ts",
				name: "Result",
				kind: "type",
				exported: true,
				default_export: false,
				start_line: 21,
				start_col: 1,
				end_line: 23,
				end_col: 2,
				signature: "type Result<T> = { ok: true; value: T } | { ok: false; error: string }",
				doc_comment: null,
				parent_symbol_id: null
			},
			{
				repo: REPO,
				file_path: "utils.ts",
				name: "safeParseJSON",
				kind: "function",
				exported: true,
				default_export: false,
				start_line: 25,
				start_col: 1,
				end_line: 31,
				end_col: 1,
				signature: "function safeParseJSON<T>(json: string): Result<T>",
				doc_comment: null,
				parent_symbol_id: null
			},
			{
				repo: REPO,
				file_path: "utils.ts",
				name: "delay",
				kind: "function",
				exported: true,
				default_export: false,
				start_line: 33,
				start_col: 1,
				end_line: 35,
				end_col: 1,
				signature: "function delay(ms: number): Promise<void>",
				doc_comment: null,
				parent_symbol_id: null
			},

			// types.ts
			{
				repo: REPO,
				file_path: "types.ts",
				name: "User",
				kind: "interface",
				exported: true,
				default_export: false,
				start_line: 5,
				start_col: 1,
				end_line: 11,
				end_col: 1,
				signature: "interface User",
				doc_comment: "User entity with role-based access.",
				parent_symbol_id: null
			},
			{
				repo: REPO,
				file_path: "types.ts",
				name: "UserRole",
				kind: "type",
				exported: true,
				default_export: false,
				start_line: 13,
				start_col: 1,
				end_line: 13,
				end_col: 47,
				signature: "type UserRole",
				doc_comment: null,
				parent_symbol_id: null
			},
			{
				repo: REPO,
				file_path: "types.ts",
				name: "SearchResult",
				kind: "interface",
				exported: true,
				default_export: false,
				start_line: 15,
				start_col: 1,
				end_line: 21,
				end_col: 1,
				signature: "interface SearchResult<T>",
				doc_comment: "Generic search result wrapper.",
				parent_symbol_id: null
			},
			{
				repo: REPO,
				file_path: "types.ts",
				name: "PaginationParams",
				kind: "interface",
				exported: true,
				default_export: false,
				start_line: 23,
				start_col: 1,
				end_line: 28,
				end_col: 1,
				signature: "interface PaginationParams",
				doc_comment: null,
				parent_symbol_id: null
			},
			{
				repo: REPO,
				file_path: "types.ts",
				name: "SearchQuery",
				kind: "type",
				exported: true,
				default_export: false,
				start_line: 30,
				start_col: 1,
				end_line: 34,
				end_col: 2,
				signature: "type SearchQuery",
				doc_comment: null,
				parent_symbol_id: null
			},
			{
				repo: REPO,
				file_path: "types.ts",
				name: "Status",
				kind: "enum",
				exported: true,
				default_export: false,
				start_line: 36,
				start_col: 1,
				end_line: 40,
				end_col: 1,
				signature: "enum Status",
				doc_comment: null,
				parent_symbol_id: null
			},
			{
				repo: REPO,
				file_path: "types.ts",
				name: "AuditEntry",
				kind: "interface",
				exported: true,
				default_export: false,
				start_line: 42,
				start_col: 1,
				end_line: 48,
				end_col: 1,
				signature: "interface AuditEntry",
				doc_comment: null,
				parent_symbol_id: null
			},

			// components/Button.tsx
			{
				repo: REPO,
				file_path: "components/Button.tsx",
				name: "ButtonProps",
				kind: "interface",
				exported: true,
				default_export: false,
				start_line: 3,
				start_col: 1,
				end_line: 8,
				end_col: 1,
				signature: "interface ButtonProps",
				doc_comment: null,
				parent_symbol_id: null
			},
			{
				repo: REPO,
				file_path: "components/Button.tsx",
				name: "Button",
				kind: "function",
				exported: true,
				default_export: false,
				start_line: 10,
				start_col: 1,
				end_line: 27,
				end_col: 1,
				signature: "function Button({ label, variant, disabled, onClick }: ButtonProps)",
				doc_comment: "A reusable button component with SubmitButton and DangerButton variants.",
				parent_symbol_id: null
			},
			{
				repo: REPO,
				file_path: "components/Button.tsx",
				name: "SubmitButton",
				kind: "function",
				exported: true,
				default_export: false,
				start_line: 29,
				start_col: 1,
				end_line: 31,
				end_col: 1,
				signature: "function SubmitButton({ onClick }: { onClick: () => void })",
				doc_comment: null,
				parent_symbol_id: null
			},
			{
				repo: REPO,
				file_path: "components/Button.tsx",
				name: "DangerButton",
				kind: "function",
				exported: true,
				default_export: false,
				start_line: 33,
				start_col: 1,
				end_line: 35,
				end_col: 1,
				signature: "function DangerButton({ label, onClick }: { label: string; onClick: () => void })",
				doc_comment: null,
				parent_symbol_id: null
			}
		];

		store.codebaseSymbols.bulkUpsertSymbols(symbols);
	});

	afterAll(() => {
		store.close();
		if (tempDir && fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	// ── Helper to extract structuredContent from response ───────────────

	function data(resp: McpResponse): Record<string, unknown> {
		return resp.structuredContent as Record<string, unknown>;
	}

	// ═══════════════════════════════════════════════════════════════════════
	// codebase-read: search_symbols mode (via single-term query)
	// ═══════════════════════════════════════════════════════════════════════

	describe("handleCodebaseRead (search_symbols mode)", () => {
		it("returns correct symbol for exact name match", async () => {
			const resp = await handleCodebaseRead({ owner: "vheins", query: "initializeApp", repo: REPO }, store, vectors);
			const d = data(resp);
			const symbols = d.symbols as Array<Record<string, unknown>>;

			expect(symbols.length).toBe(1);
			expect(symbols[0].name).toBe("initializeApp");
			expect(symbols[0].kind).toBe("function");
			expect(symbols[0].rankTier).toBe(1); // RankTier.Exact
		});

		it("returns multiple ranked results for prefix query", async () => {
			const resp = await handleCodebaseRead({ owner: "vheins", query: "App", repo: REPO }, store, vectors);
			const d = data(resp);
			const symbols = d.symbols as Array<Record<string, unknown>>;

			// Should match: AppConfig, Application (prefix match)
			expect(symbols.length).toBeGreaterThanOrEqual(2);

			// Exact matches (Application, AppConfig) should be top-tier
			const names = symbols.map((s) => s.name);
			expect(names).toContain("Application");
			expect(names).toContain("AppConfig");

			const appResult = symbols.find((s) => s.name === "Application");
			expect(appResult).toBeDefined();
			expect(appResult!.rankTier).toBeLessThanOrEqual(3); // Exact or Prefix
		});

		it("kind filter returns only matching kind", async () => {
			const resp = await handleCodebaseRead(
				{ owner: "vheins", query: "form", repo: REPO, kind: "function" },
				store,
				vectors
			);
			const d = data(resp);
			const symbols = d.symbols as Array<Record<string, unknown>>;

			expect(symbols.length).toBeGreaterThanOrEqual(1);
			for (const s of symbols) {
				expect(s.kind).toBe("function");
			}
		});

		it("returns empty result for non-existent symbol", async () => {
			const resp = await handleCodebaseRead(
				{ owner: "vheins", query: "zzzNonexistentSymbol", repo: REPO },
				store,
				vectors
			);
			const d = data(resp);

			expect(d.symbols).toEqual([]);
			expect(d.total).toBe(0);
			expect(d.hasMore).toBe(false);
		});

		it("pagination: limit + offset works correctly", async () => {
			// Get page 1: limit 3
			const page1 = await handleCodebaseRead(
				{ owner: "vheins", query: "a", repo: REPO, limit: 3, offset: 0 },
				store,
				vectors
			);
			const d1 = data(page1);
			const symbols1 = d1.symbols as Array<Record<string, unknown>>;
			expect(symbols1.length).toBeLessThanOrEqual(3);

			// Get page 2: offset 3, limit 3
			const page2 = await handleCodebaseRead(
				{ owner: "vheins", query: "a", repo: REPO, limit: 3, offset: 3 },
				store,
				vectors
			);
			const d2 = data(page2);
			const symbols2 = d2.symbols as Array<Record<string, unknown>>;
			expect(symbols2.length).toBeLessThanOrEqual(3);

			// Pages should not overlap
			const page1Names = new Set(symbols1.map((s) => s.id));
			const page2Names = symbols2.map((s) => s.id);
			for (const id of page2Names) {
				expect(page1Names.has(id)).toBe(false);
			}

			// Both pages should share the same total
			expect(d1.total).toBe(d2.total);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// codebase-read: file mode (via filePath)
	// ═══════════════════════════════════════════════════════════════════════

	describe("handleCodebaseRead (file mode)", () => {
		it("returns all symbols in a known file", async () => {
			const resp = await handleCodebaseRead({ owner: "vheins", repo: REPO, filePath: "index.ts" }, store, vectors);
			const d = data(resp);

			expect(d.error).toBeUndefined();
			expect(d.file).toBeDefined();
			const file = d.file as Record<string, unknown>;
			expect(file.path).toBe("index.ts");
			expect(file.language).toBe("typescript");

			const symbols = d.symbols as Array<Record<string, unknown>>;
			expect(symbols.length).toBe(5);

			const names = symbols.map((s) => s.name);
			expect(names).toContain("AppConfig");
			expect(names).toContain("initializeApp");
			expect(names).toContain("Application");
			expect(names).toContain("DEFAULT_CONFIG");
			expect(names).toContain("createAppRunner");
		});

		it("returns symbols in declaration order (by start_line)", async () => {
			const resp = await handleCodebaseRead({ owner: "vheins", repo: REPO, filePath: "index.ts" }, store, vectors);
			const d = data(resp);
			const symbols = d.symbols as Array<Record<string, unknown>>;

			// Symbols should be ordered by start_line ASC
			expect(symbols[0].name).toBe("AppConfig"); // line 6
			expect(symbols[1].name).toBe("initializeApp"); // line 13
			expect(symbols[2].name).toBe("Application"); // line 17
			expect(symbols[3].name).toBe("DEFAULT_CONFIG"); // line 35
			expect(symbols[4].name).toBe("createAppRunner"); // line 42
		});

		it("returns error for non-indexed file", async () => {
			const resp = await handleCodebaseRead(
				{ owner: "vheins", repo: REPO, filePath: "nonexistent.ts" },
				store,
				vectors
			);
			const d = data(resp);

			expect(d.error).toBe("File not indexed. Run index_repository first.");
			expect(d.code).toBe("FILE_NOT_INDEXED");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// codebase-read: architecture mode (via depth)
	// ═══════════════════════════════════════════════════════════════════════

	describe("handleCodebaseRead (architecture mode)", () => {
		it("returns directory tree with correct depth", async () => {
			const resp = await handleCodebaseRead({ owner: "vheins", repo: REPO, depth: 2 }, store, vectors);
			const d = data(resp);

			// Root
			expect(d.root).toBeDefined();
			const root = d.root as Record<string, unknown>;
			expect(root.name).toBe(".");
			expect(root.type).toBe("directory");

			const children = root.children as Array<Record<string, unknown>>;
			expect(children.length).toBeGreaterThanOrEqual(4); // 3 root files + components/

			// Root-level files should be present
			const fileNames = children.filter((c) => c.type === "file").map((c) => c.name);
			expect(fileNames).toContain("index.ts");
			expect(fileNames).toContain("utils.ts");
			expect(fileNames).toContain("types.ts");

			// components/ directory should be expanded at depth 2
			const compDir = children.find((c) => c.name === "components");
			expect(compDir).toBeDefined();
			expect(compDir!.type).toBe("directory");
			expect(compDir!.children).toBeDefined();
		});

		it("symbol counts are accurate", async () => {
			const resp = await handleCodebaseRead({ owner: "vheins", repo: REPO, depth: 2 }, store, vectors);
			const d = data(resp);

			const summary = d.summary as Record<string, unknown>;
			expect(summary.totalFiles).toBe(4);
			expect(summary.totalSymbols).toBe(22);

			// Top-level exports (exported + no parent) = all exported symbols
			const topExports = summary.topLevelExports as Array<Record<string, unknown>>;
			expect(topExports.length).toBeGreaterThan(0);
		});

		it("language breakdown shows TypeScript and TSX", async () => {
			const resp = await handleCodebaseRead({ owner: "vheins", repo: REPO, depth: 2 }, store, vectors);
			const d = data(resp);

			const summary = d.summary as Record<string, unknown>;
			const langBreakdown = summary.languageBreakdown as Record<string, number>;

			expect(langBreakdown["typescript"]).toBe(3);
			expect(langBreakdown["tsx"]).toBe(1);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// codebase-read: trace mode (via name)
	// ═══════════════════════════════════════════════════════════════════════

	describe("handleCodebaseRead (trace mode)", () => {
		it("returns definition for a known exported function", async () => {
			const resp = await handleCodebaseRead({ owner: "vheins", name: "formatSize", repo: REPO }, store, vectors);
			const d = data(resp);

			expect(d.symbol).toBeDefined();
			const symbol = d.symbol as Record<string, unknown>;
			expect(symbol.name).toBe("formatSize");
			expect(symbol.kind).toBe("function");

			const definition = d.definition as Record<string, unknown>;
			expect(definition.file).toBe("utils.ts");
			expect(definition.line).toBe(5);

			const exportChain = d.exportChain as Record<string, unknown>;
			expect(exportChain.exported).toBe(true);
			expect(exportChain.defaultExport).toBe(false);
		});

		it("returns disambiguation for ambiguous names", async () => {
			// Insert a second symbol with name "Button" in a different file
			store.codebaseSymbols.bulkUpsertSymbols([
				{
					repo: REPO,
					file_path: "types.ts",
					name: "Button",
					kind: "type",
					exported: true,
					default_export: false,
					start_line: 50,
					start_col: 1,
					end_line: 50,
					end_col: 9,
					signature: "type Button = string",
					doc_comment: null,
					parent_symbol_id: null
				}
			]);

			const resp = await handleCodebaseRead({ owner: "vheins", name: "Button", repo: REPO }, store, vectors);
			const d = data(resp);

			expect(d.code).toBe("AMBIGUOUS_SYMBOL");
			expect(d.disambiguation).toBeDefined();
			const disamb = d.disambiguation as Array<Record<string, unknown>>;
			expect(disamb.length).toBe(2);

			const names = disamb.map((s) => s.name);
			expect(names).toEqual(["Button", "Button"]);

			// Clean up the duplicate
			store.codebaseSymbols.deleteSymbolsByFile(REPO, "types.ts");
			// Re-insert the original types.ts symbols
			store.codebaseSymbols.bulkUpsertSymbols([
				{
					repo: REPO,
					file_path: "types.ts",
					name: "User",
					kind: "interface",
					exported: true,
					default_export: false,
					start_line: 5,
					start_col: 1,
					end_line: 11,
					end_col: 1,
					signature: "interface User",
					doc_comment: "User entity with role-based access.",
					parent_symbol_id: null
				},
				{
					repo: REPO,
					file_path: "types.ts",
					name: "UserRole",
					kind: "type",
					exported: true,
					default_export: false,
					start_line: 13,
					start_col: 1,
					end_line: 13,
					end_col: 47,
					signature: "type UserRole",
					doc_comment: null,
					parent_symbol_id: null
				},
				{
					repo: REPO,
					file_path: "types.ts",
					name: "SearchResult",
					kind: "interface",
					exported: true,
					default_export: false,
					start_line: 15,
					start_col: 1,
					end_line: 21,
					end_col: 1,
					signature: "interface SearchResult<T>",
					doc_comment: "Generic search result wrapper.",
					parent_symbol_id: null
				},
				{
					repo: REPO,
					file_path: "types.ts",
					name: "PaginationParams",
					kind: "interface",
					exported: true,
					default_export: false,
					start_line: 23,
					start_col: 1,
					end_line: 28,
					end_col: 1,
					signature: "interface PaginationParams",
					doc_comment: null,
					parent_symbol_id: null
				},
				{
					repo: REPO,
					file_path: "types.ts",
					name: "SearchQuery",
					kind: "type",
					exported: true,
					default_export: false,
					start_line: 30,
					start_col: 1,
					end_line: 34,
					end_col: 2,
					signature: "type SearchQuery",
					doc_comment: null,
					parent_symbol_id: null
				},
				{
					repo: REPO,
					file_path: "types.ts",
					name: "Status",
					kind: "enum",
					exported: true,
					default_export: false,
					start_line: 36,
					start_col: 1,
					end_line: 40,
					end_col: 1,
					signature: "enum Status",
					doc_comment: null,
					parent_symbol_id: null
				},
				{
					repo: REPO,
					file_path: "types.ts",
					name: "AuditEntry",
					kind: "interface",
					exported: true,
					default_export: false,
					start_line: 42,
					start_col: 1,
					end_line: 48,
					end_col: 1,
					signature: "interface AuditEntry",
					doc_comment: null,
					parent_symbol_id: null
				}
			]);
		});

		it("returns error for non-existent symbol", async () => {
			const resp = await handleCodebaseRead({ owner: "vheins", name: "zzzNonexistentFn", repo: REPO }, store, vectors);
			const d = data(resp);

			expect(d.code).toBe("SYMBOL_NOT_FOUND");
			expect(d.error).toBeDefined();
			expect(d.error).toContain("not found");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// codebase-read: code mode (via content — TASK-316)
	// ═══════════════════════════════════════════════════════════════════════

	describe("handleCodebaseRead (code mode)", () => {
		const CODE_REPO = "code-mode-test";
		const CODE_FILE = "code-fixture.ts";

		beforeAll(async () => {
			// Fixture file on disk, indexed with ACCURATE symbol spans so the
			// enrichment assertions are exact.
			const content =
				[
					"/**",
					" * Code search fixture.",
					" */",
					"export function greet(name: string): string {",
					"\treturn `Hello, ${name}!`;",
					"}",
					"",
					"export class Greeter {",
					"\tprivate name: string;",
					"",
					"\tconstructor(name: string) {",
					"\t\tthis.name = name;",
					"\t}",
					"",
					"\tpublic greet(): string {",
					"\t\treturn greet(this.name);",
					"\t}",
					"}"
				].join("\n") + "\n";
			fs.writeFileSync(path.join(tempDir, CODE_FILE), content, "utf-8");
			store.codebaseFiles.upsertFile({
				repo: CODE_REPO,
				file_path: CODE_FILE,
				language: "typescript",
				checksum: "code-fixture-sum",
				lines: content.split("\n").length,
				size_bytes: Buffer.byteLength(content, "utf-8")
			});
			store.codebaseSymbols.bulkUpsertSymbols([
				{
					repo: CODE_REPO,
					file_path: CODE_FILE,
					name: "greet",
					kind: "function",
					exported: true,
					start_line: 4,
					end_line: 6
				},
				{
					repo: CODE_REPO,
					file_path: CODE_FILE,
					name: "Greeter",
					kind: "class",
					exported: true,
					start_line: 8,
					end_line: 18
				}
			]);
		});

		it("greps indexed file contents with enclosing-symbol enrichment", async () => {
			const resp = await handleCodebaseRead(
				{ owner: "vheins", repo: CODE_REPO, content: "greet", repoPath: tempDir },
				store,
				vectors
			);
			const d = data(resp);

			expect(d.error).toBeUndefined();
			expect(d.mode).toBe("code");
			expect(d.content).toBe("greet");

			const matches = d.matches as Array<Record<string, unknown>>;
			// Lines 4 (fn decl), 8 ("Greeter"), 15 (method), 16 (call).
			expect(matches).toHaveLength(4);
			expect(d.total).toBe(4);
			expect(d.hasMore).toBe(false);
			expect(d.filesScanned).toBe(1);
			expect(d.indexedFiles).toBe(1);

			const byLine = new Map<number, Record<string, unknown>>(matches.map((m) => [m.line as number, m]));
			expect(byLine.get(4)!.enclosingSymbol).toEqual({
				name: "greet",
				kind: "function",
				startLine: 4,
				endLine: 6
			});
			expect(byLine.get(16)!.enclosingSymbol).toEqual({
				name: "Greeter",
				kind: "class",
				startLine: 8,
				endLine: 18
			});
			for (const m of matches) {
				expect(m.filePath).toBe(CODE_FILE);
				expect(m.language).toBe("typescript");
				expect(typeof m.snippet).toBe("string");
				expect((m.snippet as string).length).toBeGreaterThan(0);
				expect(typeof m.matchIndex).toBe("number");
				expect(m.line as number).toBeGreaterThan(0);
			}
		});

		it("respects the language filter (no files of that language → empty result)", async () => {
			const resp = await handleCodebaseRead(
				{ owner: "vheins", repo: CODE_REPO, content: "greet", language: "markdown", repoPath: tempDir },
				store,
				vectors
			);
			const d = data(resp);

			expect(d.error).toBeUndefined();
			expect(d.mode).toBe("code");
			expect(d.matches).toEqual([]);
			expect(d.total).toBe(0);
		});

		it("applies the code-mode default limit and pagination", async () => {
			const resp = await handleCodebaseRead(
				{ owner: "vheins", repo: CODE_REPO, content: "greet", limit: 2, repoPath: tempDir },
				store,
				vectors
			);
			const d = data(resp);

			expect(d.error).toBeUndefined();
			expect((d.matches as unknown[]).length).toBe(2);
			expect(d.limit).toBe(2);
			expect(d.hasMore).toBe(true);
		});

		it("empty content is a no-op (code mode, empty result — never a full dump)", async () => {
			const resp = await handleCodebaseRead(
				{ owner: "vheins", repo: CODE_REPO, content: "", repoPath: tempDir },
				store,
				vectors
			);
			const d = data(resp);

			expect(d.mode).toBe("code");
			expect(d.matches).toEqual([]);
			expect(d.total).toBe(0);
		});

		it("missing repoPath → REPO_PATH_REQUIRED", async () => {
			const resp = await handleCodebaseRead({ owner: "vheins", repo: CODE_REPO, content: "greet" }, store, vectors);
			const d = data(resp);

			expect(d.code).toBe("REPO_PATH_REQUIRED");
			expect(d.error).toBeDefined();
		});

		it("non-existent repoPath → REPO_PATH_NOT_FOUND", async () => {
			const resp = await handleCodebaseRead(
				{ owner: "vheins", repo: CODE_REPO, content: "greet", repoPath: path.join(tempDir, "does-not-exist") },
				store,
				vectors
			);
			const d = data(resp);

			expect(d.code).toBe("REPO_PATH_NOT_FOUND");
		});

		it("unindexed repo → REPO_NOT_INDEXED", async () => {
			const resp = await handleCodebaseRead(
				{ owner: "vheins", repo: "never-indexed", content: "x", repoPath: tempDir },
				store,
				vectors
			);
			const d = data(resp);

			expect(d.code).toBe("REPO_NOT_INDEXED");
		});

		it("invalid regex → INVALID_REGEX", async () => {
			const resp = await handleCodebaseRead(
				{ owner: "vheins", repo: CODE_REPO, content: "[", regex: true, repoPath: tempDir },
				store,
				vectors
			);
			const d = data(resp);

			expect(d.code).toBe("INVALID_REGEX");
		});
	});
});

// ── Utility: recursive directory copy ──────────────────────────────────────

function copyDirSync(src: string, dest: string): void {
	fs.mkdirSync(dest, { recursive: true });
	const entries = fs.readdirSync(src, { withFileTypes: true });
	for (const entry of entries) {
		const srcPath = path.join(src, entry.name);
		const destPath = path.join(dest, entry.name);
		if (entry.isDirectory()) {
			copyDirSync(srcPath, destPath);
		} else {
			fs.copyFileSync(srcPath, destPath);
		}
	}
}
