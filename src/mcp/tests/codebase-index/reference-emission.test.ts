/**
 * Call-site reference emission tests (TASK-236 / issue #64) + heritage edge
 * tests (TASK-301 / Phase 1.1).
 *
 * Confirms the TS visitor emits references for call_expressions, new_expressions
 * and imports, the PHP visitor emits them for function/member/scoped calls
 * and object creation, and the TS visitor emits 'extends'/'implements' heritage
 * edges for class/interface/abstract declarations + generics constraints.
 * WASM-dependent — skips gracefully when WASM is missing.
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

describe("TypeScriptVisitor heritage reference emission (TASK-301)", () => {
	it("emits extends + implements edges for class heritage with caller site", async () => {
		const result = await parseOrSkip(
			"heritage.ts",
			`export class Foo extends Base implements IFoo, IBar {
  run() {
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

		const ext = refs.find((r) => r.symbolName === "Base" && r.kind === "extends");
		expect(ext).toBeDefined();
		expect(ext!.callerFile).toBe("heritage.ts");
		expect(ext!.callerLine).toBe(1);
		expect(ext!.callerName).toBeNull();

		const implFoo = refs.find((r) => r.symbolName === "IFoo" && r.kind === "implements");
		expect(implFoo).toBeDefined();
		expect(implFoo!.callerLine).toBe(1);
		expect(implFoo!.callerName).toBeNull();

		const implBar = refs.find((r) => r.symbolName === "IBar" && r.kind === "implements");
		expect(implBar).toBeDefined();
		expect(implBar!.callerLine).toBe(1);

		// Existing call emission inside the class body is unchanged.
		const call = refs.find((r) => r.symbolName === "helper" && r.kind === "call");
		expect(call).toBeDefined();
		expect(call!.callerName).toBe("run");
		expect(call!.callerLine).toBe(3);
	});

	it("emits extends edges for interface heritage and abstract classes", async () => {
		const result = await parseOrSkip(
			"heritage-abstract.ts",
			`interface A extends B, C {
  m(): void;
}

export abstract class Abs extends Base implements I {
  abstract go(): void;
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

		// interface A extends B, C → two extends edges at the interface line.
		expect(names).toContain("B:extends");
		expect(names).toContain("C:extends");
		const ifaceExt = refs.find((r) => r.symbolName === "B" && r.kind === "extends");
		expect(ifaceExt!.callerLine).toBe(1);

		// abstract class Abs extends Base implements I
		expect(names).toContain("Base:extends");
		expect(names).toContain("I:implements");
	});

	it("emits extends edges for generics constraints (generics basics)", async () => {
		const result = await parseOrSkip(
			"heritage-generics.ts",
			`export class Cache<T extends Storable> implements Iface {
  put(x: T) { store(); }
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

		// `T extends Storable` — the constraint's type ref emits 'extends'.
		expect(names).toContain("Storable:extends");
		expect(names).toContain("Iface:implements");

		const constraint = refs.find((r) => r.symbolName === "Storable" && r.kind === "extends");
		expect(constraint!.callerLine).toBe(1);
		expect(constraint!.callerName).toBeNull();

		// Call-site emission inside the class body is unchanged.
		expect(names).toContain("store:call");
	});

	it("resolves heritage targets to their last name segment (name-based, ADR-002)", async () => {
		const result = await parseOrSkip(
			"heritage-names.ts",
			`export class Foo extends ns.Base implements UI.Iface {
  m() {}
}
class Generic extends Base<Thing> implements Repo<Item> { }
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
		expect(names).toContain("Base:extends"); // ns.Base → Base (member expression property)
		expect(names).toContain("Iface:implements"); // UI.Iface → Iface (nested type identifier)
		expect(names).toContain("Base:extends"); // Base<Thing> → Base (generic base name)
		expect(names).toContain("Repo:implements"); // Repo<Item> → Repo
	});

	it("does not emit heritage edges for non-heritage type references", async () => {
		const result = await parseOrSkip(
			"heritage-none.ts",
			`function fn(x: Base, y: Iface): void {
  return;
}
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		// Type annotations are NOT heritage — only extends/implements clauses
		// and generics constraints emit heritage edges.
		const refs = result.references ?? [];
		const heritage = refs.filter((r) => r.kind === "extends" || r.kind === "implements");
		expect(heritage).toHaveLength(0);
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
