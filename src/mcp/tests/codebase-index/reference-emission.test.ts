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
 *  'extends' edges for interface embedding (type_elem children) and struct
 *  embedding (anonymous field_declaration with no name field — pointer /
 *  qualified / generic embedded types resolve to the LAST name segment), and
 *  'call' edges for call expressions. The C and C++ visitors (TASK-308) emit
 *  'import' edges per preproc_include — the symbol name is the FULL header
 *  path with delimiters stripped (`"base.h"` → 'base.h', `<sys/stat.h>` →
 *  'sys/stat.h'; mapping header→symbol is out of scope, the include path
 *  string is the name) — and 'call' edges for call expressions (identifier /
 *  field_expression / qualified_identifier LAST-segment). The C++ visitor
 *  additionally emits heritage edges from class_specifier / struct_specifier
 *  base_class_clause: 'extends' for the FIRST base, 'implements' for each
 *  SUBSEQUENT base (position-based heuristic — C++ has no interface keyword;
 *  template_type / qualified / virtual bases resolve to the LAST name
 *  segment); C has no class heritage (verified — struct_specifier has no
 *  base_class_clause). The Rust visitor (TASK-307) emits 'import' edges per
 *  use_declaration binding (explicit `as` alias wins, else the LAST path
 *  segment; grouped `use foo::{...}` emits per member, recursing into nested
 *  groups; glob `use foo::*` and `self`/`super`/`crate` members emit nothing),
 *  'implements' edges for `impl Trait for Type` blocks (qualified / generic
 *  trait paths → LAST segment; inherent impls emit nothing) and for
 *  `#[derive(...)]` attributes on struct/enum (per derived trait, LAST segment
 *  of qualified paths, anchored at the declaration line), 'extends' edges for
 *  trait supertraits (`trait T: Super + Other`; `'static`-style lifetime
 *  bounds skipped), and 'call' edges (identifier / field_expression field /
 *  scoped_identifier name → LAST segment; macro_invocations emit nothing).
 *  The Swift visitor (TASK-309) emits 'import' edges per import_declaration
 *  (one edge per statement; binding = LAST name segment — `import class
 *  Foundation.URLSession` → 'URLSession'; the import-kind keyword is
 *  anonymous in the tree-sitter AST), heritage edges from the DIRECT
 *  `inheritance_specifier` children of class_declaration / protocol_declaration
 *  (class/actor: FIRST specifier → 'extends', each subsequent → 'implements';
 *  struct/extension → 'implements' each; enum → skipped — raw-value type
 *  indistinguishable from a conformance by name; protocol → 'extends' each),
 *  and 'call' edges for call_expressions (simple_identifier, or the LAST
 *  simple_identifier of a navigation_expression; dynamic targets like
 *  `(getFactory)()` emit nothing). The Ruby visitor (TASK-310) emits 'import'
 *  edges for require/require_relative/load calls — the FULL literal string
 *  path is the name (`require "json"` → 'json', mirroring the C/C++ include
 *  path decision from TASK-308; interpolated and non-literal args emit
 *  nothing) — 'extends' edges for the class superclass clause (`class Foo <
 *  Bar` → 'Bar'; qualified `< Outer::Base` → LAST segment 'Base') and for
 *  include/extend/prepend mixin calls (one per module argument, LAST segment
 *  of qualified names — mixins are inheritance-like, so kind stays 'extends'),
 *  and 'call' edges (method field identifier; chained receivers like `a.b.c`
 *  emit only the LAST segment 'c'). The Dart visitor (TASK-311) emits one
 *  'import' edge per library import directive — the FULL URI path with quotes
 *  stripped is the name (import path→symbol mapping is query-time, mirroring
 *  the C/C++ include/Ruby require decisions); exports and part directives
 *  emit nothing — 'extends' edges for the class superclass and the `with`
 *  mixin clause (heritage-like, mirroring the Ruby include decision), for the
 *  mixin `on` applicability constraint, and for the class-level generic bound
 *  (type_bound) — qualified (library-prefixed) heritage names resolve to the
 *  LAST segment (`extends pkg.Base` → 'Base', never 'pkg'), plus 'implements'
 *  edges per DIRECT interface target of the `implements` clause, and 'call'
 *  edges from `selector` argument lists and cascade_section nodes (chained
 *  receivers, nested calls and cascades emit the LAST callee segment; bare
 *  property selectors AND bare cascade properties like `..length` emit
 *  nothing; callerName = the enclosing method/constructor/function name).
 *  WASM-dependent — skips gracefully when WASM is missing.
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

describe("CppVisitor & CVisitor reference emission (TASK-308)", () => {
	it("C++: emits 'import' edges per preproc_include with the FULL stripped header path", async () => {
		const result = await parseOrSkip(
			"cpp-includes.cpp",
			`#include "base.h"
#include <vector>
#include "utils/math.h"
#include <sys/stat.h>

void run() {}
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

		// The include path string IS the name (mapping header→symbol is out
		// of scope per TASK-308): full path, delimiters stripped — quotes for
		// string_literal, angle brackets for system_lib_string.
		expect(names).toContain("base.h@1");
		expect(names).toContain("vector@2");
		expect(names).toContain("utils/math.h@3");
		expect(names).toContain("sys/stat.h@4");

		// The pool fills callerFile; includes carry no enclosing caller.
		const first = imports[0];
		expect(first!.callerFile).toBe("cpp-includes.cpp");
		expect(first!.callerName).toBeNull();
	});

	it("C++: emits 'extends' for the first base and 'implements' for each subsequent base", async () => {
		const result = await parseOrSkip(
			"cpp-heritage.cpp",
			`class Derived : public Base, protected ILeft, virtual IRight {
public:
  void run() {}
};
struct S : Base2 { int x; };
class Single : virtual Lonely {};
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const heritage = refs.filter((r) => r.kind === "extends" || r.kind === "implements");

		// FIRST base → 'extends' at the declaration line; subsequent bases →
		// 'implements' (position-based heuristic per TASK-308; `virtual` and
		// access_specifier nodes are not bases and don't shift the position).
		const extBase = heritage.find((r) => r.symbolName === "Base" && r.kind === "extends");
		expect(extBase).toBeDefined();
		expect(extBase!.callerFile).toBe("cpp-heritage.cpp");
		expect(extBase!.callerLine).toBe(1);
		expect(extBase!.callerName).toBeNull();

		const implILeft = heritage.find((r) => r.symbolName === "ILeft" && r.kind === "implements");
		expect(implILeft).toBeDefined();
		expect(implILeft!.callerLine).toBe(1);

		const implIRight = heritage.find((r) => r.symbolName === "IRight" && r.kind === "implements");
		expect(implIRight).toBeDefined();
		expect(implIRight!.callerLine).toBe(1);

		// Non-virtual single base on a struct → 'extends' (line 5).
		const extBase2 = heritage.find((r) => r.symbolName === "Base2" && r.kind === "extends");
		expect(extBase2).toBeDefined();
		expect(extBase2!.callerLine).toBe(5);

		// Single protected base → 'extends' (line 6).
		const extLonely = heritage.find((r) => r.symbolName === "Lonely" && r.kind === "extends");
		expect(extLonely).toBeDefined();
		expect(extLonely!.callerLine).toBe(6);
	});

	it("C++: resolves template / qualified bases to the LAST name segment; access specifiers leak nothing", async () => {
		const result = await parseOrSkip(
			"cpp-template-bases.cpp",
			`template <typename T>
class Gen : public Generic<T> {};
class Templ : public Base<int>, private Other<T>, virtual IFace {};
struct Alt { int x; };
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const heritage = refs.filter((r) => r.kind === "extends" || r.kind === "implements");

		// template_type `Generic<T>` → base is the first named child:
		// 'Generic' (template_declaration-wrapped class, line 2).
		const extGeneric = heritage.find((r) => r.symbolName === "Generic" && r.kind === "extends");
		expect(extGeneric).toBeDefined();
		expect(extGeneric!.callerLine).toBe(2);

		// `Base<int>` → 'Base':extends; `Other<T>` (private) →
		// 'Other':implements; `virtual IFace` → 'IFace':implements (all on
		// the Templ declaration line 3).
		const line3 = heritage.filter((r) => r.callerLine === 3);
		expect(line3.map((r) => `${r.symbolName}:${r.kind}`).sort()).toEqual([
			"Base:extends",
			"IFace:implements",
			"Other:implements"
		]);

		// Access specifiers (public/private/protected), template arguments
		// (int, typename T) and the `virtual` keyword never leak as base
		// targets — only the resolved base names are edges.
		expect(
			heritage.some((r) => ["public", "private", "protected", "virtual", "int", "typename", "T"].includes(r.symbolName))
		).toBe(false);
	});

	it("C++: emits call edges with the enclosing method as caller; dynamic calls emit nothing", async () => {
		const result = await parseOrSkip(
			"cpp-calls.cpp",
			`class Foo {
public:
  void update() {
    helper();
    obj.method();
    ns::func();
    a.b.c();
    X::Y::z();
    (*fp)();
  }
};
void top() {
  helper();
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

		// identifier → 'helper'; field_expression → LAST segment
		// ('obj.method' → 'method'); qualified_identifier → LAST segment
		// ('ns::func' → 'func'); nested `a.b.c()` → 'c'; `X::Y::z()` → 'z'.
		expect(names).toContain("helper@4");
		expect(names).toContain("method@5");
		expect(names).toContain("func@6");
		expect(names).toContain("c@7");
		expect(names).toContain("z@8");
		// `(*fp)()` → parenthesized_expression function → no edge.
		expect(calls.some((r) => r.symbolName === "fp")).toBe(false);

		// Method-body call tracks the METHOD name as caller; function-body
		// call tracks the FUNCTION name.
		const methodCall = calls.find((r) => r.symbolName === "helper" && r.callerLine === 4);
		expect(methodCall!.callerName).toBe("update");
		expect(methodCall!.callerFile).toBe("cpp-calls.cpp");

		const fnCall = calls.find((r) => r.symbolName === "helper" && r.callerLine === 13);
		expect(fnCall!.callerName).toBe("top");
	});

	it("C: emits include edges and call edges; structs have no heritage", async () => {
		const result = await parseOrSkip(
			"c-sanity.c",
			`#include <stdio.h>
#include "local.h"
#include <sys/types.h>
void run() {
  helper();
  obj.method();
  p->save();
  (*fp)();
}
struct S { int x; };
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
		expect(imports.map((r) => `${r.symbolName}@${r.callerLine}`)).toEqual(["stdio.h@1", "local.h@2", "sys/types.h@3"]);
		const first = imports[0];
		expect(first!.callerFile).toBe("c-sanity.c");
		expect(first!.callerName).toBeNull();

		const calls = refs.filter((r) => r.kind === "call");
		const names = calls.map((r) => `${r.symbolName}@${r.callerLine}`);
		expect(names).toContain("helper@5");
		expect(names).toContain("method@6");
		expect(names).toContain("save@7");
		// `(*fp)()` → no edge.
		expect(calls.some((r) => r.symbolName === "fp")).toBe(false);
		const methodCall = calls.find((r) => r.symbolName === "helper" && r.callerLine === 5);
		expect(methodCall!.callerName).toBe("run");

		// C has NO class heritage — `struct S { int x; }` emits no
		// extends/implements edges at all.
		expect(refs.some((r) => r.kind === "extends" || r.kind === "implements")).toBe(false);
	});

	it("C++/C: callerName pierces declarator wrappers (out-of-line, pointer/ref-returning, destructor) — FIX-349", async () => {
		const result = await parseOrSkip(
			"cpp-callername-pierce.cpp",
			`void Widget::outline() { helper2(); }
int *getPtr() { aCall(); }
int& getRef() { bCall(); }
class W {
public:
  ~W() { dCall(); }
};
void f(int x) { q(); }
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
		const byLine = new Map(calls.map((r) => [r.callerLine, r]));

		// Out-of-line definition: name is a qualified_identifier inside the
		// function_declarator → LAST segment 'outline' (was null before).
		expect(byLine.get(1)!.symbolName).toBe("helper2");
		expect(byLine.get(1)!.callerName).toBe("outline");
		// Pointer / reference-returning: function_declarator nested inside
		// pointer_declarator / reference_declarator → 'getPtr' / 'getRef'
		// (both were null before).
		expect(byLine.get(2)!.symbolName).toBe("aCall");
		expect(byLine.get(2)!.callerName).toBe("getPtr");
		expect(byLine.get(3)!.symbolName).toBe("bCall");
		expect(byLine.get(3)!.callerName).toBe("getRef");
		// Destructor: name is a destructor_name inside the
		// function_declarator → inner identifier 'W' (was null before).
		expect(byLine.get(6)!.symbolName).toBe("dCall");
		expect(byLine.get(6)!.callerName).toBe("W");
		// Parameter names (identifiers inside parameter_list) never leak as
		// the caller name — 'f' is the function, not 'x'.
		expect(byLine.get(8)!.symbolName).toBe("q");
		expect(byLine.get(8)!.callerName).toBe("f");
		expect(calls.some((r) => r.callerName === "x")).toBe(false);
	});

	it("C: callerName pierces pointer_declarator for pointer-returning functions — FIX-349", async () => {
		const result = await parseOrSkip(
			"c-callername-pierce.c",
			`int *getPtr() { aCall(); }
void top() { helper(); }
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
		const byLine = new Map(calls.map((r) => [r.callerLine, r]));
		expect(byLine.get(1)!.symbolName).toBe("aCall");
		expect(byLine.get(1)!.callerName).toBe("getPtr");
		expect(byLine.get(2)!.symbolName).toBe("helper");
		expect(byLine.get(2)!.callerName).toBe("top");
	});

	it("C++: attribute_declaration in base_class_clause is skipped — no spurious edge, first base stays extends — FIX-350", async () => {
		const result = await parseOrSkip(
			"cpp-attr-base.cpp",
			`class X : [[deprecated]] Base {};
class Y : public Base, [[nodiscard]] I2 {};
class Z : public B1, I3 {};
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const heritage = refs.filter((r) => r.kind === "extends" || r.kind === "implements");

		// `[[deprecated]]` is an attribute-specifier on the base-specifier —
		// legal C++, parses cleanly, but is NOT a base: it must not emit an
		// edge and must not shift the first REAL base to 'implements'.
		expect(heritage.some((r) => r.symbolName === "deprecated")).toBe(false);
		expect(heritage.some((r) => r.symbolName === "nodiscard")).toBe(false);
		const line1 = heritage.filter((r) => r.callerLine === 1);
		expect(line1).toHaveLength(1);
		expect(line1[0]).toMatchObject({ symbolName: "Base", kind: "extends", callerLine: 1, callerName: null });
		// Attribute mid-list: Base is still the first (extends) base, I2 the
		// second (implements).
		const line2 = heritage.filter((r) => r.callerLine === 2);
		expect(line2.map((r) => `${r.symbolName}:${r.kind}`).sort()).toEqual(["Base:extends", "I2:implements"]);
		// Regression: plain multi-base still extends-then-implements.
		const line3 = heritage.filter((r) => r.callerLine === 3);
		expect(line3.map((r) => `${r.symbolName}:${r.kind}`).sort()).toEqual(["B1:extends", "I3:implements"]);
	});
});

describe("RustVisitor reference emission (TASK-307)", () => {
	it("emits 'import' edges per use binding — alias wins, last segment, glob/self emit nothing", async () => {
		const result = await parseOrSkip(
			"rust-imports.rs",
			`use crate::a::b::Thing;
use foo::{x, y as z, deep::Nested};
use nested::{inner::{a, b as c}};
use bar::*;
use std::collections::HashMap as Map;
use std::fmt;
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

		// Simple path `use crate::a::b::Thing` → LAST segment 'Thing';
		// `use std::fmt` → 'fmt'.
		expect(names).toContain("Thing@1");
		expect(names).toContain("fmt@6");
		// Grouped `use foo::{...}` → per-member edges; alias wins (`y as z` → 'z');
		// `deep::Nested` → 'Nested'.
		expect(names).toContain("x@2");
		expect(names).toContain("z@2");
		expect(names).toContain("Nested@2");
		// Nested group `use nested::{inner::{...}}` recurses.
		expect(names).toContain("a@3");
		expect(names).toContain("c@3");
		// `as Map` alias wins over the path's last segment ('HashMap').
		expect(names).toContain("Map@5");
		expect(names).not.toContain("HashMap@5");
		// Glob `use bar::*` binds no name — nothing on its line, no '*' edge.
		expect(imports.filter((r) => r.callerLine === 4)).toHaveLength(0);
		expect(names.some((n) => n.includes("*"))).toBe(false);

		// The pool fills callerFile; top-level imports carry no caller.
		const first = imports[0];
		expect(first!.callerFile).toBe("rust-imports.rs");
		expect(first!.callerName).toBeNull();
		expect(first!.callerLine).toBe(1);
	});

	it("emits 'implements' edges for impl Trait for Type (qualified/generic); inherent impls emit nothing", async () => {
		const result = await parseOrSkip(
			"rust-impl.rs",
			`use std::fmt;

impl std::fmt::Display for crate::models::User {}
impl serde::Serialize for MyType {}
impl Iterator<Item = u8> for MyVec {}
impl<T> MyTrait for MyStruct<T> {}
impl Base { fn a() {} }
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const heritage = refs.filter((r) => r.kind === "implements");
		const names = heritage.map((r) => `${r.symbolName}@${r.callerLine}`);

		// Qualified trait path → LAST segment: std::fmt::Display → 'Display',
		// serde::Serialize → 'Serialize'.
		expect(names).toContain("Display@3");
		expect(names).toContain("Serialize@4");
		// Generic trait `Iterator<Item = u8>` → 'Iterator'; generic impl
		// `impl<T> MyTrait for ...` works.
		expect(names).toContain("Iterator@5");
		expect(names).toContain("MyTrait@6");
		// Inherent impl `impl Base { ... }` has NO trait field → no edge.
		expect(heritage.filter((r) => r.callerLine === 7)).toHaveLength(0);

		// Heritage contract: callerLine = the impl block line; callerName null;
		// target fields left null (name-based resolution per ADR-002).
		const implDisplay = heritage.find((r) => r.symbolName === "Display");
		expect(implDisplay!.callerFile).toBe("rust-impl.rs");
		expect(implDisplay!.callerLine).toBe(3);
		expect(implDisplay!.callerName).toBeNull();
		expect(implDisplay!.targetFile).toBeNull();
		expect(implDisplay!.targetSymbolId).toBeNull();

		// The `use std::fmt;` import edge still emits alongside.
		expect(refs.filter((r) => r.kind === "import").map((r) => r.symbolName)).toContain("fmt");
	});

	it("emits 'extends' edges for trait supertraits, skipping lifetime bounds", async () => {
		const result = await parseOrSkip(
			"rust-trait.rs",
			`pub trait SuperTrait {}

pub trait MyTrait: SuperTrait + OtherTrait {}

pub trait Qualified: crate::base::TraitBase + core::fmt::Debug {}

pub trait Bounded: Foo<u8> + std::ops::Add<f64> + 'static + Sized {}
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
		const names = heritage.map((r) => `${r.symbolName}@${r.callerLine}`);

		// Plain supertraits.
		expect(names).toContain("SuperTrait@3");
		expect(names).toContain("OtherTrait@3");
		// Qualified supertraits → LAST segment: crate::base::TraitBase →
		// 'TraitBase', core::fmt::Debug → 'Debug'.
		expect(names).toContain("TraitBase@5");
		expect(names).toContain("Debug@5");
		// Generic bounds: Foo<u8> → 'Foo', std::ops::Add<f64> → 'Add'.
		expect(names).toContain("Foo@7");
		expect(names).toContain("Add@7");
		// 'static lifetime bound is NOT a trait → no edge and no spurious
		// 'static symbol; Sized is a real (auto)trait.
		expect(names).toContain("Sized@7");
		expect(heritage.some((r) => r.symbolName === "static")).toBe(false);
		expect(heritage).toHaveLength(7);

		const extSuper = heritage.find((r) => r.symbolName === "SuperTrait");
		expect(extSuper!.callerFile).toBe("rust-trait.rs");
		expect(extSuper!.callerName).toBeNull();
	});

	it("emits 'implements' edges per derived trait in #[derive(...)], skipping non-derive attributes", async () => {
		const result = await parseOrSkip(
			"rust-derive.rs",
			`#[derive(Debug, Clone, serde::Serialize)]
pub struct User {}

#[derive(PartialEq)]
enum Color { Red, Green }

#[repr(C)]
#[derive(Copy, Clone)]
pub struct Plain {}
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const heritage = refs.filter((r) => r.kind === "implements");
		const names = heritage.map((r) => `${r.symbolName}@${r.callerLine}`);

		// One edge per derived trait, anchored at the STRUCT/ENUM declaration
		// line (the derived type), NOT the attribute line.
		expect(names).toContain("Debug@2");
		expect(names).toContain("Clone@2");
		// Qualified derive path `serde::Serialize` → LAST segment 'Serialize'
		// (the token_tree is flat — 'serde' must not leak a spurious edge).
		expect(names).toContain("Serialize@2");
		expect(heritage.some((r) => r.symbolName === "serde")).toBe(false);
		// Enum derive.
		expect(names).toContain("PartialEq@5");
		// Stacked attributes: `#[repr(C)]` is NOT a derive → skipped, only
		// `#[derive(Copy, Clone)]` on the Plain struct emits.
		expect(names).toContain("Copy@9");
		expect(names).toContain("Clone@9");
		expect(heritage.some((r) => r.symbolName === "repr" || r.symbolName === "C")).toBe(false);
		expect(heritage).toHaveLength(6);

		const deriveDebug = heritage.find((r) => r.symbolName === "Debug");
		expect(deriveDebug!.callerFile).toBe("rust-derive.rs");
		expect(deriveDebug!.callerName).toBeNull();
	});

	it("emits call edges with the enclosing function/method as caller; macros emit nothing", async () => {
		const result = await parseOrSkip(
			"rust-calls.rs",
			`impl Greeter {
    fn greet(&self) { helper(); }
}

pub fn run() {
    let s = obj.method();
    std::io::read(&s);
    self::helper();
    helper();
    println!("hi");
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

		// Plain call → 'helper'; method body calls track the METHOD name;
		// function body calls track the FUNCTION name as caller.
		expect(names).toContain("helper@2");
		const methodCall = calls.find((r) => r.symbolName === "helper" && r.callerLine === 2);
		expect(methodCall!.callerName).toBe("greet");
		expect(methodCall!.callerFile).toBe("rust-calls.rs");

		// `obj.method()` → field_expression field 'method'; `std::io::read()`
		// and `self::helper()` → scoped_identifier name (LAST segment).
		expect(names).toContain("method@6");
		expect(names).toContain("read@7");
		expect(names).toContain("helper@8");
		expect(names).toContain("helper@9");
		const fnCall = calls.find((r) => r.symbolName === "helper" && r.callerLine === 9);
		expect(fnCall!.callerName).toBe("run");

		// `println!` is a macro_invocation, NOT a call_expression → no edge.
		expect(calls.some((r) => r.symbolName === "println")).toBe(false);
	});
});

describe("SwiftVisitor reference emission (TASK-309)", () => {
	it("emits 'import' edges per import_declaration with LAST-segment binding; the import-kind keyword is anonymous", async () => {
		const result = await parseOrSkip(
			"swift-imports.swift",
			`import UIKit
import class Foundation.URLSession
import func Darwin.pow

func run() {}
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

		// One edge per statement; plain `import UIKit` → 'UIKit'; the
		// import-KIND keyword ('class' | 'func' | ...) is ANONYMOUS at the
		// AST level (verified against the shipped WASM), so the binding is
		// the LAST name segment: 'Foundation.URLSession' → 'URLSession'.
		expect(names).toEqual(["UIKit@1", "URLSession@2", "pow@3"]);

		// The pool fills callerFile; imports carry no enclosing caller.
		const first = imports[0];
		expect(first!.callerFile).toBe("swift-imports.swift");
		expect(first!.callerName).toBeNull();
	});

	it("emits 'extends' for the first class base and 'implements' for each subsequent (incl. & composition); protocols extend every target", async () => {
		const result = await parseOrSkip(
			"swift-heritage.swift",
			`class Foo: Base, Proto1, Proto2 {
    func helper() { _ = self.save() }
}

class Composed: Base & Proto {
}

protocol P: Q, R {
  func requirement()
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
		const heritage = refs.filter((r) => r.kind === "extends" || r.kind === "implements");

		// FIRST base → 'extends' at the declaration line, subsequent →
		// 'implements' (position-based heuristic; Swift can't name-distinguish
		// a lone first protocol from a superclass — documented limitation).
		const extBase = heritage.find((r) => r.symbolName === "Base" && r.kind === "extends");
		expect(extBase).toBeDefined();
		expect(extBase!.callerFile).toBe("swift-heritage.swift");
		expect(extBase!.callerLine).toBe(1);
		expect(extBase!.callerName).toBeNull();

		const implProto1 = heritage.find((r) => r.symbolName === "Proto1" && r.kind === "implements");
		expect(implProto1).toBeDefined();
		expect(implProto1!.callerLine).toBe(1);
		expect(implProto1!.callerName).toBeNull();

		const implProto2 = heritage.find((r) => r.symbolName === "Proto2" && r.kind === "implements");
		expect(implProto2).toBeDefined();
		expect(implProto2!.callerLine).toBe(1);

		// `Base & Proto` composition → one inheritance_specifier PER element
		// (verified in the WASM): first 'extends', second 'implements'.
		const compBase = heritage.find((r) => r.symbolName === "Base" && r.callerLine === 5);
		expect(compBase!.kind).toBe("extends");
		const compProto = heritage.find((r) => r.symbolName === "Proto" && r.kind === "implements");
		expect(compProto).toBeDefined();
		expect(compProto!.callerLine).toBe(5);

		// protocol P: Q, R → EVERY inheritance target is 'extends'.
		const extQ = heritage.find((r) => r.symbolName === "Q" && r.kind === "extends");
		expect(extQ).toBeDefined();
		expect(extQ!.callerLine).toBe(8);
		const extR = heritage.find((r) => r.symbolName === "R" && r.kind === "extends");
		expect(extR).toBeDefined();
		expect(extR!.callerLine).toBe(8);

		// Regression: call emission inside a method body unchanged — the
		// method name is threaded as callerName.
		const saveCall = refs.find((r) => r.symbolName === "save" && r.kind === "call");
		expect(saveCall).toBeDefined();
		expect(saveCall!.callerLine).toBe(2);
		expect(saveCall!.callerName).toBe("helper");
	});

	it("emits 'implements' for struct/extension conformances and LAST-segment resolution; enum heritage is skipped", async () => {
		const result = await parseOrSkip(
			"swift-conformances.swift",
			`struct S: ProtoA, ProtoB {
  var x: Int = 0
}

extension Foo: ExtraProto {
  func helper() { _ = multiply(2, 3) }
}

enum E: Int, CaseIterable {
  case a
}

class Generic<T>: Base<T>, ns.GenericProto {
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
		const heritage = refs.filter((r) => r.kind === "extends" || r.kind === "implements");

		// struct S: ProtoA, ProtoB — structs have no superclass → every
		// conformance is 'implements'.
		const implProtoA = heritage.find((r) => r.symbolName === "ProtoA" && r.kind === "implements");
		expect(implProtoA).toBeDefined();
		expect(implProtoA!.callerLine).toBe(1);
		expect(implProtoA!.callerName).toBeNull();
		expect(heritage.find((r) => r.symbolName === "ProtoB" && r.kind === "implements")).toBeDefined();

		// extension Foo: ExtraProto — same: 'implements' at the declaration line.
		const implExtra = heritage.find((r) => r.symbolName === "ExtraProto" && r.kind === "implements");
		expect(implExtra).toBeDefined();
		expect(implExtra!.callerLine).toBe(5);

		// enum E: Int, CaseIterable — SKIPPED entirely: 'Int' is a raw-value
		// type sharing the exact AST shape of a conformance; name-based
		// resolution cannot distinguish them (documented limitation).
		expect(heritage.some((r) => r.symbolName === "Int" || r.symbolName === "CaseIterable")).toBe(false);

		// generic Base<T> → 'Base':extends (type_arguments excluded); dotted
		// ns.GenericProto → LAST segment 'GenericProto':implements.
		const extGeneric = heritage.find((r) => r.symbolName === "Base" && r.kind === "extends");
		expect(extGeneric).toBeDefined();
		expect(extGeneric!.callerLine).toBe(13);
		expect(heritage.find((r) => r.symbolName === "GenericProto" && r.kind === "implements")).toBeDefined();

		// Method call regression inside the extension body.
		const multCall = refs.find((r) => r.symbolName === "multiply" && r.kind === "call");
		expect(multCall).toBeDefined();
		expect(multCall!.callerName).toBe("helper");
		expect(multCall!.callerLine).toBe(6);
	});

	it("emits 'call' edges (identifier / navigation LAST segment) with the enclosing function as caller; dynamic targets emit nothing", async () => {
		const result = await parseOrSkip(
			"swift-calls.swift",
			`func topCall() {
  helper()
  obj.save()
  self.update()
  a.b.c()
  (getFactory)()
  NSObject.init()
  let c = C()
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

		// identifier → 'helper'; navigation_expression → LAST simple identifier
		// segment: 'obj.save' → 'save', 'self.update' → 'update', 'a.b.c' → 'c'.
		expect(names).toContain("helper@2");
		expect(names).toContain("save@3");
		expect(names).toContain("update@4");
		expect(names).toContain("c@5");
		// `NSObject.init()` → LAST segment 'init' (name-based, documented);
		// `C()` initializer call → 'C'.
		expect(names).toContain("init@7");
		expect(names).toContain("C@8");
		// `(getFactory)()` → tuple_expression-call target (dynamic) → no edge
		// (and no 'getFactory' from a paren-wrapped identifier).
		expect(calls.some((r) => r.symbolName === "getFactory")).toBe(false);

		// Every call tracks the enclosing FUNCTION name as caller.
		for (const c of calls) {
			expect(c.callerName).toBe("topCall");
			expect(c.callerFile).toBe("swift-calls.swift");
		}
	});
});

describe("RubyVisitor reference emission (TASK-310)", () => {
	it("emits 'import' edges for require/require_relative/load with the full literal path as the name; interpolated/non-literal args emit nothing", async () => {
		const result = await parseOrSkip(
			"ruby-imports.rb",
			`require "json"
require_relative "./models/user"
load "tasks/seed.rb"

class Boot
  require "nested/req"
  require "#{dir}/dynamic"
  require File.join("a", "b")
end
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

		// The FULL literal path is the imported name (mirrors the C/C++
		// include-path decision — TASK-308; a require path is a single
		// identifier, no last-segment splitting).
		expect(names).toContain("json@1");
		expect(names).toContain("./models/user@2");
		expect(names).toContain("tasks/seed.rb@3");
		// require works inside class bodies too.
		expect(names).toContain("nested/req@6");
		// Interpolated ("#{dir}/x") and non-literal (File.join(...)) require
		// args have no statically resolvable path → no import edge.
		expect(imports.filter((r) => r.callerLine === 7 || r.callerLine === 8)).toHaveLength(0);

		// The pool fills callerFile; requires are file-scope statements.
		const first = imports[0];
		expect(first!.callerFile).toBe("ruby-imports.rb");
		expect(first!.callerName).toBeNull();
		expect(first!.callerLine).toBe(1);
		expect(first!.targetFile).toBeNull();
		expect(first!.targetSymbolId).toBeNull();
	});

	it("emits 'extends' for the class superclass (incl. qualified LAST segment) and for include/extend/prepend mixins", async () => {
		const result = await parseOrSkip(
			"ruby-heritage.rb",
			`class Vehicle
end

class Car < Vehicle
  include Drivable, Enumerable
  extend Other::Mod, Addon
  prepend Observable
end

module Outer
  class Inner < Outer::Base
  end
end
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

		// Class superclass → 'extends' at the declaration line; callerName null.
		const extVehicle = heritage.find((r) => r.symbolName === "Vehicle" && r.kind === "extends");
		expect(extVehicle).toBeDefined();
		expect(extVehicle!.callerFile).toBe("ruby-heritage.rb");
		expect(extVehicle!.callerLine).toBe(4);
		expect(extVehicle!.callerName).toBeNull();
		expect(extVehicle!.targetFile).toBeNull();
		expect(extVehicle!.targetSymbolId).toBeNull();

		// Qualified superclass `Outer::Base` → LAST segment 'Base'.
		const extBase = heritage.find((r) => r.symbolName === "Base" && r.kind === "extends");
		expect(extBase).toBeDefined();
		expect(extBase!.callerLine).toBe(11);

		// include/extend/prepend mixins → 'extends' per argument at the call
		// line; multi-arg include emits one edge per module; qualified module
		// names resolve to the LAST segment ('Other::Mod' → 'Mod').
		expect(heritage.map((r) => `${r.symbolName}@${r.callerLine}`)).toContain("Drivable@5");
		expect(heritage.map((r) => `${r.symbolName}@${r.callerLine}`)).toContain("Enumerable@5");
		expect(heritage.map((r) => `${r.symbolName}@${r.callerLine}`)).toContain("Mod@6");
		expect(heritage.map((r) => `${r.symbolName}@${r.callerLine}`)).toContain("Addon@6");
		const mixin = heritage.find((r) => r.symbolName === "Drivable");
		expect(mixin!.callerName).toBeNull();
	});

	it("emits 'call' edges with the enclosing method as caller; chained receivers emit only the LAST segment", async () => {
		const result = await parseOrSkip(
			"ruby-calls.rb",
			`def drive
  helper()
  obj.save
  a.b.c
  self.update
  attr_accessor :name
end
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

		// Plain identifier → 'helper'; member-style receiver → the method
		// field identifier ('save', 'update'); `attr_accessor` is a plain call.
		expect(names).toContain("helper@2");
		expect(names).toContain("save@3");
		expect(names).toContain("update@5");
		expect(names).toContain("attr_accessor@6");
		// `a.b.c` — the receiver subtree is a path component, so ONLY the LAST
		// segment 'c' is emitted (no 'b' edge).
		expect(names).toContain("c@4");
		expect(calls.some((r) => r.symbolName === "b")).toBe(false);

		// Every call tracks the enclosing METHOD name as caller.
		for (const c of calls) {
			expect(c.callerName).toBe("drive");
			expect(c.callerFile).toBe("ruby-calls.rb");
			expect(c.targetFile).toBeNull();
			expect(c.targetSymbolId).toBeNull();
		}
	});
});

describe("DartVisitor reference emission (TASK-311)", () => {
	it("emits one 'import' edge per library import with the full URI (quotes stripped) as the name; exports and parts emit nothing", async () => {
		const result = await parseOrSkip(
			"dart-imports.dart",
			`import 'dart:math';
import 'package:foo/bar.dart' as fb show Baz, qux hide Secret;
import "src/local.dart";

export 'src/dep.dart';
part 'src/other.dart';
part of 'src/library.dart';
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

		// The FULL URI path is the imported name (quotes stripped); the `as`
		// alias and show/hide combinators are selection granularity, NOT edges.
		expect(names).toContain("dart:math@1");
		expect(names).toContain("package:foo/bar.dart@2");
		expect(names).toContain("src/local.dart@3");
		// export / part / part-of are NOT imports.
		expect(imports).toHaveLength(3);

		// The pool fills callerFile; imports are file-scope statements.
		const first = imports[0];
		expect(first!.callerFile).toBe("dart-imports.dart");
		expect(first!.callerName).toBeNull();
		expect(first!.callerLine).toBe(1);
		expect(first!.targetFile).toBeNull();
		expect(first!.targetSymbolId).toBeNull();
	});

	it("emits 'extends' for the superclass and with-mixins, 'implements' per interface, the mixin on-constraint and the class-level generic bound", async () => {
		const result = await parseOrSkip(
			"dart-heritage.dart",
			`abstract class Animal implements Comparable<Animal> {
  int get age;
}

class Dog extends Animal with Fable, Juggable implements Barkable, Playable {
}

mixin Fetcher {
  void fetch() {}
}

mixin Jumper on Animal {
  void jump() {}
}

class Generic<T extends Animal> implements Listenable<T> {
  final T value;
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
		const heritage = refs.filter((r) => r.kind === "extends" || r.kind === "implements");

		// Class superclass → 'extends' at the declaration line; callerName null
		// per the heritage contract.
		const extAnimal = heritage.find((r) => r.symbolName === "Animal" && r.kind === "extends" && r.callerLine === 5);
		expect(extAnimal).toBeDefined();
		expect(extAnimal!.callerFile).toBe("dart-heritage.dart");
		expect(extAnimal!.callerLine).toBe(5);
		expect(extAnimal!.callerName).toBeNull();
		expect(extAnimal!.targetFile).toBeNull();
		expect(extAnimal!.targetSymbolId).toBeNull();

		const hnames = heritage.map((r) => `${r.symbolName}:${r.kind}@${r.callerLine}`);
		// with-mixins → 'extends' (inheritance-like heritage, per the task decision).
		expect(hnames).toContain("Fable:extends@5");
		expect(hnames).toContain("Juggable:extends@5");
		// implements list → one 'implements' per DIRECT interface target.
		expect(hnames).toContain("Barkable:implements@5");
		expect(hnames).toContain("Playable:implements@5");
		// The declaring class itself and generic type-argument targets are NOT
		// edges ('Comparable<Animal>' → 'Comparable' only; type args nested).
		expect(heritage.some((r) => r.symbolName === "Dog")).toBe(false);
		expect(hnames).toContain("Comparable:implements@1");
		expect(heritage.some((r) => r.symbolName === "Animal" && r.kind === "implements")).toBe(false);
		// mixin `on` applicability constraint → 'extends' (no edge for a mixin
		// without an `on` clause — 'Fetcher').
		expect(hnames).toContain("Animal:extends@12");
		expect(heritage.some((r) => r.symbolName === "Fetcher")).toBe(false);
		// class-level generic bound → 'extends' (mirrors TS TASK-301).
		expect(hnames).toContain("Listenable:implements@16");
		expect(hnames).toContain("Animal:extends@16");
	});

	it("resolves qualified (library-prefixed) heritage names to the LAST segment — the library prefix is never an edge", async () => {
		const result = await parseOrSkip(
			"dart-heritage-qualified.dart",
			`class C extends pkg.Base {}
class D implements pkg.A, B {}
class E with pkg.M1, M2 {}
mixin F on pkg.T {}
mixin H on pkg.T, U {}
class G<T extends pkg.V> implements Listenable<T> {}
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const heritage = refs.filter((r) => r.kind === "extends" || r.kind === "implements");
		const hnames = heritage.map((r) => `${r.symbolName}:${r.kind}@${r.callerLine}`);

		// The hidden _type_name/_type_dot_identifier rules hoist BOTH 'pkg' and
		// 'Base' as direct type_identifiers — the LAST per segment wins.
		expect(hnames).toContain("Base:extends@1");
		expect(hnames).toContain("A:implements@2");
		expect(hnames).toContain("B:implements@2");
		expect(hnames).toContain("M1:extends@3");
		expect(hnames).toContain("M2:extends@3");
		expect(hnames).toContain("T:extends@4");
		expect(hnames).toContain("T:extends@5");
		expect(hnames).toContain("U:extends@5");
		expect(hnames).toContain("V:extends@6");
		expect(hnames).toContain("Listenable:implements@6");
		// The library prefix is a path component — never a heritage target, and
		// generic type arguments stay nested (no edge).
		expect(heritage.some((r) => r.symbolName === "pkg")).toBe(false);
		expect(heritage.some((r) => r.symbolName === "T" && r.kind === "implements")).toBe(false);
	});

	it("emits 'call' edges with the enclosing method as caller; chained receivers, nested calls and cascades emit only the LAST callee; bare property selectors and bare cascade properties emit nothing", async () => {
		const result = await parseOrSkip(
			"dart-calls.dart",
			`class Greeter {
  String greet(String name) {
    final msg = format(name);
    return msg.length;
  }
}
String format(String name) => 'Hi $name';
void main() {
  final g = Greeter();
  g.greet('bob');
  print('done');
  g.greet('a').toUpperCase();
  final nested = foo(bar());
  list..add(1)..add(2);
  list..length;
  list..first;
  list..add(1)..first;
}
int foo(int x) => x;
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

		expect(names).toContain("format@3");
		expect(names).toContain("Greeter@9");
		expect(names).toContain("greet@10");
		expect(names).toContain("print@11");
		// `g.greet('a').toUpperCase()` → 'greet' AND 'toUpperCase'; the receiver
		// `g` is a path component, never a call site.
		expect(names).toContain("greet@12");
		expect(names).toContain("toUpperCase@12");
		expect(calls.some((r) => r.symbolName === "g")).toBe(false);
		// Nested call `foo(bar())` → BOTH callees.
		expect(names).toContain("foo@13");
		expect(names).toContain("bar@13");
		// Cascade `list..add(1)..add(2)` → one 'add' edge PER cascade section.
		expect(calls.filter((r) => r.symbolName === "add" && r.callerLine === 14)).toHaveLength(2);
		// Bare property access (`msg.length`) without `()` is NOT a call.
		expect(calls.some((r) => r.symbolName === "length")).toBe(false);
		// Bare cascade property selectors (`list..length`, `list..first`) carry
		// no argument list → NOT calls, at any position in a cascade chain.
		expect(calls.some((r) => r.symbolName === "length" && r.callerLine === 15)).toBe(false);
		expect(calls.some((r) => r.symbolName === "first")).toBe(false);
		// `list..add(1)..first` → the trailing `..first` is property access but
		// the `..add(1)` section before it still emits exactly one call.
		expect(calls.filter((r) => r.symbolName === "add" && r.callerLine === 17)).toHaveLength(1);

		// callerName = the enclosing method/function name.
		const formatCall = calls.find((r) => r.symbolName === "format");
		expect(formatCall!.callerName).toBe("greet");
		const greetCall = calls.find((r) => r.symbolName === "greet" && r.callerLine === 10);
		expect(greetCall!.callerName).toBe("main");
		expect(greetCall!.callerFile).toBe("dart-calls.dart");
		expect(greetCall!.targetFile).toBeNull();
		expect(greetCall!.targetSymbolId).toBeNull();
	});
});

describe("VueVisitor reference emission (TASK-312)", () => {
	it("emits import edges per binding inside <script setup> and <script> blocks", async () => {
		const result = await parseOrSkip(
			"vue-component.vue",
			`<template>
  <div>
    <MyComponent :prop="x" />
    <base-button @click="go">Go</base-button>
    <span>{{ msg }}</span>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed } from 'vue'
import MyComponent from './components/MyComponent.vue'
import * as store from './store'
import type { Foo, Bar as Baz } from './types'
import './styles.css'
import Def, { named } from './mixed'
const msg = ref('hello')
const dynamic = import('./lazy')
</script>

<script>
import LegacyThing from './legacy'
export default {
  name: 'Plain'
}
</script>

<style scoped>
.red { color: red; }
</style>
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
		// Named imports (single line) inside <script setup>.
		expect(names).toContain("ref@10");
		expect(names).toContain("computed@10");
		// Default import — the binding name is the reference, not the module path.
		expect(names).toContain("MyComponent@11");
		// Namespace import resolves to the alias (`* as store` → 'store').
		expect(names).toContain("store@12");
		// Type-only import: imported name wins over the `as` alias (TS emitImports
		// semantics — `Bar as Baz` → 'Bar').
		expect(names).toContain("Foo@13");
		expect(names).toContain("Bar@13");
		// Mixed default + named in one statement.
		expect(names).toContain("Def@15");
		expect(names).toContain("named@15");
		// A second plain <script> block is scanned too.
		expect(names).toContain("LegacyThing@21");

		// Side-effect imports (`import './styles.css'`) carry no binding → no edge;
		// dynamic `import('./lazy')` is not an import statement → no edge; the
		// `const msg = ref(...)` line never produces an import edge.
		expect(names).not.toContain("styles");
		expect(names).not.toContain("lazy");
		expect(imports.filter((r) => r.callerLine === 14)).toHaveLength(0);

		// Imports are file-scope: callerName null; the pool fills callerFile;
		// targets are explicit null (canonical TASK-347 pattern).
		const first = imports[0];
		expect(first!.callerName).toBeNull();
		expect(first!.callerFile).toBe("vue-component.vue");
		expect(first!.targetFile).toBeNull();
		expect(first!.targetSymbolId).toBeNull();
	});

	it("emits instantiation edges for template component tags, skipping native elements", async () => {
		const result = await parseOrSkip(
			"vue-template.vue",
			`<template>
  <div>
    <MyComponent :prop="x" />
    <base-button @click="go">Go</base-button>
    <span>{{ msg }}</span>
    <div>
      <NestedComp />
    </div>
    <keep-alive>
      <router-view />
    </keep-alive>
  </div>
</template>

<script setup lang="ts">
const msg = ref('hello')
</script>
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const insts = refs.filter((r) => r.kind === "instantiation");
		const names = insts.map((r) => `${r.symbolName}@${r.callerLine}`);
		// PascalCase component tag.
		expect(names).toContain("MyComponent@3");
		// kebab-case component tag.
		expect(names).toContain("base-button@4");
		// Nested component inside a nested native element.
		expect(names).toContain("NestedComp@7");
		// Vue built-in kebab-case components are usages too (harmless dangling
		// name-based edges).
		expect(names).toContain("keep-alive@9");
		expect(names).toContain("router-view@10");

		// Native elements (`div`, `span`) emit nothing.
		expect(names.some((n) => n.startsWith("div") || n.startsWith("span"))).toBe(false);

		// Template usage has no enclosing function: callerName null.
		const comp = insts.find((r) => r.symbolName === "MyComponent");
		expect(comp).toBeDefined();
		expect(comp!.callerName).toBeNull();
		expect(comp!.callerFile).toBe("vue-template.vue");
		expect(comp!.targetFile).toBeNull();
		expect(comp!.targetSymbolId).toBeNull();
	});

	it("emits nothing for native-only templates or script-less SFCs", async () => {
		const result = await parseOrSkip(
			"vue-native.vue",
			`<template>
  <div>
    <span>plain text</span>
    <section>
      <p>hello</p>
    </section>
  </div>
</template>

<style scoped>
.red { color: red; }
</style>
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		// No script block → no import edges; all-lowercase native tags → no
		// instantiation edges; no heritage/call kinds anywhere in a Vue SFC.
		expect(refs).toHaveLength(0);
	});

	it("recurses into <template> wrappers (slot/v-if) emitting nested component instantiations", async () => {
		const result = await parseOrSkip(
			"vue-template-wrappers.vue",
			`<template>
  <div>
    <template #header>
      <MySlotComp />
    </template>
    <template v-if="ok">
      <VIfComp />
    </template>
  </div>
</template>
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		// The grammar's `_node` includes `template_element`, so `<template
		// #header>` / `<template v-if>` wrappers are NOT `element` nodes —
		// walkTemplate must recurse into them or these components stay silent
		// (review FIX-1). Each nested component instantiation edge anchors at
		// its own tag line.
		const refs = result.references ?? [];
		const insts = refs.filter((r) => r.kind === "instantiation");
		const names = insts.map((r) => `${r.symbolName}@${r.callerLine}`);
		expect(names).toContain("MySlotComp@4");
		expect(names).toContain("VIfComp@7");
		// The `template` wrapper itself emits nothing (lowercase built-in tag).
		expect(names.some((n) => n.startsWith("template"))).toBe(false);
	});

	it("pins callerLine for multi-line named imports and type-default imports", async () => {
		const result = await parseOrSkip(
			"vue-script-imports.vue",
			`<script lang="ts" setup>
import {
  namedA,
  namedB
} from './mod'
import type Foo from './types'
</script>
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
		// Multi-line named import: BOTH bindings anchor at the statement's
		// start line (the negative-lookahead + brace-split is the most
		// failure-prone part of SCRIPT_IMPORT_RE — review FIX-4).
		expect(names).toContain("namedA@2");
		expect(names).toContain("namedB@2");
		// `import type Foo from './types'` — type modifier + default binding →
		// one edge for the binding (type stripped by the regex).
		expect(names).toContain("Foo@6");

		// FIX-3: no garbage rows — a `{\n` fragment (comment/truncation shape)
		// is not a valid identifier, so it must never reach symbol_name.
		expect(imports.some((r) => r.symbolName.includes("{") || r.symbolName.includes("\n"))).toBe(false);
		expect(imports.some((r) => r.symbolName === "default")).toBe(false);
	});

	it("emits no import edge for template-literal import lookalikes not at a line start", async () => {
		const result = await parseOrSkip(
			"vue-string-context.vue",
			`<script lang="ts">
const snippet = \`sql example: import fake from './fake.sql'\`
</script>
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		// SCRIPT_IMPORT_RE is line-anchored: mid-line import-looking text
		// inside a template literal does NOT match → zero edges. (A line-START
		// `import` inside a template literal remains an accepted false
		// positive — documented in the SCRIPT_IMPORT_RE JSDoc; a TS-grammar
		// re-parse is out of scope per the TASK-312 constraints. Review FIX-4.)
		const refs = result.references ?? [];
		expect(refs).toHaveLength(0);
	});
});
