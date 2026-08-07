/**
 * codebase-read Trace Mode Tests.
 *
 * Tests handleCodebaseRead with name parameter (trace mode),
 * covering definition lookup, disambiguation, error cases,
 * and references inclusion/exclusion.
 *
 * Also includes pure unit tests for traceService functions
 * (SymbolNotFoundError, extractContext fallback, empty references).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { handleCodebaseRead } from "../../tools/codebase.read";
import { traceSymbol, SymbolNotFoundError, AmbiguousSymbolError } from "../../codebase-index/services/trace-service";
import { createTestStore, SQLiteStore } from "../../storage/sqlite";
import { VectorStore } from "../../types";
import type { CodebaseSymbol } from "../../types/codebase-symbol";

// ── No-op vector store ──────────────────────────────────────────────────

function noopVectorStore(): VectorStore {
	return {
		async upsert(): Promise<void> {},
		async remove(): Promise<void> {},
		async search(): Promise<[]> {
			return [];
		}
	};
}

// ── Symbol factory (pure unit tests) ────────────────────────────────────

function makeSym(overrides: Partial<CodebaseSymbol> & Pick<CodebaseSymbol, "name" | "file_path">): CodebaseSymbol {
	return {
		id: `sym-${overrides.name}-${Math.random().toString(36).slice(2, 6)}`,
		repo: "test-repo",
		kind: "function",
		exported: false,
		default_export: false,
		start_line: 1,
		start_col: 0,
		end_line: 1,
		end_col: 10,
		signature: null,
		doc_comment: null,
		parent_symbol_id: null,
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		...overrides
	};
}

// ════════════════════════════════════════════════════════════════════════
// Pure unit tests — traceService functions (no DB)
// ════════════════════════════════════════════════════════════════════════

describe("traceSymbol (pure unit)", () => {
	it("SymbolNotFoundError has correct name and message", () => {
		const err = new SymbolNotFoundError("foo", "my/repo");
		expect(err.name).toBe("SymbolNotFoundError");
		expect(err.message).toContain('"foo"');
		expect(err.message).toContain('"my/repo"');
	});

	it("SymbolNotFoundError without repo", () => {
		const err = new SymbolNotFoundError("bar");
		expect(err.message).toContain('"bar"');
		expect(err.message).not.toContain("repo");
	});

	it("AmbiguousSymbolError has disambiguation array", () => {
		const sym1 = makeSym({ name: "dup", file_path: "a.ts" });
		const sym2 = makeSym({ name: "dup", file_path: "b.ts" });
		const err = new AmbiguousSymbolError("dup", [sym1, sym2], "my/repo");
		expect(err.name).toBe("AmbiguousSymbolError");
		expect(err.disambiguation).toHaveLength(2);
		expect(err.message).toContain("2 matches");
	});

	it("references: checks signature for symbol name", () => {
		const target = makeSym({ name: "connect", file_path: "src/db.ts", exported: true });
		const ref = makeSym({
			name: "initDb",
			file_path: "src/app.ts",
			id: "ref-1",
			signature: "function initDb(connection: typeof connect)"
		});

		const result = traceSymbol("connect", "test/repo", [target, ref], true);
		expect(result.references.length).toBeGreaterThanOrEqual(1);
		expect(result.references[0].filePath).toBe("src/app.ts");
	});

	it("references: excludes self from references", () => {
		const target = makeSym({
			name: "selfRef",
			file_path: "src/a.ts",
			doc_comment: "Uses selfRef internally"
		});

		const result = traceSymbol("selfRef", undefined, [target], true);
		expect(result.references).toEqual([]);
	});

	it("extractContext: falls back to first line when search not found", () => {
		const target = makeSym({ name: "targetFn", file_path: "src/a.ts", exported: true });
		const ref = makeSym({
			name: "otherFn",
			file_path: "src/b.ts",
			id: "ref-2",
			doc_comment: "Some unrelated documentation",
			signature: "function otherFn(target: typeof targetFn)"
		});

		const result = traceSymbol("targetFn", "test/repo", [target, ref], true);
		expect(result.references.length).toBeGreaterThanOrEqual(1);
		const refEntry = result.references.find((r) => r.filePath === "src/b.ts");
		expect(refEntry).toBeDefined();
		expect(refEntry!.context).toContain("targetFn");
	});

	it("returns empty references when includeReferences is false", () => {
		const target = makeSym({ name: "noRefs", file_path: "src/x.ts", exported: true });
		const other = makeSym({
			name: "useNoRefs",
			file_path: "src/y.ts",
			doc_comment: "calls noRefs"
		});

		const result = traceSymbol("noRefs", undefined, [target, other], false);
		expect(result.references).toEqual([]);
	});
});

// ── Helpers ─────────────────────────────────────────────────────────────

function seedSymbols(
	store: SQLiteStore,
	symbols: Array<{
		repo: string;
		file_path: string;
		name: string;
		kind: string;
		exported?: boolean;
		default_export?: boolean;
		start_line?: number;
		start_col?: number;
		end_line?: number;
		end_col?: number;
		doc_comment?: string;
		signature?: string;
		parent_symbol_id?: string;
	}>
): void {
	store.codebaseSymbols.bulkUpsertSymbols(symbols);
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("handleCodebaseRead (trace mode)", () => {
	let store: SQLiteStore;
	let vectors: VectorStore;
	const repo = "test-repo";

	beforeEach(async () => {
		store = await createTestStore();
		vectors = noopVectorStore();
	});

	it("returns definition for a known symbol", async () => {
		seedSymbols(store, [
			{
				repo,
				file_path: "src/services/auth.ts",
				name: "authenticate",
				kind: "function",
				exported: true,
				default_export: false,
				start_line: 42,
				start_col: 0,
				end_line: 55,
				end_col: 1,
				signature: "function authenticate(token: string): User"
			}
		]);

		const response = await handleCodebaseRead({ name: "authenticate", repo, owner: "vheins" }, store, vectors);
		const data = response.structuredContent as Record<string, unknown>;

		expect(data.error).toBeUndefined();
		expect(data.symbol).toBeDefined();
		expect((data.symbol as Record<string, unknown>).name).toBe("authenticate");
		expect(data.definition).toEqual({
			file: "src/services/auth.ts",
			line: 42,
			column: 0,
			endLine: 55,
			endColumn: 1
		});
		expect(data.exportChain).toEqual({
			exported: true,
			defaultExport: false
		});
	});

	it("returns disambiguation for ambiguous names", async () => {
		seedSymbols(store, [
			{
				repo,
				file_path: "src/services/auth.ts",
				name: "authenticate",
				kind: "function",
				exported: true,
				start_line: 42,
				start_col: 0,
				doc_comment: "Authenticate a user token"
			},
			{
				repo,
				file_path: "src/legacy/auth.ts",
				name: "authenticate",
				kind: "function",
				exported: false,
				start_line: 10,
				start_col: 0,
				doc_comment: "Legacy authentication"
			}
		]);

		const response = await handleCodebaseRead({ name: "authenticate", repo, owner: "vheins" }, store, vectors);
		const data = response.structuredContent as Record<string, unknown>;

		expect(data.error).toBeDefined();
		expect(data.code).toBe("AMBIGUOUS_SYMBOL");

		const disamb = data.disambiguation as Array<Record<string, unknown>>;
		expect(disamb.length).toBe(2);
		expect(disamb.map((s) => s.file)).toContain("src/services/auth.ts");
		expect(disamb.map((s) => s.file)).toContain("src/legacy/auth.ts");
	});

	it("returns error for non-existent symbol", async () => {
		seedSymbols(store, [
			{
				repo,
				file_path: "src/services/auth.ts",
				name: "authenticate",
				kind: "function",
				start_line: 42,
				start_col: 0
			}
		]);

		const response = await handleCodebaseRead({ name: "nonexistent", repo, owner: "vheins" }, store, vectors);
		const data = response.structuredContent as Record<string, unknown>;

		expect(data.error).toContain("nonexistent");
		expect(data.code).toBe("SYMBOL_NOT_FOUND");
	});

	it("references included when flag is true", async () => {
		seedSymbols(store, [
			{
				repo,
				file_path: "src/services/auth.ts",
				name: "authenticate",
				kind: "function",
				exported: true,
				start_line: 42,
				start_col: 0,
				doc_comment: "Main authentication function"
			},
			{
				repo,
				file_path: "src/middleware/auth-middleware.ts",
				name: "authMiddleware",
				kind: "function",
				start_line: 15,
				start_col: 0,
				doc_comment: "Middleware that uses authenticate for request validation"
			},
			{
				repo,
				file_path: "src/services/session.ts",
				name: "refreshSession",
				kind: "function",
				start_line: 80,
				start_col: 0,
				signature: "function refreshSession(auth: typeof authenticate)"
			}
		]);

		const response = await handleCodebaseRead(
			{ name: "authenticate", repo, owner: "vheins", includeReferences: true },
			store,
			vectors
		);
		const data = response.structuredContent as Record<string, unknown>;

		expect(data.error).toBeUndefined();
		expect(data.symbol).toBeDefined();

		const refs = data.references as Array<Record<string, unknown>>;
		expect(refs.length).toBeGreaterThanOrEqual(1);

		// At least one reference from auth-middleware.ts doc comment
		const middlewareRef = refs.find((r) => r.filePath === "src/middleware/auth-middleware.ts");
		expect(middlewareRef).toBeDefined();
		expect(middlewareRef!.context).toContain("authenticate");
	});

	it("references excluded when flag is false", async () => {
		seedSymbols(store, [
			{
				repo,
				file_path: "src/services/auth.ts",
				name: "authenticate",
				kind: "function",
				exported: true,
				start_line: 42,
				start_col: 0,
				doc_comment: "Main authentication function"
			},
			{
				repo,
				file_path: "src/middleware/auth-middleware.ts",
				name: "authMiddleware",
				kind: "function",
				start_line: 15,
				start_col: 0,
				doc_comment: "Middleware that uses authenticate for request validation"
			}
		]);

		const response = await handleCodebaseRead(
			{ name: "authenticate", repo, owner: "vheins", includeReferences: false },
			store,
			vectors
		);
		const data = response.structuredContent as Record<string, unknown>;

		expect(data.error).toBeUndefined();
		expect(data.symbol).toBeDefined();

		const refs = data.references as Array<unknown>;
		expect(refs).toEqual([]);
	});

	// ══════════════════════════════════════════════════════════════════
	// Table-backed call-site references (TASK-236 / issue #64)
	// ══════════════════════════════════════════════════════════════════

	it("returns stored call-site references alongside the definition", async () => {
		// Definition seeded in codebase_symbols.
		seedSymbols(store, [
			{
				repo,
				file_path: "src/services/auth.ts",
				name: "authenticate",
				kind: "function",
				exported: true,
				start_line: 42,
				start_col: 0,
				end_line: 55,
				end_col: 1,
				signature: "function authenticate(token: string): User"
			}
		]);

		// Two call sites stored in codebase_references via the parse pipeline.
		store.codebaseReferences.bulkUpsertReferences(repo, [
			{
				repo,
				symbol_name: "authenticate",
				caller_file: "src/middleware/guard.ts",
				caller_line: 14,
				caller_name: "guardRequest",
				kind: "call"
			},
			{
				repo,
				symbol_name: "authenticate",
				caller_file: "src/services/session.ts",
				caller_line: 88,
				caller_name: "refreshSession",
				kind: "call"
			}
		]);

		const response = await handleCodebaseRead(
			{ name: "authenticate", repo, owner: "vheins", includeReferences: true },
			store,
			vectors
		);
		const data = response.structuredContent as Record<string, unknown>;

		expect(data.error).toBeUndefined();
		expect((data.symbol as Record<string, unknown>).name).toBe("authenticate");
		expect(data.definition).toMatchObject({ file: "src/services/auth.ts", line: 42 });

		const refs = data.references as Array<Record<string, unknown>>;
		// Exactly the two stored call sites (definition excluded from references).
		expect(refs.map((r) => r.filePath).sort()).toEqual(["src/middleware/guard.ts", "src/services/session.ts"]);
		const guard = refs.find((r) => r.filePath === "src/middleware/guard.ts")!;
		expect(guard.startLine).toBe(14);
		expect(guard.kind).toBe("call");
		expect(guard.callerName).toBe("guardRequest");
	});
});
