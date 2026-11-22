/**
 * Regression guard for the five-file split (ADR-012 / TASK-004).
 *
 * The split is only correct if every table lives in the FILE its domain owns, not
 * merely in some attached schema: an unqualified reference resolves `main` first
 * and then any attached schema, so a table left behind in `memory.db` would keep
 * silently absorbing writes while the domain file stays empty. Schema-qualified
 * production SQL hides that, which is why this test checks the physical files.
 *
 * The expected placement below is transcribed from the ADR-012 file groups, NOT
 * derived from production code: a table moved by editing the production constant
 * alone still fails here.
 */

import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { SQLiteStore } from "../storage/sqlite";
import { DOMAIN_GROUP_FTS } from "../storage/domain-fts";
import { DOMAIN_GROUP_TABLES } from "../storage/domain-migration";
import { DOMAIN_SCHEMAS } from "../storage/domain-schema";

/** ADR-012 file groups, by physical filename. */
const EXPECTED_PLACEMENT: Record<string, readonly string[]> = {
	"memory.db": [
		"memories",
		"memories_fts",
		"memory_tags",
		"memory_summary",
		"memories_archive",
		"queue_jobs",
		"action_log",
		"reuse_telemetry_hourly",
		"bug_reports"
	],
	"tasks.db": ["tasks", "task_comments", "claims", "handoffs"],
	"standards.db": ["coding_standards", "coding_standards_fts", "standard_tags", "standard_stack"],
	"kg.db": ["entities", "relations", "observations", "kg_degrees", "entity_names_fts"],
	"observability.db": ["exploration_observations", "exploration_evidence"]
};

/** Every table of `EXPECTED_PLACEMENT`, flattened. */
const ALL_EXPECTED_TABLES = Object.values(EXPECTED_PLACEMENT).flat();

/** FTS index → the content table it must share a file with. */
const FTS_CONTENT: Record<string, string> = {
	memories_fts: "memories",
	coding_standards_fts: "coding_standards",
	entity_names_fts: "entities"
};

const tempDirs: string[] = [];

/** Create a temp directory tracked for cleanup. */
function makeTempDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lmm-domain-placement-"));
	tempDirs.push(dir);
	return dir;
}

/** Physical table names of a standalone database file, read from its own schema. */
function tablesOfFile(filePath: string): Set<string> {
	const db = new Database(filePath, { readonly: true, fileMustExist: true });
	try {
		const rows = db.prepare("SELECT name FROM main.sqlite_master WHERE type = 'table'").all() as Array<{
			name: string;
		}>;
		return new Set(rows.map((row) => row.name));
	} finally {
		db.close();
	}
}

/** Physical filename that owns `table`, per the ADR groups. */
function ownerFile(table: string): string | undefined {
	for (const [file, tables] of Object.entries(EXPECTED_PLACEMENT)) {
		if (tables.includes(table)) return file;
	}
	return undefined;
}

afterEach(() => {
	while (tempDirs.length > 0) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe("domain table placement", () => {
	it("puts every domain table in its own file and leaves none behind in memory.db", () => {
		const dir = makeTempDir();
		const dbPath = path.join(dir, "memory.db");

		// A fresh store runs the same startup path as production: migrations, the
		// derived move, then the domain split.
		const store = new SQLiteStore(dbPath);
		try {
			const mainTables = new Set(
				(
					store.db.prepare("SELECT name FROM main.sqlite_master WHERE type = 'table'").all() as Array<{
						name: string;
					}>
				).map((row) => row.name)
			);

			// Physical tables of each file on disk, read once per file.
			const onDisk = new Map<string, Set<string>>();
			for (const file of Object.keys(EXPECTED_PLACEMENT)) {
				const filePath = path.join(dir, file);
				expect(fs.existsSync(filePath), `${file} must exist on disk`).toBe(true);
				onDisk.set(file, tablesOfFile(filePath));
			}

			for (const [file, tables] of Object.entries(EXPECTED_PLACEMENT)) {
				for (const table of tables) {
					expect(onDisk.get(file)!.has(table), `${table} must be a physical table of ${file}`).toBe(true);
					for (const [other, otherTables] of onDisk) {
						if (other === file) continue;
						expect(otherTables.has(table), `${table} must not also exist in ${other}`).toBe(false);
					}
				}
			}

			// Nothing moved out of `main` may still sit there, otherwise unqualified
			// SQL would resolve to the stale copy first.
			for (const file of Object.keys(EXPECTED_PLACEMENT)) {
				if (file === "memory.db") continue;
				for (const table of EXPECTED_PLACEMENT[file]) {
					expect(mainTables.has(table), `${table} must not remain in memory.db`).toBe(false);
				}
			}

			// Each FTS index shares its content table's file (external-content FTS5
			// cannot span databases).
			for (const [fts, content] of Object.entries(FTS_CONTENT)) {
				const ftsFile = ownerFile(fts);
				const contentFile = ownerFile(content);
				expect(ftsFile, `${fts} is not declared in any ADR file group`).toBeDefined();
				expect(ftsFile).toBe(contentFile);
			}
		} finally {
			store.close();
		}
	});

	it("keeps the production group map in sync with the ADR file groups", () => {
		// FTS indexes are listed separately (`DOMAIN_GROUP_FTS`) because they are
		// rebuilt in their domain file rather than copied row-by-row, so the union
		// of both maps is what must match the ADR group.
		for (const schema of DOMAIN_SCHEMAS) {
			const declared = [
				...DOMAIN_GROUP_TABLES[schema].map((spec) => spec.table),
				...DOMAIN_GROUP_FTS[schema].map((spec) => spec.table)
			].sort();
			const expected = [...EXPECTED_PLACEMENT[`${schema}.db`]].sort();
			expect(declared, `${schema}.db group drifted from the ADR`).toEqual(expected);
		}

		// Every moved table is claimed by exactly one group, and no core table is.
		const claimed = DOMAIN_SCHEMAS.flatMap((schema) => [
			...DOMAIN_GROUP_TABLES[schema].map((spec) => spec.table),
			...DOMAIN_GROUP_FTS[schema].map((spec) => spec.table)
		]);
		expect(new Set(claimed).size, "a table is claimed by two groups").toBe(claimed.length);
		for (const coreTable of EXPECTED_PLACEMENT["memory.db"]) expect(claimed).not.toContain(coreTable);
		expect([...claimed].sort()).toEqual(
			ALL_EXPECTED_TABLES.filter((table) => !EXPECTED_PLACEMENT["memory.db"].includes(table)).sort()
		);
	});
});
