import { describe, it, expect, vi } from "vitest";
import { inferReadMode, collectEntityIds, type ReadModeSpec } from "../../utils/auto-infer";
import type { SQLiteStore } from "../../storage/sqlite";

function makeStorage() {
	const memoryGetByCode = vi.fn();
	const standardGetByCode = vi.fn();
	const taskGetByCode = vi.fn();
	const storage = {
		memories: { getByCode: memoryGetByCode },
		standards: { getByCode: standardGetByCode },
		tasks: { getTaskByCode: taskGetByCode }
	} as unknown as SQLiteStore;
	return { storage, memoryGetByCode, standardGetByCode, taskGetByCode };
}

const readSpec: ReadModeSpec<"search" | "detail" | "recap"> = {
	rules: [
		{ mode: "search", fields: ["query"] },
		{ mode: "detail", fields: ["id", "code", "ids", "codes"] }
	],
	fallback: "recap"
};

describe("inferReadMode", () => {
	it("selects the first matching rule (search beats detail)", () => {
		expect(inferReadMode({ query: "q", id: "1" }, readSpec)).toBe("search");
	});

	it("selects detail when an identifier field is present", () => {
		expect(inferReadMode({ id: "1" }, readSpec)).toBe("detail");
		expect(inferReadMode({ ids: ["1"] }, readSpec)).toBe("detail");
		expect(inferReadMode({ codes: ["C-1"] }, readSpec)).toBe("detail");
	});

	it("treats an explicit empty query as present ('defined' semantics)", () => {
		expect(inferReadMode({ query: "" }, readSpec)).toBe("search");
	});

	it("returns the fallback when no rule matches", () => {
		expect(inferReadMode({}, readSpec)).toBe("recap");
		expect(inferReadMode({ unrelated: 1 }, readSpec)).toBe("recap");
	});

	it("honors 'truthy' presence for boolean flags", () => {
		const flagSpec: ReadModeSpec<"detail" | "list"> = {
			rules: [{ mode: "detail", fields: ["claim"], presence: "truthy" }],
			fallback: "list"
		};
		expect(inferReadMode({ claim: false }, flagSpec)).toBe("list");
		expect(inferReadMode({ claim: true }, flagSpec)).toBe("detail");
	});
});

describe("collectEntityIds", () => {
	it("resolves singular and bulk identifiers in canonical order", () => {
		const { storage, memoryGetByCode } = makeStorage();
		memoryGetByCode.mockImplementation((code: string) => ({ id: `id-${code}` }));
		const ids = collectEntityIds({ ids: ["MEM-2"], id: "MEM-1", codes: ["MEM-4"], code: "MEM-3" }, "memory", storage, {
			owner: "o",
			repo: "r"
		});
		expect(ids).toEqual(["id-MEM-1", "id-MEM-3", "id-MEM-2", "id-MEM-4"]);
	});

	it("resolves task_code and task_codes through the task store", () => {
		const { storage, taskGetByCode } = makeStorage();
		taskGetByCode.mockImplementation((_o: string, _r: string, code: string) => ({ id: `task-${code}` }));
		const ids = collectEntityIds({ task_code: "TASK-1", task_codes: ["TASK-2"] }, "task", storage);
		expect(ids).toEqual(["task-TASK-1", "task-TASK-2"]);
		expect(taskGetByCode).toHaveBeenNthCalledWith(1, "", "", "TASK-1");
	});

	it("consults the localMap before the database", () => {
		const { storage, memoryGetByCode } = makeStorage();
		const localMap = new Map<string, string>([["MEM-BATCH", "batch-uuid"]]);
		const ids = collectEntityIds({ code: "MEM-BATCH" }, "memory", storage, { localMap });
		expect(ids).toEqual(["batch-uuid"]);
		expect(memoryGetByCode).not.toHaveBeenCalled();
	});

	it("ignores empty strings and non-string array items", () => {
		const { storage, memoryGetByCode } = makeStorage();
		memoryGetByCode.mockImplementation((code: string) => ({ id: `id-${code}` }));
		const ids = collectEntityIds(
			{ code: "", ids: [""], codes: ["MEM-1", "", 42, null] as unknown as string[] },
			"memory",
			storage
		);
		expect(ids).toEqual(["id-MEM-1"]);
	});

	it("returns an empty array when no identifiers are present", () => {
		const { storage, memoryGetByCode } = makeStorage();
		expect(collectEntityIds({ query: "q" }, "memory", storage)).toEqual([]);
		expect(memoryGetByCode).not.toHaveBeenCalled();
	});

	it("throws when a non-empty identifier cannot be resolved", () => {
		const { storage } = makeStorage();
		expect(() => collectEntityIds({ code: "MEM-404" }, "memory", storage)).toThrow("Memory not found: MEM-404");
	});
});
