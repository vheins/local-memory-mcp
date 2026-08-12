import { describe, it, expect } from "vitest";
import { parseOrSkip, assertNoError, guardEmpty } from "./visitors.shared.js";

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

