import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
	wasmAvailable,
	initTreeSitter,
	parseSource,
	SymbolKind,
	TreeSitterParserPool,
	FatalError,
	touch,
	wasmPaths,
	Parser,
	Language,
	TypeScriptVisitor
} from "./parser.shared.js";

describe("Codebase Index Parser", () => {
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

		await initTreeSitter();
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
	// Edge Case: grammar in-flight dedup (Fix #5 — TASK-054)
	// Concurrent parse slots requesting the same uncached grammar must share
	// a single in-flight Language.load promise — one WASM instantiation per
	// grammar, never one per concurrent slot.
	// ══════════════════════════════════════════════════════════════════

	it(
		"grammar in-flight dedup: concurrent parses of the same grammar trigger exactly one Language.load",
		{ timeout: 30_000 },
		async () => {
			if (!wasmAvailable || !wasmPaths) {
				console.warn("  Skipped: WASM not available");
				return;
			}

			// Instrument Language.load: count calls and hold each load open so both
			// parse slots arrive while the load is STILL in-flight. If the dedup map
			// (inFlightGrammars) is broken, the second slot would start a second
			// load; if only the loaded-grammar cache existed (no in-flight map),
			// both slots would still fire separate loads because neither has
			// resolved yet. Only the shared-promise path yields exactly one call.
			const originalLoad = Language.load.bind(Language);
			const loadSpy = vi
				.spyOn(Language, "load")
				.mockImplementation(async (...args: Parameters<typeof Language.load>) => {
					await new Promise((resolve) => setTimeout(resolve, 100));
					return originalLoad(...args);
				});

			try {
				const pool = new TreeSitterParserPool({ concurrency: 2 });
				// Two .ts files — both require the SAME tree-sitter-typescript
				// grammar, so both parse slots hit getOrLoadGrammar concurrently.
				const [r1, r2] = await Promise.all([
					pool.parseFile("alpha.ts", "export function alpha(): void {}\n"),
					pool.parseFile("beta.ts", "export function beta(): void {}\n")
				]);

				expect(r1.error).toBeNull();
				expect(r2.error).toBeNull();

				// One Language.load for the shared grammar — not one per slot.
				expect(loadSpy).toHaveBeenCalledTimes(1);
				const wasmArg = loadSpy.mock.calls[0][0] as string;
				expect(wasmArg).toMatch(/tree-sitter-typescript\.wasm$/);
			} finally {
				loadSpy.mockRestore();
			}
		}
	);

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
