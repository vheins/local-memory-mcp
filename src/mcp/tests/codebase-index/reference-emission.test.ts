/**
 * Call-site reference emission tests (TASK-236 / issue #64).
 *
 * Confirms the TS visitor emits references for call_expressions, new_expressions
 * and imports, and the PHP visitor emits them for function/member/scoped calls
 * and object creation. WASM-dependent — skips gracefully when WASM is missing.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { TreeSitterParserPool } from "../../codebase-index/parser/parser-pool.js";
import type { ParseResult } from "../../codebase-index/parser/language-visitor.js";

let pool: TreeSitterParserPool | null = null;
let wasmAvailable = false;

beforeAll(async () => {
	pool = new TreeSitterParserPool();
	try {
		await pool.initialize();
		wasmAvailable = true;
	} catch {
		console.warn("[reference-emission.test] WASM not available — tests skipped");
		pool = null;
	}
}, 60_000);

async function parseOrSkip(fileName: string, source: string): Promise<ParseResult> {
	if (!wasmAvailable || !pool) {
		return { symbols: [], references: [], error: "skipped", durationMs: 0 };
	}
	return pool.parseFile(fileName, source);
}

describe("TypeScriptVisitor reference emission", () => {
	it("emits call, instantiation and import references with enclosing caller name", async () => {
		const result = await parseOrSkip(
			"svc.ts",
			`import { connect } from "./db";
export class Svc {
  run() {
    const user = new Config();
    connect();
  }
}
`
		);
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;
		if (!wasmAvailable) return;

		const refs = result.references ?? [];
		const importRef = refs.find((r) => r.symbolName === "connect" && r.kind === "import");
		expect(importRef).toBeDefined();
		// The pool fills callerFile from the file path.
		expect(importRef!.callerFile).toBe("svc.ts");
		expect(importRef!.callerLine).toBe(1);

		const inst = refs.find((r) => r.symbolName === "Config" && r.kind === "instantiation");
		expect(inst).toBeDefined();
		expect(inst!.callerName).toBe("run");
		expect(inst!.callerLine).toBe(4);

		const call = refs.find((r) => r.symbolName === "connect" && r.kind === "call");
		expect(call).toBeDefined();
		expect(call!.callerName).toBe("run");
		expect(call!.callerLine).toBe(5);
	});

	it("resolves member-expression calls to their property name", async () => {
		const result = await parseOrSkip(
			"calls.ts",
			`class Svc {
  run() { ns.helper(); obj?.method(); (foo.new().bar()); }
}
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const names = refs.map((r) => `${r.symbolName}:${r.kind}`);
		expect(names).toContain("helper:call");
		expect(names).toContain("method:call");
		expect(names).toContain("bar:call");
		expect(names).toContain("new:call"); // `foo.new()` — member property is `new`
	});
});

describe("PhpVisitor reference emission", () => {
	it("emits call and instantiation references for function/member calls and new", async () => {
		const result = await parseOrSkip(
			"repo.php",
			`<?php
class Repo {
  public function save() {
    $u = new User();
    $u->save();
    helper();
  }
}
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const inst = refs.find((r) => r.symbolName === "User" && r.kind === "instantiation");
		expect(inst).toBeDefined();
		expect(inst!.callerFile).toBe("repo.php");
		expect(inst!.callerName).toBe("save");
		// `new User();` sits on source line 4 (`$u->save();` is line 5).
		expect(inst!.callerLine).toBe(4);

		const memberCall = refs.find((r) => r.symbolName === "save" && r.kind === "call");
		expect(memberCall).toBeDefined();
		expect(memberCall!.callerName).toBe("save");

		const fnCall = refs.find((r) => r.symbolName === "helper" && r.kind === "call");
		expect(fnCall).toBeDefined();
		expect(fnCall!.callerName).toBe("save");
	});

	it("indexes scoped (static) calls and functional call through project scope", async () => {
		const result = await parseOrSkip(
			"scoped.php",
			`<?php
class A {
  public function go() { self::make(); static::run(); }
}
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const names = refs.map((r) => `${r.symbolName}:${r.kind}`);
		expect(names).toContain("make:call");
		expect(names).toContain("run:call");
	});
});
