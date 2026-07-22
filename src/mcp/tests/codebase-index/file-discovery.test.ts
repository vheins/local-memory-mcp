/**
 * FileDiscoveryService tests — validates file walking, gitignore filtering,
 * glob patterns, symlink handling, and result sorting.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { discoverFiles } from "../../codebase-index/services/file-discovery";

// ── Helpers ────────────────────────────────────────────────────────────

function touch(filePath: string, content = "// test"): void {
	const dir = path.dirname(filePath);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(filePath, content, "utf-8");
}

function relativePaths(result: Awaited<ReturnType<typeof discoverFiles>>): string[] {
	return result.files.map((f) => f.path);
}

// ── Test suite ─────────────────────────────────────────────────────────

describe("FileDiscoveryService", () => {
	let tempDir: string;

	beforeAll(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cbi-test-"));
	});

	afterAll(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	// ──────────────────────────────────────────────────────────────────
	it("discovers .ts files in a directory", async () => {
		const root = path.join(tempDir, "discover-ts");
		touch(path.join(root, "a.ts"));
		touch(path.join(root, "b.ts"));
		touch(path.join(root, "c.ts"));

		const result = await discoverFiles({ projectPath: root });

		expect(result.files).toHaveLength(3);
		expect(result.supportedFiles).toBe(3);
		expect(result.totalFiles).toBe(3);
		for (const f of result.files) {
			expect(f.language).toBe("typescript");
			expect(f.absolutePath).toBe(path.resolve(root, f.path));
		}
	});

	// ──────────────────────────────────────────────────────────────────
	it("respects .gitignore rules", async () => {
		const root = path.join(tempDir, "gitignore-test");
		fs.mkdirSync(root, { recursive: true });
		fs.writeFileSync(path.join(root, ".gitignore"), "*.log\n", "utf-8");
		touch(path.join(root, "keep.ts"));
		touch(path.join(root, "ignore.log"));

		const result = await discoverFiles({ projectPath: root });

		const names = relativePaths(result);
		expect(names).toContain("keep.ts");
		expect(names).not.toContain("ignore.log");
		expect(result.supportedFiles).toBe(1);
	});

	// ──────────────────────────────────────────────────────────────────
	it("accepts custom include glob (only .tsx)", async () => {
		const root = path.join(tempDir, "include-tsx");
		touch(path.join(root, "page.tsx"));
		touch(path.join(root, "util.ts"));
		touch(path.join(root, "data.json"));

		const result = await discoverFiles({
			projectPath: root,
			includeGlobs: ["**/*.tsx"]
		});

		const names = relativePaths(result);
		expect(names).toEqual(["page.tsx"]);
	});

	// ──────────────────────────────────────────────────────────────────
	it("accepts custom exclude glob (skips generated dir)", async () => {
		const root = path.join(tempDir, "exclude-gen");
		touch(path.join(root, "generated", "auto.ts"));
		touch(path.join(root, "src", "manual.ts"));

		const result = await discoverFiles({
			projectPath: root,
			excludeGlobs: ["**/generated/**"]
		});

		const names = relativePaths(result);
		expect(names).toEqual(["src/manual.ts"]);
		expect(names).not.toContain("generated/auto.ts");
	});

	// ──────────────────────────────────────────────────────────────────
	it("skips node_modules by default", async () => {
		const root = path.join(tempDir, "node-modules-test");
		touch(path.join(root, "node_modules", "foo.ts"));
		touch(path.join(root, "src", "bar.ts"));

		const result = await discoverFiles({ projectPath: root });

		const names = relativePaths(result);
		expect(names).toEqual(["src/bar.ts"]);
		expect(names).not.toContain("node_modules/foo.ts");
	});

	// ──────────────────────────────────────────────────────────────────
	it("returns empty array for empty directory", async () => {
		const root = path.join(tempDir, "empty-dir");
		fs.mkdirSync(root, { recursive: true });

		const result = await discoverFiles({ projectPath: root });

		expect(result.files).toEqual([]);
		expect(result.totalFiles).toBe(0);
		expect(result.supportedFiles).toBe(0);
		expect(result.skippedFiles).toBe(0);
		expect(result.errors).toEqual([]);
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
	});

	// ──────────────────────────────────────────────────────────────────
	it("returns results sorted alphabetically by relative path", async () => {
		const root = path.join(tempDir, "sorted-test");
		// Create files in non-alphabetical order
		touch(path.join(root, "zebra.ts"));
		touch(path.join(root, "alpha.ts"));
		touch(path.join(root, "mango.ts"));
		touch(path.join(root, "nested", "deep.ts"));
		touch(path.join(root, "nested", "apple.ts"));

		const result = await discoverFiles({ projectPath: root });

		const paths = relativePaths(result);
		expect(paths).toEqual(["alpha.ts", "mango.ts", "nested/apple.ts", "nested/deep.ts", "zebra.ts"]);
	});

	// ──────────────────────────────────────────────────────────────────
	it("skips symlinks and does not duplicate", async () => {
		const root = path.join(tempDir, "symlink-test");
		const realFile = path.join(root, "real.ts");
		const symlinkPath = path.join(root, "link.ts");

		touch(realFile);
		fs.symlinkSync(realFile, symlinkPath);

		const result = await discoverFiles({ projectPath: root });

		const names = relativePaths(result);
		expect(names).toEqual(["real.ts"]);
		// symlink should be skipped, not appear as a duplicate
		expect(names).not.toContain("link.ts");
		expect(result.supportedFiles).toBe(1);
		expect(result.skippedFiles).toBe(1); // the symlink was counted and skipped
	});

	// ──────────────────────────────────────────────────────────────────
	it("skips files with unsupported extensions", async () => {
		const root = path.join(tempDir, "unsupported-ext");
		touch(path.join(root, "valid.ts"));
		touch(path.join(root, "image.png"));
		touch(path.join(root, "archive.zip"));

		const result = await discoverFiles({ projectPath: root });

		const names = relativePaths(result);
		expect(names).toEqual(["valid.ts"]);
	});

	// ──────────────────────────────────────────────────────────────────
	it("sets durationMs to a positive number", async () => {
		const root = path.join(tempDir, "duration-test");
		touch(path.join(root, "f.ts"));

		const result = await discoverFiles({ projectPath: root });

		expect(result.durationMs).toBeGreaterThanOrEqual(0);
		expect(Number.isInteger(result.durationMs)).toBe(true);
	});

	// ──────────────────────────────────────────────────────────────────
	it("maps correct language identifiers for known extensions", async () => {
		const root = path.join(tempDir, "lang-test");
		touch(path.join(root, "file.ts"), "// ts");
		touch(path.join(root, "file.tsx"), "// tsx");
		touch(path.join(root, "file.js"), "// js");
		touch(path.join(root, "file.json"), "{}");
		touch(path.join(root, "file.md"), "# md");
		touch(path.join(root, "file.py"), "# py");
		touch(path.join(root, "file.go"), "// go");
		touch(path.join(root, "file.css"), "/* css */");

		const result = await discoverFiles({ projectPath: root });

		const langMap: Record<string, string> = {};
		for (const f of result.files) {
			langMap[f.path] = f.language;
		}
		expect(langMap["file.ts"]).toBe("typescript");
		expect(langMap["file.tsx"]).toBe("typescriptreact");
		expect(langMap["file.js"]).toBe("javascript");
		expect(langMap["file.json"]).toBe("json");
		expect(langMap["file.md"]).toBe("markdown");
		expect(langMap["file.py"]).toBe("python");
		expect(langMap["file.go"]).toBe("go");
		expect(langMap["file.css"]).toBe("css");
	});

	// ──────────────────────────────────────────────────────────────────
	it("records file size in bytes", async () => {
		const root = path.join(tempDir, "size-test");
		touch(path.join(root, "small.ts"), "abc"); // 3 bytes
		touch(path.join(root, "big.ts"), "x".repeat(100)); // 100 bytes

		const result = await discoverFiles({ projectPath: root });

		const filesByName: Record<string, number> = {};
		for (const f of result.files) {
			filesByName[f.path] = f.sizeBytes;
		}
		expect(filesByName["small.ts"]).toBe(3);
		expect(filesByName["big.ts"]).toBe(100);
	});
});
