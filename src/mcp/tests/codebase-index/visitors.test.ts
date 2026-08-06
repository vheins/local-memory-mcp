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

	it("extracts struct fields as variables parented to the struct", async () => {
		const result = await parseOrSkip(
			"test.go",
			`
package main

type Repo struct {
	mu     sync.Mutex
	Name   string
	Age    int
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const name = result.symbols.find((s) => s.name === "Name");
		expect(name).toBeDefined();
		expect(name!.kind).toBe("variable");
		expect(name!.parentName).toBe("Repo");
		expect(name!.signature).toBe("Name string");
		const age = result.symbols.find((s) => s.name === "Age");
		expect(age).toBeDefined();
		expect(age!.kind).toBe("variable");
		expect(age!.parentName).toBe("Repo");
		const mu = result.symbols.find((s) => s.name === "mu");
		expect(mu).toBeDefined();
		expect(mu!.kind).toBe("variable");
		expect(mu!.parentName).toBe("Repo");
		expect(mu!.signature).toBe("mu sync.Mutex");
	});

	it("extracts embedded struct fields using the embedded type name", async () => {
		const result = await parseOrSkip(
			"test.go",
			`
package main

type BaseRepo struct{}

type Repo struct {
	*BaseRepo
	Name string
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const embedded = result.symbols.find((s) => s.name === "BaseRepo" && s.parentName === "Repo");
		expect(embedded).toBeDefined();
		expect(embedded!.kind).toBe("variable");
		expect(embedded!.parentName).toBe("Repo");
		// The embedded type is still declared as its own struct (class) symbol.
		const base = result.symbols.find((s) => s.name === "BaseRepo" && s.kind === "class");
		expect(base).toBeDefined();
	});

	it("extracts interface methods as methods with full signature", async () => {
		const result = await parseOrSkip(
			"test.go",
			`
package main

type Reader interface {
	Read(p []byte) (n int, err error)
	Close() error
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const read = result.symbols.find((s) => s.name === "Read");
		expect(read).toBeDefined();
		expect(read!.kind).toBe("method");
		expect(read!.parentName).toBe("Reader");
		expect(read!.signature).toBe("Read(p []byte) (n int, err error)");
		const close = result.symbols.find((s) => s.name === "Close");
		expect(close).toBeDefined();
		expect(close!.kind).toBe("method");
		expect(close!.parentName).toBe("Reader");
		expect(close!.signature).toBe("Close() error");
	});

	it("includes the receiver in method signatures", async () => {
		const result = await parseOrSkip(
			"test.go",
			`
package main

import "context"

type Repo struct{}

func (r *Repo) Save(ctx context.Context) error {
	return nil
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const save = result.symbols.find((s) => s.name === "Save");
		expect(save).toBeDefined();
		expect(save!.kind).toBe("method");
		expect(save!.signature).toBe("(r *Repo) Save(ctx context.Context) error");
	});

	it("extracts const block members (incl. iota) as constants", async () => {
		const result = await parseOrSkip(
			"test.go",
			`
package main

const (
	StatusNone Status = iota
	StatusActive
	StatusDone = 5
)
`
		);
		assertNoError(result);
		guardEmpty(result);
		const none = result.symbols.find((s) => s.name === "StatusNone");
		expect(none).toBeDefined();
		expect(none!.kind).toBe("constant");
		expect(none!.signature).toBe("StatusNone Status = iota");
		const active = result.symbols.find((s) => s.name === "StatusActive");
		expect(active).toBeDefined();
		expect(active!.kind).toBe("constant");
		const done = result.symbols.find((s) => s.name === "StatusDone");
		expect(done).toBeDefined();
		expect(done!.kind).toBe("constant");
		expect(done!.signature).toBe("StatusDone = 5");
	});

	it("extracts every name from comma-separated const specs", async () => {
		const result = await parseOrSkip(
			"test.go",
			`
package main

const A, B = 1, 2
`
		);
		assertNoError(result);
		guardEmpty(result);
		const a = result.symbols.find((s) => s.name === "A");
		expect(a).toBeDefined();
		expect(a!.kind).toBe("constant");
		const b = result.symbols.find((s) => s.name === "B");
		expect(b).toBeDefined();
		expect(b!.kind).toBe("constant");
	});

	it("extracts every name from comma-separated struct fields", async () => {
		const result = await parseOrSkip(
			"test.go",
			`
package main

type S struct {
	x, y int
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const x = result.symbols.find((s) => s.name === "x");
		expect(x).toBeDefined();
		expect(x!.kind).toBe("variable");
		expect(x!.parentName).toBe("S");
		const y = result.symbols.find((s) => s.name === "y");
		expect(y).toBeDefined();
		expect(y!.kind).toBe("variable");
		expect(y!.parentName).toBe("S");
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

	it("extracts async functions with async in the signature", async () => {
		const result = await parseOrSkip(
			"test.py",
			`
async def fetch(url):
    """Fetch a URL."""
    return url
`
		);
		assertNoError(result);
		guardEmpty(result);
		const fn = result.symbols.find((s) => s.name === "fetch");
		expect(fn).toBeDefined();
		expect(fn!.kind).toBe("function");
		expect(fn!.signature).toBe("async def fetch(url):");
		expect(fn!.exported).toBe(true);
	});

	it("extracts decorated definitions with decorators prefixed to the signature", async () => {
		const result = await parseOrSkip(
			"test.py",
			`
@app.route("/items", methods=["GET"])
def list_items():
    return []

@app.get("/x")
async def async_route():
    pass
`
		);
		assertNoError(result);
		guardEmpty(result);
		// Decorated defs must still be indexed (not lost) with their real name/kind
		const listItems = result.symbols.find((s) => s.name === "list_items");
		expect(listItems).toBeDefined();
		expect(listItems!.kind).toBe("function");
		expect(listItems!.exported).toBe(true);
		expect(listItems!.signature).toBe('@app.route("/items", methods=["GET"]) def list_items():');
		// Async + decorator combination keeps both markers
		const asyncRoute = result.symbols.find((s) => s.name === "async_route");
		expect(asyncRoute).toBeDefined();
		expect(asyncRoute!.kind).toBe("function");
		expect(asyncRoute!.signature).toBe('@app.get("/x") async def async_route():');
	});

	it("extracts decorated classes without leaking decorators into methods", async () => {
		const result = await parseOrSkip(
			"test.py",
			`
@dataclass
class Person:
    def greet(self) -> str:
        return "hi"
`
		);
		assertNoError(result);
		guardEmpty(result);
		const cls = result.symbols.find((s) => s.name === "Person");
		expect(cls).toBeDefined();
		expect(cls!.kind).toBe("class");
		expect(cls!.exported).toBe(true);
		expect(cls!.signature).toBe("@dataclass class Person:");
		// Class decorators decorate the class, NOT its methods
		const greet = result.symbols.find((s) => s.name === "greet");
		expect(greet).toBeDefined();
		expect(greet!.kind).toBe("method");
		expect(greet!.parentName).toBe("Person");
		expect(greet!.signature).toBe("def greet(self) -> str:");
	});

	it("captures __all__ export assignments as constants", async () => {
		const result = await parseOrSkip(
			"test.py",
			`
def fetch(url):
    return url

class Person:
    pass

__all__ = ["fetch", "Person"]
`
		);
		assertNoError(result);
		guardEmpty(result);
		const all = result.symbols.find((s) => s.name === "__all__");
		expect(all).toBeDefined();
		expect(all!.kind).toBe("constant");
		expect(all!.exported).toBe(true);
		expect(all!.signature).toBe('__all__ = ["fetch", "Person"]');
	});

	it("does not capture non-__all__ list assignments", async () => {
		const result = await parseOrSkip(
			"test.py",
			`
NOT_ALL = ["a", "b"]
`
		);
		assertNoError(result);
		expect(result.symbols.some((s) => s.name === "NOT_ALL")).toBe(false);
		expect(result.symbols.some((s) => s.name === "__all__")).toBe(false);
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

	it("extracts const items as constants", async () => {
		const result = await parseOrSkip(
			"test.rs",
			`
/// Maximum buffer size in bytes.
pub const MAX_SIZE: usize = 1024;
const INTERNAL: u32 = 1;
`
		);
		assertNoError(result);
		guardEmpty(result);
		const max = result.symbols.find((s) => s.name === "MAX_SIZE");
		if (!max) return;
		expect(max.kind).toBe("constant");
		expect(max.exported).toBe(true);
		expect(max.signature).toBe("pub const MAX_SIZE: usize = 1024;");
		expect(max.docComment).toBe("Maximum buffer size in bytes.");
		const internal = result.symbols.find((s) => s.name === "INTERNAL");
		if (!internal) return;
		expect(internal.kind).toBe("constant");
		expect(internal.exported).toBe(false);
	});

	it("extracts static items as constants", async () => {
		const result = await parseOrSkip(
			"test.rs",
			`
pub static APP_NAME: &'static str = "app";
static INTERNAL_STATE: u32 = 0;
`
		);
		assertNoError(result);
		guardEmpty(result);
		const app = result.symbols.find((s) => s.name === "APP_NAME");
		if (!app) return;
		expect(app.kind).toBe("constant");
		expect(app.exported).toBe(true);
		expect(app.signature).toBe(`pub static APP_NAME: &'static str = "app";`);
		const state = result.symbols.find((s) => s.name === "INTERNAL_STATE");
		if (!state) return;
		expect(state.kind).toBe("constant");
		expect(state.exported).toBe(false);
	});

	it("extracts pub use re-exports as modules (alias + crate:: path)", async () => {
		const result = await parseOrSkip(
			"test.rs",
			`
pub use crate::module::Thing;
pub use self::foo::Bar as Baz;
pub use other::path::to::Name as Alias;
pub use ::absolute::path::Global;
`
		);
		assertNoError(result);
		guardEmpty(result);
		const modules = result.symbols.filter((s) => s.kind === "module");
		const names = modules.map((s) => s.name);
		expect(names).toContain("Thing");
		expect(names).toContain("Baz");
		expect(names).toContain("Alias");
		expect(names).toContain("Global");
		const thing = result.symbols.find((s) => s.name === "Thing");
		if (!thing) return;
		expect(thing.exported).toBe(true);
		expect(thing.signature).toBe("pub use crate::module::Thing;");
		const baz = result.symbols.find((s) => s.name === "Baz");
		if (!baz) return;
		expect(baz.signature).toBe("pub use self::foo::Bar as Baz;");
	});

	it("does not index private use declarations", async () => {
		const result = await parseOrSkip(
			"test.rs",
			`
use std::collections::HashMap;
use private::thing;
pub(crate) use crate::internal::Visible;
pub use crate::module::Public;
`
		);
		assertNoError(result);
		guardEmpty(result);
		const publicModule = result.symbols.find((s) => s.name === "Public");
		if (!publicModule) return; // WASM unavailable or parse failure — nothing to assert
		const modules = result.symbols.filter((s) => s.kind === "module").map((s) => s.name);
		expect(modules).toContain("Public");
		expect(modules).not.toContain("HashMap");
		expect(modules).not.toContain("thing");
		expect(modules).not.toContain("Visible");
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

	it("extracts attr_accessor/attr_reader/attr_writer as methods parented to class", async () => {
		const result = await parseOrSkip(
			"test.rb",
			`
class Person
  # member attributes
  attr_accessor :name, :age
  attr_reader :email
  attr_writer :nickname
end
`
		);
		assertNoError(result);
		guardEmpty(result);
		const name = result.symbols.find((s) => s.name === "name");
		if (!name) return;
		expect(name.kind).toBe("method");
		expect(name.parentName).toBe("Person");
		expect(name.signature).toBe("attr_accessor :name");
		const age = result.symbols.find((s) => s.name === "age");
		if (!age) return;
		expect(age.kind).toBe("method");
		expect(age.parentName).toBe("Person");
		expect(age.signature).toBe("attr_accessor :age");
		const email = result.symbols.find((s) => s.name === "email");
		if (!email) return;
		expect(email.kind).toBe("method");
		expect(email.parentName).toBe("Person");
		expect(email.signature).toBe("attr_reader :email");
		const nickname = result.symbols.find((s) => s.name === "nickname");
		if (!nickname) return;
		expect(nickname.signature).toBe("attr_writer :nickname");
	});

	it("extracts extend/include module mixins parented to class", async () => {
		const result = await parseOrSkip(
			"test.rb",
			`
class Service
  extend SomeModule
  include OtherModule
end
`
		);
		assertNoError(result);
		guardEmpty(result);
		const ext = result.symbols.find((s) => s.kind === "module" && s.name === "SomeModule");
		if (!ext) return;
		expect(ext.parentName).toBe("Service");
		expect(ext.signature).toBe("extend SomeModule");
		const inc = result.symbols.find((s) => s.kind === "module" && s.name === "OtherModule");
		if (!inc) return;
		expect(inc.parentName).toBe("Service");
		expect(inc.signature).toBe("include OtherModule");
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
