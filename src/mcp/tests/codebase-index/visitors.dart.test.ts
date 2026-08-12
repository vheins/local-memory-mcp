import { describe, it, expect } from "vitest";
import { wasmAvailable, parseOrSkip, assertNoError, guardEmpty } from "./visitors.shared.js";

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

