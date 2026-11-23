import { describe, it, expect } from "vitest";
import {
	buildMergeHint,
	describeParamDiff,
	parameterName,
	splitParameterList
} from "../../codebase-index/services/duplicates-params.js";
import { normalizeSymbolBody } from "../../codebase-index/services/duplicates-normalize.js";

describe("duplicates normalization", () => {
	it("ignores comments, whitespace, identifier names and literal spelling", () => {
		const a = normalizeSymbolBody(
			["function f(a: string) {", "\t// explain", '\treturn a + "x";', "}"].join("\n"),
			"typescript"
		);
		const b = normalizeSymbolBody(
			["function g(b: string) {", "\t/* other */", "\treturn b + 'y';", "}"].join("\n"),
			"typescript"
		);
		expect(a.canonicalTokens).toEqual(b.canonicalTokens);
		expect(a.paramNames).toEqual(["a"]);
		expect(b.paramNames).toEqual(["b"]);
	});

	it("keeps keywords distinct (return vs throw is not a duplicate)", () => {
		const a = normalizeSymbolBody(["function f(a) {", "\treturn a;", "}"].join("\n"), "typescript");
		const b = normalizeSymbolBody(["function f(a) {", "\tthrow a;", "}"].join("\n"), "typescript");
		expect(a.canonicalTokens).not.toEqual(b.canonicalTokens);
	});

	it("blanks the parameter list from the comparison key but keeps the names", () => {
		const a = normalizeSymbolBody(["function f(a) {", "\treturn a;", "}"].join("\n"), "typescript");
		const b = normalizeSymbolBody(["function f(a, b) {", "\treturn a;", "}"].join("\n"), "typescript");
		expect(a.canonicalTokens).toEqual(b.canonicalTokens);
		expect(a.paramNames).toEqual(["a"]);
		expect(b.paramNames).toEqual(["a", "b"]);
	});

	it("does not treat // inside a string as a comment", () => {
		const body = normalizeSymbolBody(
			["function f() {", '\tconst url = "http://x";', "\treturn url;", "}"].join("\n"),
			"typescript"
		);
		expect(body.canonicalTokens).toContain("LIT");
		expect(body.canonicalTokens.join("")).not.toContain("http");
	});

	it("strips # comments for hash-comment languages and keeps them for TS", () => {
		const source = ["def f(a):", "\t# note", "\treturn a"].join("\n");
		const python = normalizeSymbolBody(source, "python");
		const ts = normalizeSymbolBody(source, "typescript");
		expect(python.canonicalTokens).not.toContain("#");
		expect(python.canonicalTokens).toEqual(["def", "ID", "(", "PARAMS", ")", ":", "return", "ID"]);
		// TS has no hash comments: `#` and the comment body stay as tokens.
		expect(ts.canonicalTokens).toContain("#");
		expect(ts.canonicalTokens.length).toBeGreaterThan(python.canonicalTokens.length);
	});

	it("splits parameter lists on top-level commas only", () => {
		expect(splitParameterList("a: Map<string, number>, b = { x: 1, y: 2 }, c: [1, 2]")).toEqual([
			"a: Map<string, number>",
			"b = { x: 1, y: 2 }",
			"c: [1, 2]"
		]);
	});

	it("reduces parameter declarations to names", () => {
		expect(parameterName("public readonly name?: string")).toBe("name");
		expect(parameterName("...rest: number[]")).toBe("rest");
		expect(parameterName("$value = 1")).toBe("$value");
		expect(parameterName("{ label, onClick }")).toBe("{label,onClick}");
	});

	it("describes a parameter diff and proposes optional params for a superset", () => {
		const diff = describeParamDiff([["items"], ["items", "extra"]]);
		expect(diff.common).toEqual(["items"]);
		expect(diff.unique).toEqual(["extra"]);
		expect(buildMergeHint("function", "exact", 1, diff)).toContain("optional params (extra optional)");
		expect(buildMergeHint("function", "exact", 1, diff)).toContain("same body");
	});

	it("canonicalizes the declaration's own name when it collides with a keyword", () => {
		const a = normalizeSymbolBody(["function double(a) {", "\treturn a + 1;", "}"].join("\n"), "typescript");
		const b = normalizeSymbolBody(["function doubleAll(a) {", "\treturn a + 1;", "}"].join("\n"), "typescript");
		expect(a.canonicalTokens).toEqual(b.canonicalTokens);
	});

	it("canonicalizes keyword-named arrow declarators", () => {
		const a = normalizeSymbolBody("type = (a) => a + 1;", "typescript");
		const b = normalizeSymbolBody("typeOf = (a) => a + 1;", "typescript");
		expect(a.canonicalTokens).toEqual(b.canonicalTokens);
	});

	it("still separates a body-level keyword change", () => {
		const a = normalizeSymbolBody(
			["function first(a) {", "\tif (a) {", "\t\treturn a;", "\t}", "}"].join("\n"),
			"typescript"
		);
		const b = normalizeSymbolBody(
			["function second(a) {", "\twhile (a) {", "\t\treturn a;", "\t}", "}"].join("\n"),
			"typescript"
		);
		expect(a.canonicalTokens).not.toEqual(b.canonicalTokens);
	});
});
