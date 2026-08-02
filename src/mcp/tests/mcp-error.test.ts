import { describe, expect, it } from "vitest";
import { z } from "zod";
import { formatZodError, parseArgs, toErrorResponse } from "../utils/mcp-error";

const ScopeSchema = z.object({
	owner: z.string().min(1, "owner is required — provide it explicitly or configure MCP workspace roots"),
	repo: z.string().min(1)
});
const SimpleSchema = z.object({ name: z.string().min(3) });

describe("mcp-error — canonical error envelope (OPT-CODE-01)", () => {
	it("produces the Error: <message> envelope for a plain Error", () => {
		const res = toErrorResponse(new Error("Task not found: abc"));
		expect(res.isError).toBe(true);
		expect(res.content?.[0]).toEqual({ type: "text", text: "Error: Task not found: abc" });
	});

	it("produces an isError envelope for a non-Error value", () => {
		const res = toErrorResponse("boom");
		expect(res.isError).toBe(true);
		expect(res.content?.[0]).toMatchObject({ type: "text", text: "Error: boom" });
	});

	it("formats Zod failures with the friendly Missing required fields text for owner/repo", () => {
		const result = ScopeSchema.safeParse({});
		expect(result.success).toBe(false);
		if (!result.success) {
			const text = formatZodError(result.error);
			expect(text).toContain("Missing required fields");
			expect(text).toContain("Pass owner/repo explicitly or configure MCP workspace roots");
		}
	});

	it("falls back to generic Validation error text for non-owner/repo issues", () => {
		const result = SimpleSchema.safeParse({ name: "" });
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(formatZodError(result.error)).toContain("Validation error");
		}
	});

	it("toErrorResponse wraps a ZodError with the friendly message", () => {
		const result = ScopeSchema.safeParse({});
		if (!result.success) {
			const res = toErrorResponse(result.error);
			expect(res.isError).toBe(true);
			expect(res.content?.[0]).toMatchObject({
				type: "text",
				text: expect.stringContaining("Missing required fields") as unknown
			});
		}
	});

	it("parseArgs returns typed data on success", () => {
		const data = parseArgs(SimpleSchema, { name: "okay" });
		expect(data.name).toBe("okay");
	});

	it("parseArgs throws on failure (transport catch turns it into an envelope)", () => {
		expect(() => parseArgs(SimpleSchema, { name: "" })).toThrowError(/Validation error/);
	});
});
