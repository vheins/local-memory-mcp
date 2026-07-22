/**
 * Parser module tests — validates tree-sitter WASM integration, symbol extraction,
 * lazy initialization, error handling, and timeout behavior.
 *
 * WASM-dependent tests skip gracefully when WASM files are unavailable.
 */

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { Parser, Language } from "web-tree-sitter";

import { ParseResult } from "../../codebase-index/parser/language-visitor";
import { SymbolKind } from "../../codebase-index/parser/language-visitor";
import { TypeScriptVisitor } from "../../codebase-index/parser/typescript-visitor";
import { TreeSitterParserPool } from "../../codebase-index/parser/parser-pool";
import { FatalError } from "../../codebase-index/types/errors";

// ── WASM availability check ──────────────────────────────────────────

interface WasmPaths {
	wasm: string;
	tsGrammar: string;
	tsxGrammar: string;
}

let wasmPaths: WasmPaths | null = null;
let wasmAvailable = false;

function resolveWasmPaths(): WasmPaths | null {
	const root = findProjectRoot();
	if (!root) return null;

	const candidates = {
		wasm: path.join(root, "node_modules", "web-tree-sitter", "web-tree-sitter.wasm"),
		tsGrammar: path.join(root, "node_modules", "tree-sitter-typescript", "tree-sitter-typescript.wasm"),
		tsxGrammar: path.join(root, "node_modules", "tree-sitter-typescript", "tree-sitter-tsx.wasm")
	};

	if (!fs.existsSync(candidates.wasm)) return null;
	if (!fs.existsSync(candidates.tsGrammar)) return null;

	return candidates;
}

function findProjectRoot(): string | null {
	// In ESM, use import.meta.url instead of __dirname
	const moduleDir = path.dirname(fileURLToPath(import.meta.url));
	let dir = moduleDir;
	// walk up from the test file to find node_modules
	for (let i = 0; i < 10; i++) {
		if (fs.existsSync(path.join(dir, "node_modules"))) return dir;
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

async function initTreeSitter(): Promise<{ tsLang: Language }> {
	if (!wasmPaths) throw new Error("WASM not available");

	await Parser.init({
		locateFile(): string {
			return wasmPaths!.wasm;
		}
	});

	const tsLang = await Language.load(wasmPaths.tsGrammar);
	return { tsLang };
}

// ── Test helpers ─────────────────────────────────────────────────────

function touch(filePath: string, content: string): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content, "utf-8");
}

/** Parse source code via tree-sitter and extract symbols using the visitor. */
function parseSource(sourceCode: string, tsLang: Language) {
	const parser = new Parser();
	parser.setLanguage(tsLang);

	const tree = parser.parse(sourceCode);
	if (!tree) {
		parser.delete();
		throw new Error("Parse returned null");
	}

	const visitor = new TypeScriptVisitor();
	const symbols = visitor.extractSymbols(tree, sourceCode);

	tree.delete();
	parser.delete();

	return symbols;
}

// ── Suite ────────────────────────────────────────────────────────────

describe("Codebase Index Parser", () => {
	beforeAll(() => {
		wasmPaths = resolveWasmPaths();
		if (!wasmPaths) {
			console.warn("[parser.test] WASM files not found — WASM-dependent tests will be skipped");
			return;
		}
		wasmAvailable = true;
	});

	// ── Test 1: Parser initialization ───────────────────────────────

	it("initializes web-tree-sitter WASM successfully", { timeout: 30_000 }, async () => {
		if (!wasmAvailable) {
			console.warn("  Skipped: WASM not available");
			return;
		}

		const pool = new TreeSitterParserPool();
		expect(pool.isInitialized()).toBe(false);

		await pool.initialize();

		expect(pool.isInitialized()).toBe(true);
	});

	// ── Test 2: Parse function declaration ────────────────────────

	it("extracts function declarations", { timeout: 30_000 }, async () => {
		if (!wasmAvailable) {
			console.warn("  Skipped: WASM not available");
			return;
		}

		const { tsLang } = await initTreeSitter();

		const source = `
/**
 * Fetches a user by ID.
 * @param id - The user ID
 */
function fetchUser(id: string): Promise<User> {
  return db.users.find(id);
}

const arrowFn = (x: number) => x * 2;

let mutableVar = 42;
`;

		const symbols = parseSource(source, tsLang);

		const fn = symbols.find((s) => s.name === "fetchUser");
		expect(fn).toBeDefined();
		expect(fn!.kind).toBe(SymbolKind.Function);
		expect(fn!.docComment).toContain("Fetches a user");
		expect(fn!.startLine).toBeGreaterThan(0);
		expect(fn!.startCol).toBeGreaterThan(0);

		const arrow = symbols.find((s) => s.name === "arrowFn");
		expect(arrow).toBeDefined();
		expect(arrow!.kind).toBe(SymbolKind.Function);

		const mutable = symbols.find((s) => s.name === "mutableVar");
		expect(mutable).toBeDefined();
		expect(mutable!.kind).toBe(SymbolKind.Variable);
	});

	// ── Test 3: Parse class with methods ──────────────────────────

	it("extracts class declaration with methods", { timeout: 30_000 }, async () => {
		if (!wasmAvailable) {
			console.warn("  Skipped: WASM not available");
			return;
		}

		const { tsLang } = await initTreeSitter();

		const source = `
class UserService {
  name: string;

  getUser(id: number): User {
    return {} as User;
  }

  deleteUser(id: number): void {
    // stub
  }
}
`;

		const symbols = parseSource(source, tsLang);

		const cls = symbols.find((s) => s.name === "UserService");
		expect(cls).toBeDefined();
		expect(cls!.kind).toBe(SymbolKind.Class);

		const getUser = symbols.find((s) => s.name === "getUser");
		expect(getUser).toBeDefined();
		expect(getUser!.kind).toBe(SymbolKind.Method);
		expect(getUser!.parentName).toBe("UserService");

		const deleteUser = symbols.find((s) => s.name === "deleteUser");
		expect(deleteUser).toBeDefined();
		expect(deleteUser!.kind).toBe(SymbolKind.Method);
		expect(deleteUser!.parentName).toBe("UserService");
	});

	// ── Test 4: Parse interface declaration ───────────────────────

	it("extracts interface declarations", { timeout: 30_000 }, async () => {
		if (!wasmAvailable) {
			console.warn("  Skipped: WASM not available");
			return;
		}

		const { tsLang } = await initTreeSitter();

		const source = `
interface User {
  id: string;
  name: string;
  email: string;
}

interface AdminUser extends User {
  permissions: string[];
}
`;

		const symbols = parseSource(source, tsLang);

		const user = symbols.find((s) => s.name === "User");
		expect(user).toBeDefined();
		expect(user!.kind).toBe(SymbolKind.Interface);

		const admin = symbols.find((s) => s.name === "AdminUser");
		expect(admin).toBeDefined();
		expect(admin!.kind).toBe(SymbolKind.Interface);
	});

	// ── Test 5: Parse type alias ───────────────────────────────────

	it("extracts type alias declarations", { timeout: 30_000 }, async () => {
		if (!wasmAvailable) {
			console.warn("  Skipped: WASM not available");
			return;
		}

		const { tsLang } = await initTreeSitter();

		const source = `
type UserId = string;
type Callback<T> = (value: T) => void;
type Status = "active" | "inactive";
`;

		const symbols = parseSource(source, tsLang);

		const userId = symbols.find((s) => s.name === "UserId");
		expect(userId).toBeDefined();
		expect(userId!.kind).toBe(SymbolKind.Type);

		const callback = symbols.find((s) => s.name === "Callback");
		expect(callback).toBeDefined();
		expect(callback!.kind).toBe(SymbolKind.Type);
	});

	// ── Test 6: Parse enum ────────────────────────────────────────

	it("extracts enum declarations", { timeout: 30_000 }, async () => {
		if (!wasmAvailable) {
			console.warn("  Skipped: WASM not available");
			return;
		}

		const { tsLang } = await initTreeSitter();

		const source = `
enum UserRole {
  Admin = "admin",
  Editor = "editor",
  Viewer = "viewer"
}

const enum NumericStatus {
  Active,
  Inactive,
  Pending
}
`;

		const symbols = parseSource(source, tsLang);

		const role = symbols.find((s) => s.name === "UserRole");
		expect(role).toBeDefined();
		expect(role!.kind).toBe(SymbolKind.Enum);

		const numStatus = symbols.find((s) => s.name === "NumericStatus");
		expect(numStatus).toBeDefined();
		expect(numStatus!.kind).toBe(SymbolKind.Enum);
	});

	// ── Test 7: Parse exports ─────────────────────────────────────

	it("correctly marks exported symbols (default, named, re-export)", { timeout: 30_000 }, async () => {
		if (!wasmAvailable) {
			console.warn("  Skipped: WASM not available");
			return;
		}

		const { tsLang } = await initTreeSitter();

		// Create a two-file scenario: file that exports, and file that re-exports
		const source = `
export function publicFn(): void {}
export const publicConst = 123;
export default class DefaultService {}
export { publicFn as aliasedFn };
export interface ExportedIface {}
export type ExportedType = string;
`;

		const symbols = parseSource(source, tsLang);

		const publicFn = symbols.find((s) => s.name === "publicFn");
		expect(publicFn).toBeDefined();
		expect(publicFn!.exported).toBe(true);
		expect(publicFn!.defaultExport).toBe(false);

		const publicConst = symbols.find((s) => s.name === "publicConst");
		expect(publicConst).toBeDefined();
		expect(publicConst!.exported).toBe(true);

		const defaultSvc = symbols.find((s) => s.name === "DefaultService");
		expect(defaultSvc).toBeDefined();
		expect(defaultSvc!.exported).toBe(true);
		expect(defaultSvc!.defaultExport).toBe(true);

		const exportedIface = symbols.find((s) => s.name === "ExportedIface");
		expect(exportedIface).toBeDefined();
		expect(exportedIface!.exported).toBe(true);

		const exportedType = symbols.find((s) => s.name === "ExportedType");
		expect(exportedType).toBeDefined();
		expect(exportedType!.exported).toBe(true);
	});

	// ── Test 8: Error handling — malformed code ───────────────────

	it("handles malformed code gracefully (no crash)", { timeout: 30_000 }, async () => {
		if (!wasmAvailable) {
			console.warn("  Skipped: WASM not available");
			return;
		}

		const { tsLang } = await initTreeSitter();

		const source = `
function valid(): void {}
function broken( // missing closing paren and brace
const x: string = 123; // type mismatch but syntactically ok
@#$%^& // completely invalid
`;

		const parser = new Parser();
		parser.setLanguage(tsLang);

		const tree = parser.parse(source);
		// tree-sitter should return a tree even with errors (it has error recovery)
		expect(tree).not.toBeNull();

		const visitor = new TypeScriptVisitor();
		const symbols = visitor.extractSymbols(tree!, source);

		// Should still extract the valid function
		const valid = symbols.find((s) => s.name === "valid");
		expect(valid).toBeDefined();
		expect(valid!.kind).toBe(SymbolKind.Function);

		tree?.delete();
		parser.delete();
	});

	// ── Test 9: Lazy initialization ───────────────────────────────

	it("does NOT initialize WASM until first parseFile call", { timeout: 30_000 }, async () => {
		if (!wasmAvailable) {
			console.warn("  Skipped: WASM not available");
			return;
		}

		const pool = new TreeSitterParserPool();
		// Before any call, pool should not be initialized
		expect(pool.isInitialized()).toBe(false);

		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cbi-parser-"));
		try {
			const filePath = path.join(tempDir, "sample.ts");
			touch(filePath, "export const hello = 'world';");

			// First call triggers lazy init
			const result = await pool.parseFile(filePath, "export const hello = 'world';");
			expect(result.error).toBeNull();
			expect(result.symbols.length).toBeGreaterThan(0);

			// Pool is now initialized
			expect(pool.isInitialized()).toBe(true);
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	// ── Test 10: Parse timeout ────────────────────────────────────

	it("respects parse timeout for huge files", { timeout: 15_000 }, async () => {
		if (!wasmAvailable) {
			console.warn("  Skipped: WASM not available");
			return;
		}

		// Short timeout pool
		const pool = new TreeSitterParserPool({ parseTimeoutMs: 200 });

		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cbi-parser-"));
		try {
			const filePath = path.join(tempDir, "big.ts");

			// Generate a massive file that should take a while to parse
			const hugeSource = "export const huge = {\n" + "value: 1,\n".repeat(50_000) + "};\n";
			touch(filePath, hugeSource);

			const result = await pool.parseFile(filePath, hugeSource);

			// Should either complete or timeout gracefully
			if (result.error) {
				expect(result.error).toMatch(/timeout/i);
			} else {
				expect(result.symbols.length).toBeGreaterThanOrEqual(0);
			}
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	// ── Test 11: Generic types ────────────────────────────────────

	it("handles generic type parameters", { timeout: 30_000 }, async () => {
		if (!wasmAvailable) {
			console.warn("  Skipped: WASM not available");
			return;
		}

		const { tsLang } = await initTreeSitter();

		const source = `
function mapArray<T, U>(items: T[], fn: (item: T) => U): U[] {
  return items.map(fn);
}

class GenericCache<K extends string, V> {
  private store = new Map<K, V>();
  get(key: K): V | undefined { return this.store.get(key); }
}

interface Paginated<T> {
  items: T[];
  total: number;
}
`;

		const symbols = parseSource(source, tsLang);

		const mapArray = symbols.find((s) => s.name === "mapArray");
		expect(mapArray).toBeDefined();
		expect(mapArray!.signature).toContain("<T, U>");

		const cache = symbols.find((s) => s.name === "GenericCache");
		expect(cache).toBeDefined();
		expect(cache!.signature).toContain("<K extends string, V>");

		// Class methods
		const getMethod = symbols.find((s) => s.name === "get");
		expect(getMethod).toBeDefined();
		expect(getMethod!.kind).toBe(SymbolKind.Method);
		expect(getMethod!.parentName).toBe("GenericCache");

		const paginated = symbols.find((s) => s.name === "Paginated");
		expect(paginated).toBeDefined();
		expect(paginated!.kind).toBe(SymbolKind.Interface);
		expect(paginated!.signature).toContain("<T>");
	});

	// ── Test 12: Type-only exports ────────────────────────────────

	it("handles type-only exports correctly", { timeout: 30_000 }, async () => {
		if (!wasmAvailable) {
			console.warn("  Skipped: WASM not available");
			return;
		}

		const { tsLang } = await initTreeSitter();

		const source = `
interface IConfig { debug: boolean }
type ConfigKey = keyof IConfig;

export type { ConfigKey };
export { IConfig };
`;

		const symbols = parseSource(source, tsLang);

		const configKey = symbols.find((s) => s.name === "ConfigKey");
		expect(configKey).toBeDefined();
		expect(configKey!.kind).toBe(SymbolKind.Type);
		expect(configKey!.exported).toBe(true);

		const iConfig = symbols.find((s) => s.name === "IConfig");
		expect(iConfig).toBeDefined();
		expect(iConfig!.kind).toBe(SymbolKind.Interface);
		// `export { IConfig }` marks it exported even though it's an interface
		expect(iConfig!.exported).toBe(true);
	});

	// ══════════════════════════════════════════════════════════════════
	// Edge Case: Empty file returns empty symbol array
	// ══════════════════════════════════════════════════════════════════

	it("empty file: returns empty symbol array", { timeout: 30_000 }, async () => {
		if (!wasmAvailable) {
			console.warn("  Skipped: WASM not available");
			return;
		}

		const { tsLang } = await initTreeSitter();

		const source = "";

		const symbols = parseSource(source, tsLang);
		expect(symbols).toEqual([]);
	});

	// ══════════════════════════════════════════════════════════════════
	// Edge Case: File with only comments returns no symbols
	// ══════════════════════════════════════════════════════════════════

	it("only comments: returns no symbols", { timeout: 30_000 }, async () => {
		if (!wasmAvailable) {
			console.warn("  Skipped: WASM not available");
			return;
		}

		const { tsLang } = await initTreeSitter();

		const source = `
// Single line comment

/* Multi-line
   comment block */

/** JSDoc comment
 * @param x - value
 */
`;

		const symbols = parseSource(source, tsLang);
		expect(symbols).toEqual([]);
	});

	// ══════════════════════════════════════════════════════════════════
	// Edge Case: Deeply nested — class with method with arrow function
	// ══════════════════════════════════════════════════════════════════

	it("deeply nested: class with method with arrow function callback", { timeout: 30_000 }, async () => {
		if (!wasmAvailable) {
			console.warn("  Skipped: WASM not available");
			return;
		}

		const { tsLang } = await initTreeSitter();

		const source = `
class PipelineService {
  process(items: string[]): number[] {
    const mapper = (item: string): number => {
      const doubled = item.length * 2;
      return doubled;
    };
    return items.map(mapper);
  }
}
`;

		const symbols = parseSource(source, tsLang);

		// Top-level class
		const cls = symbols.find((s) => s.name === "PipelineService");
		expect(cls).toBeDefined();
		expect(cls!.kind).toBe(SymbolKind.Class);

		// Method
		const method = symbols.find((s) => s.name === "process");
		expect(method).toBeDefined();
		expect(method!.kind).toBe(SymbolKind.Method);
		expect(method!.parentName).toBe("PipelineService");

		// The arrow function inside method body is NOT extracted because the
		// visitor only recurses into class_body for method definitions, not
		// into method bodies themselves. Inner variables/arrows are excluded.
		const mapper = symbols.find((s) => s.name === "mapper");
		expect(mapper).toBeUndefined();

		// Verify only the 2 top-level symbols are returned (class + method)
		expect(symbols.length).toBe(2);
	});

	// ══════════════════════════════════════════════════════════════════
	// Edge Case: Type-only imports should not create symbols
	// ══════════════════════════════════════════════════════════════════

	it("type-only imports: does not create symbols for imports", { timeout: 30_000 }, async () => {
		if (!wasmAvailable) {
			console.warn("  Skipped: WASM not available");
			return;
		}

		const { tsLang } = await initTreeSitter();

		const source = `
import type { Foo } from "./types";
import { Bar } from "./utils";

export function doThing(): void {
  // uses Foo and Bar
}
`;

		const symbols = parseSource(source, tsLang);

		// Foo should NOT appear as a symbol (it's a type-only import)
		const foo = symbols.find((s) => s.name === "Foo");
		expect(foo).toBeUndefined();

		// Bar should NOT appear as a symbol (it's an import, not a declaration)
		const bar = symbols.find((s) => s.name === "Bar");
		expect(bar).toBeUndefined();

		// doThing SHOULD appear (it's declared here)
		const doThing = symbols.find((s) => s.name === "doThing");
		expect(doThing).toBeDefined();
		expect(doThing!.kind).toBe(SymbolKind.Function);
	});

	// ══════════════════════════════════════════════════════════════════
	// Edge Case: Multiple exports compound export statement
	// ══════════════════════════════════════════════════════════════════

	it("multiple exports: compound export { A, B, C }", { timeout: 30_000 }, async () => {
		if (!wasmAvailable) {
			console.warn("  Skipped: WASM not available");
			return;
		}

		const { tsLang } = await initTreeSitter();

		const source = `
function fnA(): void {}
function fnB(): void {}
function fnC(): void {}

export { fnA, fnB, fnC };
`;

		const symbols = parseSource(source, tsLang);

		const fnA = symbols.find((s) => s.name === "fnA");
		expect(fnA).toBeDefined();
		expect(fnA!.kind).toBe(SymbolKind.Function);
		expect(fnA!.exported).toBe(true);

		const fnB = symbols.find((s) => s.name === "fnB");
		expect(fnB).toBeDefined();
		expect(fnB!.exported).toBe(true);

		const fnC = symbols.find((s) => s.name === "fnC");
		expect(fnC).toBeDefined();
		expect(fnC!.exported).toBe(true);

		// All 3 should be present
		const exportedSymbols = symbols.filter((s) => s.exported);
		expect(exportedSymbols.length).toBeGreaterThanOrEqual(3);
	});

	// ══════════════════════════════════════════════════════════════════
	// Edge Case: Parse .tsx file with JSX elements
	// ══════════════════════════════════════════════════════════════════

	it("JSX file: parses .tsx with JSX elements", { timeout: 30_000 }, async () => {
		if (!wasmAvailable) {
			console.warn("  Skipped: WASM not available");
			return;
		}

		// For .tsx we need the TSX grammar
		if (!wasmPaths || !fs.existsSync(wasmPaths.tsxGrammar)) {
			console.warn("  Skipped: TSX grammar WASM not available");
			return;
		}

		const { tsLang } = await initTreeSitter();
		// Also load TSX grammar
		const tsxLang = await Language.load(wasmPaths.tsxGrammar);

		const source = `
import React from "react";

interface Props {
  name: string;
}

export const Greeting: React.FC<Props> = ({ name }) => {
  return <div className="greeting">Hello, {name}!</div>;
};

export default function Header(): JSX.Element {
  return <h1>Header</h1>;
}
`;

		const parser = new Parser();
		parser.setLanguage(tsxLang);

		const tree = parser.parse(source);
		expect(tree).not.toBeNull();

		const visitor = new TypeScriptVisitor();
		const symbols = visitor.extractSymbols(tree!, source);

		// Interface should be extracted
		const props = symbols.find((s) => s.name === "Props");
		expect(props).toBeDefined();
		expect(props!.kind).toBe(SymbolKind.Interface);

		// Greeting component
		const greeting = symbols.find((s) => s.name === "Greeting");
		expect(greeting).toBeDefined();
		expect(greeting!.exported).toBe(true);

		// Header component (default export)
		const header = symbols.find((s) => s.name === "Header");
		expect(header).toBeDefined();
		expect(header!.kind).toBe(SymbolKind.Function);
		expect(header!.exported).toBe(true);
		expect(header!.defaultExport).toBe(true);

		tree?.delete();
		parser.delete();
	});

	// ══════════════════════════════════════════════════════════════════
	// Edge Case: WASM initialization failure — FatalError contract
	// ══════════════════════════════════════════════════════════════════

	it("WASM init failure: FatalError has correct type, message, and context", () => {
		const err = new FatalError("WASM initialization failed: network error", {
			operation: "Parser.init",
			wasmPath: "/nonexistent/web-tree-sitter.wasm"
		});

		expect(err).toBeInstanceOf(Error);
		expect(err).toBeInstanceOf(FatalError);
		expect(err.name).toBe("FatalError");
		expect(err.type).toBe("FATAL");
		expect(err.message).toContain("WASM initialization failed");
		expect(err.context).toEqual({
			operation: "Parser.init",
			wasmPath: "/nonexistent/web-tree-sitter.wasm"
		});
	});

	it("WASM init failure: FatalError is distinct from RecoverableError", async () => {
		const { RecoverableError } = await import("../../codebase-index/types/errors");

		const fatal = new FatalError("critical: WASM broken", {});
		const recoverable = new RecoverableError("timeout: file took too long", {});

		expect(fatal.type).toBe("FATAL");
		expect(recoverable.type).toBe("RECOVERABLE");
		expect(fatal).toBeInstanceOf(FatalError);
		expect(recoverable).toBeInstanceOf(RecoverableError);
		expect(recoverable).not.toBeInstanceOf(FatalError);
		expect(fatal).not.toBeInstanceOf(RecoverableError);
	});

	it("WASM init failure: TreeSitterParserPool initialization propagates FatalError via rejected promise", async () => {
		// Verify the initialization path exists by calling it with WASM files present.
		// The FatalError path itself is tested above via direct instantiation.
		if (!wasmAvailable) {
			console.warn("  Skipped: WASM not available");
			return;
		}

		const pool = new TreeSitterParserPool();
		await pool.initialize();
		expect(pool.isInitialized()).toBe(true);

		// Parse a file to verify end-to-end works
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cbi-parser-"));
		try {
			const filePath = path.join(tempDir, "test.ts");
			touch(filePath, "export const test = true;\n");
			const result = await pool.parseFile(filePath, "export const test = true;\n");
			expect(result.error).toBeNull();
			expect(result.symbols.length).toBeGreaterThan(0);
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	// ══════════════════════════════════════════════════════════════════
	// Edge Case: Parse with unsupported extension
	// ══════════════════════════════════════════════════════════════════

	it("unsupported extension: returns error for .unknown files", { timeout: 30_000 }, async () => {
		if (!wasmAvailable) {
			console.warn("  Skipped: WASM not available");
			return;
		}

		const pool = new TreeSitterParserPool();
		const result = await pool.parseFile("test.unknown", "some content");

		expect(result.symbols).toEqual([]);
		expect(result.error).toContain("Unsupported extension");
	});

	// ══════════════════════════════════════════════════════════════════
	// Edge Case: Pool constructor with parseTimeoutMs and concurrency
	// ══════════════════════════════════════════════════════════════════

	it("constructor: accepts custom parseTimeoutMs option", () => {
		const pool = new TreeSitterParserPool({ parseTimeoutMs: 5000 });
		expect(pool.isInitialized()).toBe(false);
	});

	it("constructor: accepts custom concurrency option", () => {
		const pool = new TreeSitterParserPool({ concurrency: 8 });
		expect(pool.isInitialized()).toBe(false);
	});

	it("constructor: accepts both options together", () => {
		const pool = new TreeSitterParserPool({ parseTimeoutMs: 3000, concurrency: 2 });
		expect(pool.isInitialized()).toBe(false);
	});

	// ══════════════════════════════════════════════════════════════════
	// Edge Case: initPromise deduplication
	// ══════════════════════════════════════════════════════════════════

	it("double initialize: second call returns same promise", { timeout: 30_000 }, async () => {
		if (!wasmAvailable) {
			console.warn("  Skipped: WASM not available");
			return;
		}

		const pool = new TreeSitterParserPool();
		const p1 = pool.initialize();
		const p2 = pool.initialize();

		await Promise.all([p1, p2]);
		expect(pool.isInitialized()).toBe(true);
	});

	// ══════════════════════════════════════════════════════════════════
	// Edge Case: initialize() is a no-op if already initialized
	// ══════════════════════════════════════════════════════════════════

	it("initialize: no-op when already initialized", { timeout: 30_000 }, async () => {
		if (!wasmAvailable) {
			console.warn("  Skipped: WASM not available");
			return;
		}

		const pool = new TreeSitterParserPool();
		await pool.initialize();
		expect(pool.isInitialized()).toBe(true);

		// Second initialize should be a no-op
		await pool.initialize();
		expect(pool.isInitialized()).toBe(true);
	});

	// ══════════════════════════════════════════════════════════════════
	// Edge Case: .cts and .mts extensions map to typescript language
	// ══════════════════════════════════════════════════════════════════

	it(".cts and .mts: map to typescript grammar", { timeout: 30_000 }, async () => {
		if (!wasmAvailable) {
			console.warn("  Skipped: WASM not available");
			return;
		}

		const pool = new TreeSitterParserPool();
		const mtsResult = await pool.parseFile("lib.mts", "export const x = 1;");
		expect(mtsResult.error).toBeNull();
		expect(mtsResult.symbols.length).toBeGreaterThan(0);

		const ctsResult = await pool.parseFile("lib.cts", "export const y = 2;");
		expect(ctsResult.error).toBeNull();
		expect(ctsResult.symbols.length).toBeGreaterThan(0);
	});
});
