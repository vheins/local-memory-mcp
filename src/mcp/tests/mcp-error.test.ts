import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
	createMcpErrorResponse,
	formatZodError,
	parseArgs,
	ToolError,
	toErrorResponse
} from "../utils/mcp-error";

const ScopeSchema = z.object({
	owner: z.string().min(1, "owner is required — provide it explicitly or configure MCP workspace roots"),
	repo: z.string().min(1)
});
const SimpleSchema = z.object({ name: z.string().min(3) });

describe("mcp-error — canonical error envelope (OPT-CODE-01)", () => {
	it("creates a machine-readable error envelope", () => {
		const res = createMcpErrorResponse({
			code: "PATH_NOT_FOUND",
			message: "Repository path not found",
			retryable: false,
			details: { field: "repoPath" }
		});

		expect(res.isError).toBe(true);
		expect(res.content).toEqual([{ type: "text", text: "Repository path not found" }]);
		expect(res.structuredContent).toEqual({
			field: "repoPath",
			schema: "tool-error",
			code: "PATH_NOT_FOUND",
			message: "Repository path not found",
			retryable: false,
			error: "Repository path not found",
			details: { field: "repoPath" }
		});
	});

	it("preserves typed expected failures", () => {
		const res = toErrorResponse(
			new ToolError("TASK_NOT_FOUND", "Task not found: abc", { retryable: false, details: { task: "abc" } })
		);
		expect(res.isError).toBe(true);
		expect(res.content?.[0]).toEqual({ type: "text", text: "Task not found: abc" });
		expect(res.structuredContent).toMatchObject({
			schema: "tool-error",
			code: "TASK_NOT_FOUND",
			retryable: false,
			details: { task: "abc" }
		});
	});

	it("sanitizes unknown Error messages", () => {
		const res = toErrorResponse(new Error("SQLITE failure at /private/secret.db"));
		expect(res.isError).toBe(true);
		expect(res.content?.[0]).toEqual({ type: "text", text: "Internal tool error" });
		expect(res.structuredContent).toEqual({
			schema: "tool-error",
			code: "INTERNAL_ERROR",
			message: "Internal tool error",
			retryable: false,
			error: "Internal tool error"
		});
		expect(JSON.stringify(res)).not.toContain("secret.db");
	});

	it("sanitizes non-Error values", () => {
		const res = toErrorResponse("boom /private/path");
		expect(res.isError).toBe(true);
		expect(res.structuredContent).toMatchObject({ code: "INTERNAL_ERROR" });
		expect(JSON.stringify(res)).not.toContain("private/path");
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

	it("toErrorResponse wraps a ZodError with the validation code", () => {
		const result = ScopeSchema.safeParse({});
		if (!result.success) {
			const res = toErrorResponse(result.error);
			expect(res.isError).toBe(true);
			expect(res.content?.[0]).toMatchObject({
				type: "text",
				text: expect.stringContaining("Missing required fields") as unknown
			});
			expect(res.structuredContent).toMatchObject({
				schema: "tool-error",
				code: "VALIDATION_ERROR",
				retryable: false
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
