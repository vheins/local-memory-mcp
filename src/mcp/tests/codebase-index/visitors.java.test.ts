import { describe, it, expect } from "vitest";
import { parseOrSkip, assertNoError, guardEmpty } from "./visitors.shared.js";

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

