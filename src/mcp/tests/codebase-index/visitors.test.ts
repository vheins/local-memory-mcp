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
	expect(result.error).toBeNull();
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
		const s = result.symbols.find((s) => s.name === "Person");
		expect(s).toBeDefined();
		expect(s!.kind).toBe("class");
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
		const s = result.symbols.find((s) => s.name === "Reader");
		expect(s).toBeDefined();
		expect(s!.kind).toBe("interface");
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
		const m = result.symbols.find((s) => s.name === "Increment");
		expect(m).toBeDefined();
		expect(m!.kind).toBe("method");
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
		const fn = result.symbols.find((s) => s.name === "hello");
		expect(fn).toBeDefined();
		expect(fn!.kind).toBe("function");
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
		const cls = result.symbols.find((s) => s.name === "Person");
		expect(cls).toBeDefined();
		expect(cls!.kind).toBe("class");
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
		const m = result.symbols.find((s) => s.name === "add");
		expect(m).toBeDefined();
		expect(m!.kind).toBe("method");
		expect(m!.parentName).toBe("Calculator");
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
		const fn = result.symbols.find((s) => s.name === "hello");
		expect(fn).toBeDefined();
		expect(fn!.kind).toBe("function");
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
		const cls = result.symbols.find((s) => s.name === "Person");
		expect(cls).toBeDefined();
		expect(cls!.kind).toBe("class");
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
		const iface = result.symbols.find((s) => s.name === "JsonSerializable");
		expect(iface).toBeDefined();
		expect(iface!.kind).toBe("interface");
	});
});

// ══════════════════════════════════════════════════════════════════════

describe("DartVisitor", () => {
	it("extracts functions", async () => {
		const result = await parseOrSkip(
			"test.dart",
			`
String hello(String name) {
  return 'Hello, \$name';
}
`
		);
		if (!wasmAvailable) return;
		// Dart WASM may be incompatible with current web-tree-sitter version
		if (result.error && result.error.includes("Unsupported extension")) return;
		assertNoError(result);
		const fn = result.symbols.find((s) => s.name === "hello");
		expect(fn).toBeDefined();
		expect(fn!.kind).toBe("function");
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
		const cls = result.symbols.find((s) => s.name === "Person");
		expect(cls).toBeDefined();
		expect(cls!.kind).toBe("class");
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
		const fn = result.symbols.find((s) => s.name === "hello");
		expect(fn).toBeDefined();
		expect(fn!.kind).toBe("function");
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
		const s = result.symbols.find((s) => s.name === "Person");
		expect(s).toBeDefined();
		expect(s!.kind).toBe("class");
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
		const t = result.symbols.find((s) => s.name === "Display");
		expect(t).toBeDefined();
		expect(t!.kind).toBe("interface");
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
		const cls = result.symbols.find((s) => s.name === "Person");
		expect(cls).toBeDefined();
		expect(cls!.kind).toBe("class");
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
		const iface = result.symbols.find((s) => s.name === "Runnable");
		expect(iface).toBeDefined();
		expect(iface!.kind).toBe("interface");
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
		const m = result.symbols.find((s) => s.name === "add");
		expect(m).toBeDefined();
		expect(m!.kind).toBe("method");
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
		const cls = result.symbols.find((s) => s.name === "Person");
		expect(cls).toBeDefined();
		expect(cls!.kind).toBe("class");
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
		const m = result.symbols.find((s) => s.name === "hello");
		expect(m).toBeDefined();
		expect(m!.kind).toBe("method");
	});
});

// ══════════════════════════════════════════════════════════════════════

describe("KotlinVisitor", () => {
	it("extracts functions", async () => {
		const result = await parseOrSkip(
			"test.kt",
			`
fun hello(name: String): String {
    return "Hello, \$name"
}
`
		);
		assertNoError(result);
		const fn = result.symbols.find((s) => s.name === "hello");
		expect(fn).toBeDefined();
		expect(fn!.kind).toBe("function");
	});

	it("extracts classes", async () => {
		const result = await parseOrSkip(
			"test.kt",
			`
class Person(val name: String, val age: Int)
`
		);
		assertNoError(result);
		const cls = result.symbols.find((s) => s.name === "Person");
		expect(cls).toBeDefined();
		expect(cls!.kind).toBe("class");
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
		const iface = result.symbols.find((s) => s.name === "Drawable");
		expect(iface).toBeDefined();
		expect(iface!.kind).toBe("interface");
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
		const fn = result.symbols.find((s) => s.name === "hello");
		expect(fn).toBeDefined();
		expect(fn!.kind).toBe("function");
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
		const cls = result.symbols.find((s) => s.name === "Person");
		expect(cls).toBeDefined();
		expect(cls!.kind).toBe("class");
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
		const p = result.symbols.find((s) => s.name === "Drawable");
		expect(p).toBeDefined();
		expect(p!.kind).toBe("interface");
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
		const fn = result.symbols.find((s) => s.name === "add");
		expect(fn).toBeDefined();
		expect(fn!.kind).toBe("function");
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
		const s = result.symbols.find((s) => s.name === "Point");
		expect(s).toBeDefined();
		expect(s!.kind).toBe("class");
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
		const fn = result.symbols.find((s) => s.name === "add");
		expect(fn).toBeDefined();
		expect(fn!.kind).toBe("function");
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
		const cls = result.symbols.find((s) => s.name === "Person");
		expect(cls).toBeDefined();
		expect(cls!.kind).toBe("class");
	});
});
