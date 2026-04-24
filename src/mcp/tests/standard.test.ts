import { describe, it, expect, beforeEach } from "vitest";
import { SQLiteStore } from "../storage/sqlite";
import { handleStandardStore } from "../tools/standard.store";
import { handleStandardSearch } from "../tools/standard.search";
import { McpResponse } from "../utils/mcp-response";

describe("CSL (Coding Standards Library)", () => {
	let db: SQLiteStore;

	beforeEach(() => {
		db = new SQLiteStore(":memory:");
	});

	describe("standard-store", () => {
		it("should persist a coding standard to the library", async () => {
			const result = (await handleStandardStore(
				{
					name: "Error Handling Best Practices",
					content:
						"Always use try-catch blocks for async operations. Handle errors gracefully and log them.",
					language: "typescript",
					stack: ["node", "express"],
					version: "1.0.0",
					context: "error-handling",
					agent: "test-agent",
					model: "gpt-4"
				},
				db
			)) as McpResponse;

			expect(result.isError).toBe(false);
			const data = result.structuredContent as any;
			expect(data.success).toBe(true);
			expect(data.standard).toBeDefined();
			expect(data.standard.title).toBe("Error Handling Best Practices");
			expect(data.standard.language).toBe("typescript");
			expect(data.standard.stack).toContain("node");
			expect(data.standard.stack).toContain("express");
		});

		it("should validate required fields", async () => {
			try {
				await handleStandardStore(
					{
						name: "Test", // Too short
						content: "Short" // Too short
					},
					db
				);
				expect.fail("Should have thrown validation error");
			} catch (err: any) {
				expect(err.message).toBeDefined();
			}
		});

		it("should store standards with global scope by default", async () => {
			const result = (await handleStandardStore(
				{
					name: "React Hooks Standard",
					content:
						"Use hooks for state management. Never call hooks conditionally.",
					language: "typescript",
					stack: ["react"]
				},
				db
			)) as McpResponse;

			const data = result.structuredContent as any;
			expect(data.standard.is_global).toBe(true);
		});
	});

	describe("standard-search", () => {
		beforeEach(async () => {
			// Store some test standards
			await handleStandardStore(
				{
					name: "React State Management",
					content: "Use Redux or Context API for state",
					language: "typescript",
					stack: ["react"]
				},
				db
			);

			await handleStandardStore(
				{
					name: "Node Error Handling",
					content: "Use try-catch with proper logging",
					language: "typescript",
					stack: ["node", "express"]
				},
				db
			);

			await handleStandardStore(
				{
					name: "Python Testing",
					content: "Use pytest for all test cases",
					language: "python",
					stack: ["pytest"]
				},
				db
			);
		});

		it("should return relevant results for specific stacks", async () => {
			const result = (await handleStandardSearch(
				{
					stack: ["react"]
				},
				db
			)) as McpResponse;

			expect(result.isError).toBe(false);
			const data = result.structuredContent as any;
			expect(data.success).toBe(true);
			expect(data.standards).toBeDefined();
			expect(data.count).toBeGreaterThan(0);
			const reactStandard = data.standards.find((s: any) => s.title.includes("React"));
			expect(reactStandard).toBeDefined();
		});

		it("should return relevant results for specific languages", async () => {
			const result = (await handleStandardSearch(
				{
					language: "python"
				},
				db
			)) as McpResponse;

			expect(result.isError).toBe(false);
			const data = result.structuredContent as any;
			expect(data.success).toBe(true);
			expect(data.standards).toBeDefined();
			const pythonStandard = data.standards.find((s: any) => s.language === "python");
			expect(pythonStandard).toBeDefined();
		});

		it("should return empty array for invalid stack (not error)", async () => {
			const result = (await handleStandardSearch(
				{
					stack: ["nonexistent-stack-12345"]
				},
				db
			)) as McpResponse;

			expect(result.isError).toBe(false);
			const data = result.structuredContent as any;
			expect(data.success).toBe(true);
			expect(data.standards).toEqual([]);
			expect(data.count).toBe(0);
			expect(data.message).toBe("No matching coding standards found.");
		});

		it("should return empty array for invalid language (not error)", async () => {
			const result = (await handleStandardSearch(
				{
					language: "nonexistent-language-xyz"
				},
				db
			)) as McpResponse;

			expect(result.isError).toBe(false);
			const data = result.structuredContent as any;
			expect(data.success).toBe(true);
			expect(data.standards).toEqual([]);
			expect(data.count).toBe(0);
		});

		it("should support text search by query", async () => {
			const result = (await handleStandardSearch(
				{
					query: "error"
				},
				db
			)) as McpResponse;

			expect(result.isError).toBe(false);
			const data = result.structuredContent as any;
			expect(data.success).toBe(true);
			expect(data.standards).toBeDefined();
			expect(data.count).toBeGreaterThan(0);
		});

		it("should filter by multiple criteria", async () => {
			const result = (await handleStandardSearch(
				{
					language: "typescript",
					stack: ["react"]
				},
				db
			)) as McpResponse;

			expect(result.isError).toBe(false);
			const data = result.structuredContent as any;
			expect(data.success).toBe(true);
			expect(data.standards).toBeDefined();
			const reactStandard = data.standards.find((s: any) => s.title.includes("React"));
			expect(reactStandard).toBeDefined();
			expect(reactStandard.language).toBe("typescript");
		});
	});
});
