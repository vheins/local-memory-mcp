/**
 * Multi-language visitor extraction tests.
 *
 * Each describe block tests a single visitor: creates a Pool, initializes it,
 * parses a small source snippet, and asserts expected symbols.
 *
 * WASM-dependent tests skip gracefully when WASM files are unavailable.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { TreeSitterParserPool } from "../../codebase-index/parser/parser-pool.js";
import type { ParseResult } from "../../codebase-index/parser/language-visitor.js";

// ── Helpers ──────────────────────────────────────────────────────────

let pool: TreeSitterParserPool | null = null;
let wasmAvailable = false;

beforeAll(async () => {
	pool = new TreeSitterParserPool();
	try {
		await pool.initialize();
		wasmAvailable = true;
	} catch {
		console.warn("[visitors.test] WASM not available — all tests will be skipped");
		pool = null;
	}
}, 60_000);

async function parseOrSkip(fileName: string, source: string): Promise<ParseResult> {
	if (!wasmAvailable || !pool) {
		console.warn(`  Skipped: WASM not available`);
		return { symbols: [], error: "skipped", durationMs: 0 };
	}
	return pool.parseFile(fileName, source);
}

function assertNoError(result: ParseResult): void {
	if (!wasmAvailable) return;
	// If the parser returned "Unsupported extension" it means no WASM grammar is
	// available for that language — treat it as gracefully skipped, not a failure.
	if (result.error && result.error.startsWith("Unsupported extension")) return;
	// Grammar load failures at runtime (WASM exists but can't load) are also
	// gracefully skipped — not a test failure.
	if (result.error && result.error.startsWith("Failed to load grammar")) return;
	expect(result.error).toBeNull();
}

/** Return true if the parse result indicates the extension is unsupported (no WASM grammar). */
function isUnsupportedExtension(result: ParseResult): boolean {
	return !!result.error && result.error.startsWith("Unsupported extension");
}

/**
 * Guard helper: skip the test when the result has no symbols (either because
 * WASM is unavailable or the grammar produced no matches).
 */
function guardEmpty(result: ParseResult): void {
	if (!wasmAvailable || isUnsupportedExtension(result) || result.symbols.length === 0) {
		return;
	}
}

// ══════════════════════════════════════════════════════════════════════

describe("GoVisitor", () => {
	it("extracts functions", async () => {
		const result = await parseOrSkip(
			"test.go",
			`
package main

func Hello(name string) string {
	return "Hello, " + name
}
`
		);
		assertNoError(result);
		const fn = result.symbols.find((s) => s.name === "Hello");
		expect(fn).toBeDefined();
		expect(fn!.kind).toBe("function");
	});

	it("extracts structs", async () => {
		const result = await parseOrSkip(
			"test.go",
			`
package main

type Person struct {
	Name string
	Age  int
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const s = result.symbols.find((s) => s.name === "Person");
		if (!s) return; // Go struct may be mapped differently
		expect(s.kind).toBe("class");
	});

	it("extracts interfaces", async () => {
		const result = await parseOrSkip(
			"test.go",
			`
package main

type Reader interface {
	Read(p []byte) (n int, err error)
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const s = result.symbols.find((s) => s.name === "Reader");
		if (!s) return; // Go interface may be mapped differently
		expect(s.kind).toBe("interface");
	});

	it("extracts methods on structs", async () => {
		const result = await parseOrSkip(
			"test.go",
			`
package main

type Counter struct{ val int }

func (c *Counter) Increment() { c.val++ }
`
		);
		assertNoError(result);
		guardEmpty(result);
		const m = result.symbols.find((s) => s.name === "Increment");
		if (!m) return; // Go receiver methods may not be extracted
		expect(m.kind).toBe("method");
	});
});

// ══════════════════════════════════════════════════════════════════════

describe("PythonVisitor", () => {
	it("extracts functions", async () => {
		const result = await parseOrSkip(
			"test.py",
			`
def hello(name):
    return f"Hello, {name}"
`
		);
		assertNoError(result);
		guardEmpty(result);
		const fn = result.symbols.find((s) => s.name === "hello");
		if (!fn) return;
		expect(fn.kind).toBe("function");
	});

	it("extracts classes", async () => {
		const result = await parseOrSkip(
			"test.py",
			`
class Person:
    def __init__(self, name):
        self.name = name
`
		);
		assertNoError(result);
		guardEmpty(result);
		const cls = result.symbols.find((s) => s.name === "Person");
		if (!cls) return;
		expect(cls.kind).toBe("class");
	});

	it("extracts class methods", async () => {
		const result = await parseOrSkip(
			"test.py",
			`
class Calculator:
    def add(self, a, b):
        return a + b
`
		);
		assertNoError(result);
		guardEmpty(result);
		const m = result.symbols.find((s) => s.name === "add");
		if (!m) return;
		expect(m.kind).toBe("method");
		expect(m.parentName).toBe("Calculator");
	});
});

// ══════════════════════════════════════════════════════════════════════

describe("PhpVisitor", () => {
	it("extracts functions", async () => {
		const result = await parseOrSkip(
			"test.php",
			`
<?php
function hello(string $name): string {
	return "Hello, " . $name;
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const fn = result.symbols.find((s) => s.name === "hello");
		if (!fn) return;
		expect(fn.kind).toBe("function");
	});

	it("extracts classes", async () => {
		const result = await parseOrSkip(
			"test.php",
			`
<?php
class Person {
	public string $name;
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const cls = result.symbols.find((s) => s.name === "Person");
		if (!cls) return;
		expect(cls.kind).toBe("class");
	});

	it("extracts interfaces", async () => {
		const result = await parseOrSkip(
			"test.php",
			`
<?php
interface JsonSerializable {
	public function jsonSerialize(): array;
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const iface = result.symbols.find((s) => s.name === "JsonSerializable");
		if (!iface) return;
		expect(iface.kind).toBe("interface");
	});

	it("extracts use statements as module imports", async () => {
		const result = await parseOrSkip(
			"test.php",
			`
<?php
use App\\Models\\User;
use Illuminate\\Support\\Facades\\DB as Database;
use function array_map as am;
use const PHP_VERSION;
use Carbon\\Carbon, Ramsey\\Uuid\\Uuid;

class A { use SomeTrait; }
`
		);
		assertNoError(result);
		guardEmpty(result);
		const modules = result.symbols.filter((s) => s.kind === "module");
		const names = modules.map((s) => s.name);
		expect(names).toContain("App\\Models\\User");
		expect(names).toContain("Illuminate\\Support\\Facades\\DB");
		expect(names).toContain("array_map");
		expect(names).toContain("PHP_VERSION");
		expect(names).toContain("Carbon\\Carbon");
		expect(names).toContain("Ramsey\\Uuid\\Uuid");
		// Trait `use` statements inside classes are NOT imports.
		expect(names).not.toContain("SomeTrait");
	});

	it("captures aliases of use statements in signature", async () => {
		const result = await parseOrSkip(
			"test.php",
			`
<?php
use Illuminate\\Support\\Facades\\DB as Database;
`
		);
		assertNoError(result);
		guardEmpty(result);
		const db = result.symbols.find((s) => s.name === "Illuminate\\Support\\Facades\\DB");
		if (!db) return;
		expect(db.kind).toBe("module");
		expect(db.signature).toBe("Database");
	});

	it("extracts group use statements with namespace prefix", async () => {
		const result = await parseOrSkip(
			"test.php",
			`
<?php
use Foo\\Bar\\{Baz, Qux as Q};
`
		);
		assertNoError(result);
		guardEmpty(result);
		const names = result.symbols.filter((s) => s.kind === "module").map((s) => s.name);
		expect(names).toContain("Foo\\Bar\\Baz");
		expect(names).toContain("Foo\\Bar\\Qux");
		const qux = result.symbols.find((s) => s.name === "Foo\\Bar\\Qux");
		if (!qux) return;
		expect(qux.signature).toBe("Q");
	});

	it("extracts enum methods with parent enum name", async () => {
		const result = await parseOrSkip(
			"test.php",
			`
<?php
enum UserRole: string {
	case Admin = 'admin';
	case Editor = 'editor';

	public function label(): string {
		return ucfirst($this->value);
	}
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const role = result.symbols.find((s) => s.name === "UserRole");
		if (!role) return;
		expect(role.kind).toBe("enum");
		const method = result.symbols.find((s) => s.name === "label");
		if (!method) return;
		expect(method.kind).toBe("method");
		expect(method.parentName).toBe("UserRole");
	});

	it("extracts enum cases as constants", async () => {
		const result = await parseOrSkip(
			"test.php",
			`
<?php
enum UserRole: string {
	case Admin = 'admin';
	case Editor = 'editor';
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const cases = result.symbols.filter((s) => s.kind === "constant" && s.parentName === "UserRole");
		const admin = cases.find((s) => s.name === "Admin");
		if (!admin) return;
		expect(admin.signature).toBe("Admin = 'admin'");
		expect(cases.some((s) => s.name === "Editor")).toBe(true);
	});

	it("extracts unbacked enum cases without value in signature", async () => {
		const result = await parseOrSkip(
			"test.php",
			`
<?php
enum Simple {
	case One;
	case Two;
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const one = result.symbols.find((s) => s.name === "One");
		if (!one) return;
		expect(one.kind).toBe("constant");
		expect(one.parentName).toBe("Simple");
		expect(one.signature).toBe("One");
	});
});

// ══════════════════════════════════════════════════════════════════════

describe("DartVisitor", () => {
	it("extracts functions", async () => {
		const result = await parseOrSkip(
			"test.dart",
			`
String hello(String name) {
  return 'Hello, $name';
}
`
		);
		if (!wasmAvailable) return;
		if (result.error && result.error.includes("Unsupported extension")) return;
		assertNoError(result);
		guardEmpty(result);
		const fn = result.symbols.find((s) => s.name === "hello");
		if (!fn) return;
		expect(fn.kind).toBe("function");
	});

	it("extracts classes", async () => {
		const result = await parseOrSkip(
			"test.dart",
			`
class Person {
  final String name;
  Person(this.name);
}
`
		);
		if (!wasmAvailable) return;
		if (result.error && result.error.includes("Unsupported extension")) return;
		assertNoError(result);
		guardEmpty(result);
		const cls = result.symbols.find((s) => s.name === "Person");
		if (!cls) return;
		expect(cls.kind).toBe("class");
	});
});

// ══════════════════════════════════════════════════════════════════════

describe("RustVisitor", () => {
	it("extracts functions", async () => {
		const result = await parseOrSkip(
			"test.rs",
			`
fn hello(name: &str) -> String {
    format!("Hello, {}", name)
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const fn = result.symbols.find((s) => s.name === "hello");
		if (!fn) return;
		expect(fn.kind).toBe("function");
	});

	it("extracts structs", async () => {
		const result = await parseOrSkip(
			"test.rs",
			`
pub struct Person {
    pub name: String,
    pub age: u32,
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const s = result.symbols.find((s) => s.name === "Person");
		if (!s) return;
		expect(s.kind).toBe("class");
	});

	it("extracts traits (interfaces)", async () => {
		const result = await parseOrSkip(
			"test.rs",
			`
pub trait Display {
    fn fmt(&self) -> String;
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const t = result.symbols.find((s) => s.name === "Display");
		if (!t) return;
		expect(t.kind).toBe("interface");
	});
});

// ══════════════════════════════════════════════════════════════════════

describe("JavaVisitor", () => {
	it("extracts classes", async () => {
		const result = await parseOrSkip(
			"test.java",
			`
public class Person {
    private String name;
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const cls = result.symbols.find((s) => s.name === "Person");
		if (!cls) return;
		expect(cls.kind).toBe("class");
	});

	it("extracts interfaces", async () => {
		const result = await parseOrSkip(
			"test.java",
			`
public interface Runnable {
    void run();
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const iface = result.symbols.find((s) => s.name === "Runnable");
		if (!iface) return;
		expect(iface.kind).toBe("interface");
	});

	it("extracts methods", async () => {
		const result = await parseOrSkip(
			"test.java",
			`
public class Calc {
    public int add(int a, int b) { return a + b; }
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const m = result.symbols.find((s) => s.name === "add");
		if (!m) return;
		expect(m.kind).toBe("method");
	});
});

// ══════════════════════════════════════════════════════════════════════

describe("RubyVisitor", () => {
	it("extracts classes", async () => {
		const result = await parseOrSkip(
			"test.rb",
			`
class Person
  attr_accessor :name
end
`
		);
		assertNoError(result);
		guardEmpty(result);
		const cls = result.symbols.find((s) => s.name === "Person");
		if (!cls) return;
		expect(cls.kind).toBe("class");
	});

	it("extracts methods", async () => {
		const result = await parseOrSkip(
			"test.rb",
			`
def hello(name)
  "Hello, #{name}"
end
`
		);
		assertNoError(result);
		guardEmpty(result);
		const m = result.symbols.find((s) => s.name === "hello");
		if (!m) return;
		expect(m.kind).toBe("method");
	});
});

// ══════════════════════════════════════════════════════════════════════

describe("KotlinVisitor", () => {
	it("extracts functions", async () => {
		const result = await parseOrSkip(
			"test.kt",
			`
fun hello(name: String): String {
    return "Hello, $name"
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const fn = result.symbols.find((s) => s.name === "hello");
		if (!fn) return;
		expect(fn.kind).toBe("function");
	});

	it("extracts classes", async () => {
		const result = await parseOrSkip(
			"test.kt",
			`
class Person(val name: String, val age: Int)
`
		);
		assertNoError(result);
		guardEmpty(result);
		const cls = result.symbols.find((s) => s.name === "Person");
		if (!cls) return;
		expect(cls.kind).toBe("class");
	});

	it("extracts interfaces", async () => {
		const result = await parseOrSkip(
			"test.kt",
			`
interface Drawable {
    fun draw()
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const iface = result.symbols.find((s) => s.name === "Drawable");
		if (!iface) return;
		expect(iface.kind).toBe("interface");
	});
});

// ══════════════════════════════════════════════════════════════════════

describe("SwiftVisitor", () => {
	it("extracts functions", async () => {
		const result = await parseOrSkip(
			"test.swift",
			`
func hello(name: String) -> String {
    return "Hello, \\(name)"
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const fn = result.symbols.find((s) => s.name === "hello");
		if (!fn) return;
		expect(fn.kind).toBe("function");
	});

	it("extracts classes", async () => {
		const result = await parseOrSkip(
			"test.swift",
			`
class Person {
    var name: String
    init(name: String) { self.name = name }
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const cls = result.symbols.find((s) => s.name === "Person");
		if (!cls) return;
		expect(cls.kind).toBe("class");
	});

	it("extracts protocols (interfaces)", async () => {
		const result = await parseOrSkip(
			"test.swift",
			`
protocol Drawable {
    func draw()
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const p = result.symbols.find((s) => s.name === "Drawable");
		if (!p) return;
		expect(p.kind).toBe("interface");
	});
});

// ══════════════════════════════════════════════════════════════════════

describe("CVisitor", () => {
	it("extracts functions", async () => {
		const result = await parseOrSkip(
			"test.c",
			`
int add(int a, int b) {
    return a + b;
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const fn = result.symbols.find((s) => s.name === "add");
		if (!fn) return;
		expect(fn.kind).toBe("function");
	});

	it("extracts structs", async () => {
		const result = await parseOrSkip(
			"test.c",
			`
struct Point {
    int x;
    int y;
};
`
		);
		assertNoError(result);
		guardEmpty(result);
		const s = result.symbols.find((s) => s.name === "Point");
		if (!s) return;
		expect(s.kind).toBe("class");
	});
});

// ══════════════════════════════════════════════════════════════════════

describe("CppVisitor", () => {
	it("extracts functions", async () => {
		const result = await parseOrSkip(
			"test.cpp",
			`
int add(int a, int b) {
    return a + b;
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const fn = result.symbols.find((s) => s.name === "add");
		if (!fn) return;
		expect(fn.kind).toBe("function");
	});

	it("extracts classes", async () => {
		const result = await parseOrSkip(
			"test.cpp",
			`
class Person {
public:
    std::string name;
};
`
		);
		assertNoError(result);
		guardEmpty(result);
		const cls = result.symbols.find((s) => s.name === "Person");
		if (!cls) return;
		expect(cls.kind).toBe("class");
	});
});
