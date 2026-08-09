/**
 * Call-site reference emission tests (TASK-236 / issue #64) + heritage edge
 * tests (TASK-301 + TASK-302 + TASK-303 + TASK-304 / Phase 1.1).
 *
 * Confirms the TS visitor emits references for call_expressions, new_expressions
 * and imports, the PHP visitor emits them for function/member/scoped calls
 * and object creation, the TS visitor emits 'extends'/'implements' heritage
 * edges for class/interface/abstract declarations + generics constraints, the
 * PHP visitor emits 'import' edges per use-binding plus 'extends'/'implements'
 * heritage edges for class/interface/enum declarations, the Kotlin visitor
 * emits 'import' edges per import-header binding plus 'extends'/'implements'
 * heritage edges for class/interface/enum/object supertypes (delegation
 * specifiers) + generic bounds, and 'call' edges for call_expressions, and the
 * Java visitor emits 'import' edges per import_declaration binding (incl.
 * static-import member names) plus 'extends'/'implements' heritage edges for
 * class/interface/enum/record declarations + generic type_bound constraints,
 * and 'call' edges for method_invocations. The Python visitor (TASK-305) emits
 * 'import' edges per binding (alias wins, else LAST dotted-name segment;
 * wildcards emit nothing), one 'extends' edge per base class in the
 * superclasses list (kind stays 'extends' uniformly — Python has no separate
 * implements), and 'call' edges for call expressions. The Go visitor
 * (TASK-306) emits 'import' edges per import_spec binding (explicit alias
 * wins, else LAST path segment; blank `_` and dot `.` imports emit nothing),
 * 'extends' edges for interface embedding (type_elem children) and struct
 * embedding (anonymous field_declaration with no name field — pointer /
 * qualified / generic embedded types resolve to the LAST name segment), and
 * 'call' edges for call expressions.
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

describe("KotlinVisitor reference emission (TASK-304)", () => {
	it("emits import edges per binding with alias / last-segment resolution", async () => {
		const result = await parseOrSkip(
			"kotlin-imports.kt",
			`package com.example.app

import foo.bar.Baz
import foo.bar.Qux as Quux
import java.util.List
import java.util.*
import com.acme.deep.Nested
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const imports = refs.filter((r) => r.kind === "import");
		const names = imports.map((r) => `${r.symbolName}@${r.callerLine}`);
		// `import foo.bar.Baz` → 'Baz' (last segment); `as Quux` → 'Quux' (alias).
		expect(names).toContain("Baz@3");
		expect(names).toContain("Quux@4");
		// Plain + qualified imports resolve to the LAST name segment.
		expect(names).toContain("List@5");
		expect(names).toContain("Nested@7");
		// `import java.util.*` (wildcard) emits NO binding.
		expect(names).not.toContain("*");
		expect(imports.filter((r) => r.callerLine === 6)).toHaveLength(0);

		// The pool fills callerFile; top-level imports carry no caller.
		const first = imports[0];
		expect(first!.callerFile).toBe("kotlin-imports.kt");
		expect(first!.callerName).toBeNull();
	});

	it("emits extends + implements edges for class supertypes with caller site", async () => {
		const result = await parseOrSkip(
			"kotlin-heritage.kt",
			`open class Base(val name: String)
interface IFoo {
    fun a()
}
interface IBar {
    fun b()
}

class Child : Base("x"), IFoo, IBar {
    fun run() {
        helper()
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

		// First delegation_specifier (superclass call) → 'extends'.
		const ext = refs.find((r) => r.symbolName === "Base" && r.kind === "extends");
		expect(ext).toBeDefined();
		expect(ext!.callerFile).toBe("kotlin-heritage.kt");
		expect(ext!.callerLine).toBe(9);
		expect(ext!.callerName).toBeNull();

		// Subsequent specifiers (interfaces) → 'implements'.
		const implFoo = refs.find((r) => r.symbolName === "IFoo" && r.kind === "implements");
		expect(implFoo).toBeDefined();
		expect(implFoo!.callerLine).toBe(9);
		expect(implFoo!.callerName).toBeNull();

		const implBar = refs.find((r) => r.symbolName === "IBar" && r.kind === "implements");
		expect(implBar).toBeDefined();
		expect(implBar!.callerLine).toBe(9);

		// Call-site emission inside the class body is unchanged.
		const call = refs.find((r) => r.symbolName === "helper" && r.kind === "call");
		expect(call).toBeDefined();
		expect(call!.callerName).toBe("run");
		expect(call!.callerLine).toBe(11);
	});

	it("emits interface extends, object/enum implements and last-segment qualified names", async () => {
		const result = await parseOrSkip(
			"kotlin-heritage-kinds.kt",
			`interface IA
interface IB
interface IC : IA, IB

abstract class Abs : com.acme.deep.Base

enum class Color : E1, E2 {
    RED,
    GREEN
}

object Singleton : IA, IB

class WithCompanion {
    companion object : IA {
        fun c() {}
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
		const names = refs.map((r) => `${r.symbolName}:${r.kind}`);

		// interface IC : IA, IB → ALL supertypes are 'extends'.
		expect(names).toContain("IA:extends");
		expect(names).toContain("IB:extends");
		const ifaceExt = refs.find((r) => r.symbolName === "IA" && r.kind === "extends");
		expect(ifaceExt!.callerLine).toBe(3);
		expect(ifaceExt!.callerName).toBeNull();

		// Qualified supertype → LAST name segment.
		expect(names).toContain("Base:extends");

		// enum class Color : E1, E2 → every supertype is 'implements'.
		expect(names).toContain("E1:implements");
		expect(names).toContain("E2:implements");
		const enumImpl = refs.find((r) => r.symbolName === "E1" && r.kind === "implements");
		expect(enumImpl!.callerLine).toBe(7);

		// object Singleton : IA, IB → all 'implements'.
		expect(names).toContain("IA:implements");
		expect(names).toContain("IB:implements");

		// companion object supertypes → 'implements'.
		expect(names).toContain("IA:implements");
	});

	it("emits extends edges for generic bounds and where constraints", async () => {
		const result = await parseOrSkip(
			"kotlin-heritage-generics.kt",
			`interface Iface

class Cache<T : Storable> : Iface
class Multi<T> where T : Bound
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

		// `T : Storable` — the declaration-level constraint bound emits 'extends'.
		expect(names).toContain("Storable:extends");
		const bound = refs.find((r) => r.symbolName === "Storable" && r.kind === "extends");
		expect(bound!.callerLine).toBe(3);
		expect(bound!.callerName).toBeNull();

		// `where T : Bound` → 'extends'.
		expect(names).toContain("Bound:extends");
	});

	it("emits call edges with enclosing caller name and skips type-alias/non-heritage refs", async () => {
		const result = await parseOrSkip(
			"kotlin-calls.kt",
			`typealias Alias = Storable

class Svc {
    fun run() {
        helper()
        ns.thing().other()
        list.map { it }.filter { p -> p.ok() }
    }
}
fun top() {
    compute()
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

		// Simple call + navigation chains, with enclosing callerName.
		const helper = refs.find((r) => r.symbolName === "helper" && r.kind === "call");
		expect(helper).toBeDefined();
		expect(helper!.callerName).toBe("run");
		expect(names).toContain("thing:call"); // inner `ns.thing()`
		expect(names).toContain("other:call"); // outer `.other()`
		expect(names).toContain("ok:call"); // lambda receiver call `p.ok()`

		// Top-level function call.
		const compute = refs.find((r) => r.symbolName === "compute" && r.kind === "call");
		expect(compute).toBeDefined();
		expect(compute!.callerName).toBe("top");

		// `typealias Alias = Storable` — the RHS is a type synonym, NOT heritage
		// (a type alias declares an equivalence, not an extends/implements
		// relation), and no other declaration in this file has supertypes, so
		// NO heritage edges may be emitted from this file at all.
		const heritage = refs.filter((r) => r.kind === "extends" || r.kind === "implements");
		expect(heritage).toHaveLength(0);
	});
});

describe("JavaVisitor reference emission (TASK-303)", () => {
	it("emits import edges per binding with static-member / last-segment resolution", async () => {
		const result = await parseOrSkip(
			"java-imports.java",
			`import foo.bar.Baz;
import static java.util.Collections.sort;
import java.util.*;
import com.acme.deep.Nested;
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const imports = refs.filter((r) => r.kind === "import");
		const names = imports.map((r) => `${r.symbolName}@${r.callerLine}`);
		// `import foo.bar.Baz` → 'Baz' (last segment); static import targets the
		// MEMBER name `sort`.
		expect(names).toContain("Baz@1");
		expect(names).toContain("sort@2");
		// Deep qualified import resolves to the LAST name segment.
		expect(names).toContain("Nested@4");
		// `import java.util.*` (wildcard) emits NO binding.
		expect(imports.filter((r) => r.callerLine === 3)).toHaveLength(0);

		// The pool fills callerFile; top-level imports carry no caller.
		const first = imports[0];
		expect(first!.callerFile).toBe("java-imports.java");
		expect(first!.callerName).toBeNull();
	});

	it("emits extends + implements edges for class heritage with caller site", async () => {
		const result = await parseOrSkip(
			"java-heritage.java",
			`public class Foo extends Base implements IFoo, IBar {
    void run() {
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
		expect(ext!.callerFile).toBe("java-heritage.java");
		expect(ext!.callerLine).toBe(1);
		expect(ext!.callerName).toBeNull();

		const implFoo = refs.find((r) => r.symbolName === "IFoo" && r.kind === "implements");
		expect(implFoo).toBeDefined();
		expect(implFoo!.callerLine).toBe(1);
		expect(implFoo!.callerName).toBeNull();

		const implBar = refs.find((r) => r.symbolName === "IBar" && r.kind === "implements");
		expect(implBar).toBeDefined();
		expect(implBar!.callerLine).toBe(1);

		// Call-site emission inside the method body (callerName = enclosing method).
		const call = refs.find((r) => r.symbolName === "helper" && r.kind === "call");
		expect(call).toBeDefined();
		expect(call!.callerName).toBe("run");
		expect(call!.callerLine).toBe(3);
	});

	it("emits interface extends, enum/record implements and last-segment qualified names", async () => {
		const result = await parseOrSkip(
			"java-heritage-kinds.java",
			`interface IA {}
interface IB {}
interface IC extends IA, IB {}

abstract class Abs extends com.acme.deep.Base implements IFoo {}

enum Color implements E1, E2 { RED, GREEN }

record Pair(int x, int y) implements E1, E2 {}

class Nested extends java.util.ArrayList<String> implements GenericRepo<Item> {}
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

		// interface IC extends IA, IB → all 'extends'.
		expect(names).toContain("IA:extends");
		expect(names).toContain("IB:extends");
		const ifaceExt = refs.find((r) => r.symbolName === "IA" && r.kind === "extends");
		expect(ifaceExt!.callerLine).toBe(3);
		expect(ifaceExt!.callerName).toBeNull();

		// Qualified superclass → LAST name segment.
		expect(names).toContain("Base:extends");
		expect(names).toContain("IFoo:implements");

		// enum Color implements E1, E2 → per-target 'implements'.
		expect(names).toContain("E1:implements");
		expect(names).toContain("E2:implements");
		const enumImpl = refs.find((r) => r.symbolName === "E1" && r.kind === "implements");
		expect(enumImpl!.callerLine).toBe(7);

		// record Pair implements E1, E2 → 'implements' (records can only implement).
		// E2:implements exists on BOTH the enum edge (line 7) and the record edge (line 9);
		// scope the find to the record edge (callerLine 9) so the assertion is deterministic.
		const recordImpl = refs.find((r) => r.symbolName === "E2" && r.kind === "implements" && r.callerLine === 9);
		expect(recordImpl!.callerLine).toBe(9);

		// Generic qualified heritage → base last segment:
		// `extends java.util.ArrayList<Base>` → ArrayList; `implements GenericRepo<Item>` → GenericRepo.
		expect(names).toContain("ArrayList:extends");
		expect(names).toContain("GenericRepo:implements");
	});

	it("emits extends edges for generic type_bound constraints, excluding method-level type params", async () => {
		const result = await parseOrSkip(
			"java-heritage-generics.java",
			`class Cache<T extends Storable> {}

class Multi<T extends A & B> {}

class M {
    <R extends Bound> R method(R r) { return r; }
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

		// `T extends Storable` → kind 'extends' per type_bound target.
		expect(names).toContain("Storable:extends");
		const bound = refs.find((r) => r.symbolName === "Storable" && r.kind === "extends");
		expect(bound!.callerLine).toBe(1);
		expect(bound!.callerName).toBeNull();

		// `T extends A & B` → one 'extends' per bound.
		expect(names).toContain("A:extends");
		expect(names).toContain("B:extends");

		// Method-level `<R extends Bound>` is NOT heritage — excluded (only
		// declaration-level type_parameters feed type_bound edges).
		expect(names).not.toContain("Bound:extends");
		expect(names).not.toContain("Bound:implements");
	});

	it("does not emit heritage/instantiation edges for type annotations or new-expressions", async () => {
		const result = await parseOrSkip(
			"java-heritage-none.java",
			`import java.util.List;

class AlsoNoRef {
    List<String> items;
    void m(NotHeritage x) {
        new ArrayList<String>();
        int y = x.getSize() + 1;
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
		// Parameter/field type annotations are NOT heritage — nothing extends
		// or implements in this file.
		const heritage = refs.filter((r) => r.kind === "extends" || r.kind === "implements");
		expect(heritage).toHaveLength(0);

		// `new ArrayList<String>()` is an object_creation_expression — Java
		// emits no instantiation edge (out of TASK-303 scope).
		expect(refs.filter((r) => r.kind === "instantiation")).toHaveLength(0);

		// Call-site emission inside methods still works (member + plain calls).
		const names = refs.map((r) => `${r.symbolName}:${r.kind}`);
		expect(names).toContain("getSize:call");
		const helper = refs.find((r) => r.symbolName === "helper" && r.kind === "call");
		expect(helper).toBeDefined();
		expect(helper!.callerName).toBe("m");
	});
});

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

describe("PhpVisitor heritage + import reference emission (TASK-302)", () => {
	it("emits import edges per binding with alias / last-segment resolution", async () => {
		const result = await parseOrSkip(
			"php-imports.php",
			`<?php
use Foo\\Bar;
use Foo\\Bar as Baz;
use function foo\\helper;
use NS\\Util\\{Factory, Repo as Store};
use A\\B, C;
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const imports = refs.filter((r) => r.kind === "import");
		const names = imports.map((r) => `${r.symbolName}@${r.callerLine}`);
		// `use Foo\Bar;` → 'Bar' (last segment); `as Baz` → 'Baz' (alias).
		expect(names).toContain("Bar@2");
		expect(names).toContain("Baz@3");
		// `use function foo\helper;` resolves the same way (last segment).
		expect(names).toContain("helper@4");
		// Group form `use NS\Util\{Factory, Repo as Store};`.
		expect(names).toContain("Factory@5");
		expect(names).toContain("Store@5");
		// Multi-clause plain form `use A\B, C;`.
		expect(names).toContain("B@6");
		expect(names).toContain("C@6");

		// The pool fills callerFile; top-level imports carry no caller.
		const first = imports[0];
		expect(first!.callerFile).toBe("php-imports.php");
		expect(first!.callerName).toBeNull();
	});

	it("emits extends + implements edges for class heritage with caller site", async () => {
		const result = await parseOrSkip(
			"php-heritage.php",
			`<?php
class Foo extends Bar implements IFoo, IBar {
  public function run() {
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

		const ext = refs.find((r) => r.symbolName === "Bar" && r.kind === "extends");
		expect(ext).toBeDefined();
		expect(ext!.callerFile).toBe("php-heritage.php");
		expect(ext!.callerLine).toBe(2);
		expect(ext!.callerName).toBeNull();

		const implFoo = refs.find((r) => r.symbolName === "IFoo" && r.kind === "implements");
		expect(implFoo).toBeDefined();
		expect(implFoo!.callerLine).toBe(2);
		expect(implFoo!.callerName).toBeNull();

		const implBar = refs.find((r) => r.symbolName === "IBar" && r.kind === "implements");
		expect(implBar).toBeDefined();
		expect(implBar!.callerLine).toBe(2);

		// Existing call emission inside the class body is unchanged.
		const call = refs.find((r) => r.symbolName === "helper" && r.kind === "call");
		expect(call).toBeDefined();
		expect(call!.callerName).toBe("run");
		expect(call!.callerLine).toBe(4);
	});

	it("emits interface multiple-extends, enum implements and last-segment qualified names", async () => {
		const result = await parseOrSkip(
			"php-heritage-types.php",
			`<?php
interface A extends B, C {
  public function m(): void;
}

abstract class Abs extends \\App\\Models\\Base implements IFoo {}

enum E implements E1, E2 {
  case One;
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
		expect(ifaceExt!.callerLine).toBe(2);
		expect(ifaceExt!.callerName).toBeNull();

		// abstract class Abs extends \App\Models\Base implements IFoo →
		// 'Base' is the LAST name segment of the qualified name.
		expect(names).toContain("Base:extends");
		expect(names).toContain("IFoo:implements");

		// enum E implements E1, E2 → per-target implements edges.
		expect(names).toContain("E1:implements");
		expect(names).toContain("E2:implements");
		const enumImpl = refs.find((r) => r.symbolName === "E1" && r.kind === "implements");
		// `enum E` is on line 8 of the fixture (blank line 7 between the abstract class and the enum).
		expect(enumImpl!.callerLine).toBe(8);
	});

	it("does not emit import/heritage edges for trait use or type annotations", async () => {
		const result = await parseOrSkip(
			"php-heritage-none.php",
			`<?php
trait Greets {
  public function hi() {}
}

class Foo {
  use Greets;
  public function run(Greets $g): void {
    $g->hi();
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
		// Trait `use` (use_declaration) is NOT an import; parameter type
		// annotations (named_type) are NOT heritage.
		const imports = refs.filter((r) => r.kind === "import");
		expect(imports).toHaveLength(0);
		const heritage = refs.filter((r) => r.kind === "extends" || r.kind === "implements");
		expect(heritage).toHaveLength(0);

		// Call-site emission inside methods still works.
		expect(refs.some((r) => r.symbolName === "hi" && r.kind === "call")).toBe(true);
	});
});

describe("PythonVisitor reference emission (TASK-305)", () => {
	it("emits import edges per binding with alias / last-segment resolution", async () => {
		const result = await parseOrSkip(
			"python-imports.py",
			`import os
import a.b.c
import numpy as np
from collections import OrderedDict
from typing import Optional, List as L
from os import path as osp
from . import sibling
from ..pkg import mod
import xml.etree.ElementTree as ET, json
from foo import *
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const imports = refs.filter((r) => r.kind === "import");
		const names = imports.map((r) => `${r.symbolName}@${r.callerLine}`);
		// Plain import → the module name as written (fixture line 1).
		expect(names).toContain("os@1");
		// Dotted import resolves to the LAST name segment (ADR-002 name-based).
		expect(names).toContain("c@2");
		// Alias wins (`import numpy as np` → 'np').
		expect(names).toContain("np@3");
		// from-import: the imported binding, NOT the module path.
		expect(names).toContain("OrderedDict@4");
		expect(names).not.toContain("collections");
		// Multiple bindings → one edge each; alias wins per binding.
		expect(names).toContain("Optional@5");
		expect(names).toContain("L@5");
		expect(names).toContain("osp@6");
		// Relative imports: `from . import sibling` / `from ..pkg import mod`.
		expect(names).toContain("sibling@7");
		expect(names).toContain("mod@8");
		// Multi-import statement → one edge per imported name.
		expect(names).toContain("ET@9");
		expect(names).toContain("json@9");
		// Wildcard `from foo import *` emits NO binding.
		expect(imports.filter((r) => r.callerLine === 10)).toHaveLength(0);

		// The pool fills callerFile; top-level imports carry no caller.
		const first = imports[0];
		expect(first!.callerFile).toBe("python-imports.py");
		expect(first!.callerName).toBeNull();
	});

	it("emits extends edges per base class with caller site", async () => {
		const result = await parseOrSkip(
			"python-heritage.py",
			`class Base:
    pass

class Foo(Base, Mixin):
    pass

class Generic(Base[Thing]):
    pass

class Qualified(alpha.beta.Gamma):
    pass

class NoBases:
    pass

class MetaIn(Base, metaclass=MyMeta):
    pass
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const heritage = refs.filter((r) => r.kind === "extends");

		// `class Foo(Base, Mixin)` → one 'extends' edge per base at the
		// declaration line, callerName null per the heritage contract.
		const extBase = heritage.find((r) => r.symbolName === "Base");
		expect(extBase).toBeDefined();
		expect(extBase!.callerFile).toBe("python-heritage.py");
		expect(extBase!.callerLine).toBe(4);
		expect(extBase!.callerName).toBeNull();
		const extMixin = heritage.find((r) => r.symbolName === "Mixin");
		expect(extMixin).toBeDefined();
		expect(extMixin!.callerLine).toBe(4);
		expect(extMixin!.callerName).toBeNull();

		// Generic base `Base[Thing]` → 'Base' (subscript value field).
		const extGeneric = heritage.find((r) => r.symbolName === "Base" && r.callerLine === 7);
		expect(extGeneric).toBeDefined();

		// Qualified base `alpha.beta.Gamma` → LAST segment 'Gamma'.
		const extQualified = heritage.find((r) => r.symbolName === "Gamma");
		expect(extQualified).toBeDefined();
		expect(extQualified!.callerLine).toBe(10);

		// No bases (`class NoBases:`) → no edge.
		expect(heritage.filter((r) => r.callerLine === 13)).toHaveLength(0);

		// Keyword arguments in the superclasses list (metaclass=MyMeta) are
		// NOT base classes → only 'Base' emitted on the MetaIn line.
		const metaLine = refs.filter((r) => r.callerLine === 16);
		expect(metaLine.map((r) => `${r.symbolName}:${r.kind}`)).toEqual(["Base:extends"]);
	});

	it("emits call edges with the enclosing function/method as caller", async () => {
		const result = await parseOrSkip(
			"python-calls.py",
			`class Service:
    def run(self):
        helper()
        return self.save()

    def notify(self):
        return outer_helper()

def top():
    return util.shuffle(items)
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const calls = refs.filter((r) => r.kind === "call");
		const names = calls.map((r) => `${r.symbolName}@${r.callerLine}`);

		// Plain call → 'helper'; member call → LAST segment 'save'.
		expect(names).toContain("helper@3");
		expect(names).toContain("save@4");
		// Nested method bodies track their own caller names.
		expect(names).toContain("outer_helper@7");
		// Function-level call with caller.
		expect(names).toContain("shuffle@10");

		const helperCall = calls.find((r) => r.symbolName === "helper");
		expect(helperCall!.callerName).toBe("run");
		expect(helperCall!.callerFile).toBe("python-calls.py");

		const shuffleCall = calls.find((r) => r.symbolName === "shuffle");
		expect(shuffleCall!.callerName).toBe("top");

		// No spurious self/class-name call targets.
		expect(calls.some((r) => r.symbolName === "self")).toBe(false);
	});
});

describe("GoVisitor reference emission (TASK-306)", () => {
	it("emits import edges per binding with alias / last-segment resolution — blank and dot imports emit nothing", async () => {
		const result = await parseOrSkip(
			"go-imports.go",
			`package main

import "fmt"
import alias "strings"
import _ "net/http/pprof"
import . "math"
import (
    "net/http"
    "os"
    s "sync"
    _ "unsafe"
)

func main() {}
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const imports = refs.filter((r) => r.kind === "import");
		const names = imports.map((r) => `${r.symbolName}@${r.callerLine}`);

		// Plain import → binding is the LAST path segment: "fmt" → 'fmt',
		// "net/http" → 'http' (Go binds the package name, not the full path).
		expect(names).toContain("fmt@3");
		expect(names).toContain("http@8");
		// Explicit alias wins: `import alias "strings"` → 'alias',
		// `s "sync"` → 's'.
		expect(names).toContain("alias@4");
		expect(names).toContain("s@10");
		// Grouped form `import ( ... )` emits per-spec edges.
		expect(names).toContain("os@9");
		// Blank `_ "net/http/pprof"` / `_ "unsafe"` and dot `. "math"` imports
		// bind no name — nothing emitted.
		expect(names).not.toContain("pprof");
		expect(names).not.toContain("unsafe");
		expect(names).not.toContain("math");
		expect(names).not.toContain("_");

		// The pool fills callerFile; import callerLine = the spec line (the
		// binding site); imports carry no enclosing caller (package-level).
		const first = imports[0];
		expect(first!.callerFile).toBe("go-imports.go");
		expect(first!.callerName).toBeNull();
		expect(first!.callerLine).toBe(3);
	});

	it("emits 'extends' edges for embedded interfaces, skipping unions/approximations and methods", async () => {
		const result = await parseOrSkip(
			"go-interface-embed.go",
			`package shapes

type Named interface {
    Name() string
}

type Embedded interface {
    Named
    Extra() int
}

type Reader interface {
    io.Reader
    Close() error
}

type Constrained interface {
    ~int | ~string
    Comparable
}

type Plain interface {
    int | float64
    Marker
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
		const heritage = refs.filter((r) => r.kind === "extends");

		// `interface Embedded { Named }` → 'Named' extends at the interface
		// declaration line, callerName null per the heritage contract.
		const extNamed = heritage.find((r) => r.symbolName === "Named");
		expect(extNamed).toBeDefined();
		expect(extNamed!.callerFile).toBe("go-interface-embed.go");
		expect(extNamed!.callerLine).toBe(7);
		expect(extNamed!.callerName).toBeNull();

		// Qualified embed `io.Reader` → LAST name segment 'Reader'.
		const extReader = heritage.find((r) => r.symbolName === "Reader");
		expect(extReader).toBeDefined();
		expect(extReader!.callerLine).toBe(12);
		expect(extReader!.callerName).toBeNull();

		// Plain embed inside a constraint interface.
		const extComparable = heritage.find((r) => r.symbolName === "Comparable");
		expect(extComparable).toBeDefined();
		expect(extComparable!.callerLine).toBe(17);

		// Union / approximation elements (`~int | ~string`) are NOT embedded
		// interfaces — no edges. Checked on union TERM (symbolName) rather
		// than callerLine: extends edges attach at the type_spec line
		// (17/22), never at a union-element line — the old `callerLine ===
		// 18` check was vacuous (always empty, even when the first union
		// element leaked an edge at line 17).
		expect(heritage.some((r) => r.symbolName === "int" || r.symbolName === "float64")).toBe(false);

		// Plain (non-approximated) union `int | float64` + standalone embed
		// `Marker`: the union is ONE type_elem with multiple named children
		// (skipped by the single-element guard), so 'Marker' is the ONLY
		// extends emitted from Plain — catches the regression where the
		// union's first element ('int') leaked a spurious edge at the spec
		// line.
		const extMarker = heritage.find((r) => r.symbolName === "Marker");
		expect(extMarker).toBeDefined();
		expect(extMarker!.callerFile).toBe("go-interface-embed.go");
		expect(extMarker!.callerLine).toBe(22);
		expect(extMarker!.callerName).toBeNull();

		// interface method requirements (Name/Extra/Close) are NOT embeds —
		// no edges for them (only the 4 extends above exist).
		expect(heritage).toHaveLength(4);
	});

	it("emits 'extends' edges for embedded struct fields (pointer/qualified/generic); named fields emit nothing", async () => {
		const result = await parseOrSkip(
			"go-struct-embed.go",
			`package repo

import "sync"

type Base struct {
    ID int
}

type Foo struct {
    Base
    *Mutex
    sync.RWMutex
    Base[int]
    name string
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
		const heritage = refs.filter((r) => r.kind === "extends");

		// All four embedded (anonymous) fields on the Foo declaration line,
		// callerName null per the heritage contract:
		//   Base          → type_identifier
		//   *Mutex        → pointer embed → 'Mutex' (LAST segment)
		//   sync.RWMutex  → qualified embed → 'RWMutex' (LAST segment)
		//   Base[int]     → generic embed → 'Base'
		const line9 = heritage.filter((r) => r.callerLine === 9);
		expect(line9.map((r) => r.symbolName).sort()).toEqual(["Base", "Base", "Mutex", "RWMutex"]);

		const extNamed = heritage.find((r) => r.symbolName === "Base");
		expect(extNamed!.callerFile).toBe("go-struct-embed.go");
		expect(extNamed!.callerName).toBeNull();

		// Named fields (`ID int`, `name string`) are NOT embeds — no edges on
		// their lines, and no 'name'/'ID'/'int' targets.
		expect(heritage.filter((r) => r.callerLine === 6)).toHaveLength(0);
		expect(heritage.some((r) => r.symbolName === "name" || r.symbolName === "ID" || r.symbolName === "int")).toBe(
			false
		);

		// The `import "sync"` edge still emits alongside the extends edges.
		const imports = refs.filter((r) => r.kind === "import");
		expect(imports.map((r) => r.symbolName)).toContain("sync");
	});

	it("emits call edges with the enclosing function/method as caller", async () => {
		const result = await parseOrSkip(
			"go-calls.go",
			`package main

type Repo struct{}

func (r *Repo) Save() error { return helper() }

func helper(x int) int { return x }

func main() {
    helper(1)
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
		const calls = refs.filter((r) => r.kind === "call");
		const names = calls.map((r) => `${r.symbolName}@${r.callerLine}`);

		// Plain call → 'helper'.
		expect(names).toContain("helper@5");
		expect(names).toContain("helper@10");

		// Method body calls track the METHOD name; function calls track the
		// FUNCTION name as caller.
		const methodCall = calls.find((r) => r.symbolName === "helper" && r.callerLine === 5);
		expect(methodCall!.callerName).toBe("Save");
		expect(methodCall!.callerFile).toBe("go-calls.go");

		const fnCall = calls.find((r) => r.symbolName === "helper" && r.callerLine === 10);
		expect(fnCall!.callerName).toBe("main");
	});
});
