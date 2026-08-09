import { describe, it, expect, beforeEach } from "vitest";
import { SQLiteStore, createTestStore } from "../../storage/sqlite";
import { CodebaseReferenceEntity } from "../../entities/codebase-reference";

describe("CodebaseReference Entity", () => {
	let store: SQLiteStore;
	let entity: CodebaseReferenceEntity;

	beforeEach(async () => {
		store = await createTestStore();
		entity = store.codebaseReferences;
	});

	it("bulkUpsertReferences inserts refs and getReferencesBySymbol retrieves them", () => {
		const count = entity.bulkUpsertReferences("test-repo", [
			{
				repo: "test-repo",
				symbol_name: "connect",
				caller_file: "src/a.ts",
				caller_line: 12,
				caller_name: "init",
				kind: "call"
			},
			{
				repo: "test-repo",
				symbol_name: "connect",
				caller_file: "src/b.ts",
				caller_line: 3,
				caller_name: null,
				kind: "call"
			},
			{
				repo: "other-repo",
				symbol_name: "connect",
				caller_file: "src/c.ts",
				caller_line: 1,
				caller_name: null,
				kind: "import"
			}
		]);
		expect(count).toBe(3);

		const refs = entity.getReferencesBySymbol("test-repo", "connect");
		// Only test-repo rows, ordered by file then line.
		expect(refs.length).toBe(2);
		expect(refs[0].caller_file).toBe("src/a.ts");
		expect(refs[0].caller_line).toBe(12);
		expect(refs[0].caller_name).toBe("init");
		expect(refs[0].kind).toBe("call");
		expect(refs[1].caller_file).toBe("src/b.ts");

		// Unknown symbol / wrong repo → empty.
		expect(entity.getReferencesBySymbol("test-repo", "nope")).toEqual([]);
		expect(entity.getReferencesBySymbol("nope-repo", "connect")).toEqual([]);
	});

	it("bulkUpsertReferences round-trips v23 edge-target fields (target_file / target_symbol_id)", () => {
		// Heritage + cross-file import edges (Phase 1.1 / TASK-299): the new
		// target columns are written and read back for every reader.
		const count = entity.bulkUpsertReferences("test-repo", [
			{
				repo: "test-repo",
				symbol_name: "Base",
				caller_file: "src/derived.ts",
				caller_line: 1,
				caller_name: null,
				kind: "extends",
				target_file: "src/base.ts",
				target_symbol_id: "sym-base-1"
			},
			{
				repo: "test-repo",
				symbol_name: "Serializable",
				caller_file: "src/derived.ts",
				caller_line: 1,
				caller_name: null,
				kind: "implements",
				target_file: null,
				target_symbol_id: null
			},
			// Legacy v21-style insert (no target fields) → NULL, not undefined.
			{
				repo: "test-repo",
				symbol_name: "connect",
				caller_file: "src/a.ts",
				caller_line: 12,
				caller_name: "init",
				kind: "call"
			}
		]);
		expect(count).toBe(3);

		// getReferencesBySymbol returns the new kinds + targets typed.
		const extendsRefs = entity.getReferencesBySymbol("test-repo", "Base");
		expect(extendsRefs.length).toBe(1);
		expect(extendsRefs[0].kind).toBe("extends");
		expect(extendsRefs[0].target_file).toBe("src/base.ts");
		expect(extendsRefs[0].target_symbol_id).toBe("sym-base-1");
		expect(extendsRefs[0].caller_name).toBeNull();

		// Explicit NULL targets round-trip as null.
		const implementsRefs = entity.getReferencesBySymbol("test-repo", "Serializable");
		expect(implementsRefs.length).toBe(1);
		expect(implementsRefs[0].kind).toBe("implements");
		expect(implementsRefs[0].target_file).toBeNull();
		expect(implementsRefs[0].target_symbol_id).toBeNull();

		// Legacy insert → NULL targets (not undefined) — typed round-trip holds.
		const callRefs = entity.getReferencesBySymbol("test-repo", "connect");
		expect(callRefs.length).toBe(1);
		expect(callRefs[0].kind).toBe("call");
		expect(callRefs[0].target_file).toBeNull();
		expect(callRefs[0].target_symbol_id).toBeNull();

		// getReferencesByFile also returns the new fields (SELECT * path).
		const fileRefs = entity.getReferencesByFile("test-repo", "src/derived.ts");
		expect(fileRefs.length).toBe(2);
		expect(fileRefs[0].target_symbol_id).toBe("sym-base-1");
	});

	it("deleteReferencesByFile removes only that caller file's refs", () => {
		entity.bulkUpsertReferences("test-repo", [
			{ repo: "test-repo", symbol_name: "fx", caller_file: "src/remove.ts", caller_line: 1, kind: "call" },
			{ repo: "test-repo", symbol_name: "fx", caller_file: "src/remove.ts", caller_line: 9, kind: "call" },
			{ repo: "test-repo", symbol_name: "fx", caller_file: "src/keep.ts", caller_line: 2, kind: "call" }
		]);

		const deleted = entity.deleteReferencesByFile("test-repo", "src/remove.ts");
		expect(deleted).toBe(2);

		const remain = entity.getReferencesBySymbol("test-repo", "fx");
		expect(remain.length).toBe(1);
		expect(remain[0].caller_file).toBe("src/keep.ts");

		// Nonexistent file → 0.
		expect(entity.deleteReferencesByFile("test-repo", "nonexistent.ts")).toBe(0);
	});

	it("transferReferencesFilePath moves a caller file's refs to a new path", () => {
		entity.bulkUpsertReferences("test-repo", [
			{ repo: "test-repo", symbol_name: "fx", caller_file: "old.ts", caller_line: 1, kind: "call" }
		]);

		entity.transferReferencesFilePath("test-repo", "old.ts", "new.ts");

		const refs = entity.getReferencesBySymbol("test-repo", "fx");
		expect(refs.length).toBe(1);
		expect(refs[0].caller_file).toBe("new.ts");
	});

	it("getReferencesByFile returns refs for one caller file", () => {
		entity.bulkUpsertReferences("test-repo", [
			{ repo: "test-repo", symbol_name: "a", caller_file: "src/x.ts", caller_line: 5, kind: "call" },
			{ repo: "test-repo", symbol_name: "a", caller_file: "src/x.ts", caller_line: 1, kind: "call" },
			{ repo: "test-repo", symbol_name: "b", caller_file: "src/y.ts", caller_line: 1, kind: "instantiation" }
		]);

		const fileRefs = entity.getReferencesByFile("test-repo", "src/x.ts");
		expect(fileRefs.length).toBe(2);
		// Ordered by caller_line.
		expect(fileRefs[0].caller_line).toBe(1);
		expect(fileRefs[1].caller_line).toBe(5);
	});

	it("deleteReferencesByRepo removes all refs for the repo only", () => {
		entity.bulkUpsertReferences("del-repo", [
			{ repo: "del-repo", symbol_name: "x", caller_file: "s/a.ts", caller_line: 1, kind: "call" },
			{ repo: "del-repo", symbol_name: "y", caller_file: "s/b.ts", caller_line: 1, kind: "call" }
		]);
		entity.bulkUpsertReferences("keep-repo", [
			{ repo: "keep-repo", symbol_name: "z", caller_file: "s/c.ts", caller_line: 1, kind: "call" }
		]);

		expect(entity.deleteReferencesByRepo("del-repo")).toBe(2);
		expect(entity.getReferencesBySymbol("del-repo", "x")).toEqual([]);
		expect(entity.getReferencesBySymbol("keep-repo", "z").length).toBe(1);
	});
});
