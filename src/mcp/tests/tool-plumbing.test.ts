/**
 * Unit tests for src/mcp/utils/tool-plumbing.ts — the single write-lock set /
 * resource-invalidation source shared by BOTH transports (router.ts thin
 * adapter + tools/index.ts native SDK registration).
 *
 * Coverage targets (TASK-104): WRITE_TOOLS membership, collectAffectedResourceUris
 * URI derivation for memory/task/standard writes, and normalizePageLimit.
 *
 * Pure-logic suite: no store/vector dependencies, no DB.
 */

import { describe, expect, it } from "vitest";
import { WRITE_TOOLS, collectAffectedResourceUris, normalizePageLimit } from "../utils/tool-plumbing";

const UUID = "123e4567-e89b-42d3-a456-426614174000";
const NON_UUID = "MEM-101";

describe("WRITE_TOOLS — write-lock membership", () => {
	it("includes every canonical write tool (memory/task/standard/handoff/claim/summarize)", () => {
		expect(WRITE_TOOLS).toEqual(
			new Set([
				"memory-write",
				"memory-delete",
				"repo-summarize",
				"handoff-write",
				"claim-manage",
				"standard-write",
				"standard-delete",
				"task-write",
				"task-delete"
			])
		);
	});

	it("excludes read-only tools", () => {
		for (const readTool of [
			"memory-read",
			"memory-search",
			"handoff-read",
			"handoff-list",
			"standard-read",
			"standard-search",
			"task-read",
			"task-list",
			"codebase-read"
		]) {
			expect(WRITE_TOOLS.has(readTool)).toBe(false);
		}
	});

	it("excludes 'codebase-index' — heavy CPU run must not hold the file lock (TASK-007)", () => {
		expect(WRITE_TOOLS.has("codebase-index")).toBe(false);
	});
});

describe("collectAffectedResourceUris — URI derivation", () => {
	it("returns [] for a tool call with no repo", () => {
		expect(collectAffectedResourceUris("memory-write", {}, undefined)).toEqual([]);
	});

	it("memory-write with repo arg derives memories collection + index", () => {
		const uris = collectAffectedResourceUris("memory-write", { repo: "acme/repo" }, {});
		expect(uris).toContain("repository://acme%2Frepo/memories");
		expect(uris).toContain("repository://index");
		expect(uris).not.toContain("repository://acme%2Frepo/tasks");
	});

	it("derives repo from args.scope.repo when args.repo is absent", () => {
		const uris = collectAffectedResourceUris("memory-write", { scope: { owner: "x", repo: "scoped-repo" } }, {});
		expect(uris).toContain("repository://scoped-repo/memories");
	});

	it("derives repo from result.data.repo as last-resort fallback", () => {
		const uris = collectAffectedResourceUris("memory-write", {}, { data: { repo: "result-repo" } });
		expect(uris).toContain("repository://result-repo/memories");
	});

	it("task-write derives BOTH tasks and memories collections (task writes can touch memory rows)", () => {
		const uris = collectAffectedResourceUris("task-write", { repo: "r" }, {});
		expect(uris).toContain("repository://r/tasks");
		expect(uris).toContain("repository://r/memories");
	});

	it("task-delete derives tasks collection", () => {
		const uris = collectAffectedResourceUris("task-delete", { repo: "r" }, {});
		expect(uris).toContain("repository://r/tasks");
		expect(uris).toContain("repository://index");
	});

	it("a read-only tool with a repo only derives the index resource", () => {
		const uris = collectAffectedResourceUris("handoff-read", { repo: "r" }, {});
		expect(uris).toEqual(["repository://index"]);
	});

	it("adds memory://{id} for memory-write with args.id (UUID)", () => {
		const uris = collectAffectedResourceUris("memory-write", { id: UUID, repo: "r" }, {});
		expect(uris).toContain(`memory://${UUID}`);
	});

	it("adds memory://{id} for memory-delete with args.memory_id (UUID)", () => {
		const uris = collectAffectedResourceUris("memory-delete", { memory_id: UUID, repo: "r" }, {});
		expect(uris).toContain(`memory://${UUID}`);
	});

	it("adds memory://{id} from result.data.id", () => {
		const uris = collectAffectedResourceUris("memory-write", {}, { data: { id: UUID } });
		expect(uris).toContain(`memory://${UUID}`);
	});

	it("adds task://{id} for task-write with args.id (UUID)", () => {
		const uris = collectAffectedResourceUris("task-write", { id: UUID, repo: "r" }, {});
		expect(uris).toContain(`task://${UUID}`);
	});

	it("adds task://{id} for task-write with args.task_id (UUID)", () => {
		const uris = collectAffectedResourceUris("task-write", { task_id: UUID, repo: "r" }, {});
		expect(uris).toContain(`task://${UUID}`);
	});

	it("adds task://{id} from result.structuredData.id", () => {
		const uris = collectAffectedResourceUris("task-write", {}, { structuredData: { id: UUID } });
		expect(uris).toContain(`task://${UUID}`);
	});

	it("does NOT add memory:// or task:// for non-UUID ids (codes are not resource URIs)", () => {
		const uris = collectAffectedResourceUris("memory-write", { id: NON_UUID, repo: "r" }, {});
		expect(uris).not.toContain(`memory://${NON_UUID}`);
		expect(uris).toContain("repository://r/memories");
	});

	it("deduplicates URIs when the same id is provided via multiple args", () => {
		const uris = collectAffectedResourceUris(
			"task-write",
			{ id: UUID, task_id: UUID, repo: "r" },
			{ structuredData: { id: UUID } }
		);
		expect(uris.filter((u) => u === `task://${UUID}`)).toHaveLength(1);
	});

	it("URI-encodes repo names", () => {
		const uris = collectAffectedResourceUris("memory-write", { repo: "my org/repo name" }, {});
		expect(uris).toContain("repository://my%20org%2Frepo%20name/memories");
	});
});

describe("normalizePageLimit", () => {
	it("passes through valid integers within [1, 100]", () => {
		expect(normalizePageLimit(1, 10)).toBe(1);
		expect(normalizePageLimit(50, 10)).toBe(50);
		expect(normalizePageLimit(100, 10)).toBe(100);
	});

	it("clamps values above 100 to 100", () => {
		expect(normalizePageLimit(150, 10)).toBe(100);
		expect(normalizePageLimit(10_000, 10)).toBe(100);
	});

	it("falls back for missing/nullish values", () => {
		expect(normalizePageLimit(undefined, 20)).toBe(20);
		expect(normalizePageLimit(null, 20)).toBe(20);
	});

	it("falls back for non-numeric and non-integer values", () => {
		expect(normalizePageLimit("10", 20)).toBe(20);
		expect(normalizePageLimit(3.7, 20)).toBe(20);
		expect(normalizePageLimit(NaN, 20)).toBe(20);
	});

	it("falls back for values <= 0", () => {
		expect(normalizePageLimit(0, 20)).toBe(20);
		expect(normalizePageLimit(-5, 20)).toBe(20);
	});

	it("clamps the fallback to a minimum of 1", () => {
		expect(normalizePageLimit(undefined, 0)).toBe(1);
		expect(normalizePageLimit(undefined, -10)).toBe(1);
	});
});
