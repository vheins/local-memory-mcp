/**
 * Data-preserving migration of a legacy single-file `memory.db` into the five
 * domain files (ADR-012 / TASK-003).
 *
 * Every case builds a REAL file-backed store in a temp dir, because the
 * production path only differs from `:memory:` by the backing file: the domain
 * schemas are attached either way, so a row-count difference here is a real
 * difference. NEVER touches `storage/` or the operator's own database.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { MigrationManager } from "../storage/migrations";
import { SQLiteStore } from "../storage/sqlite";
import { ensureDomainReady, attachDomainDbs, initDomainSchemas, resolveDomainDbPaths } from "../storage/domain-db";
import { DOMAIN_GROUP_TABLES, runDomainMigration } from "../storage/domain-migration";
import { DOMAIN_SCHEMAS } from "../storage/domain-schema";

const tempDirs: string[] = [];

/** Create a temp directory tracked for cleanup. */
function makeTempDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lmm-domain-"));
	tempDirs.push(dir);
	return dir;
}

/** Temp path for a store's hot database. */
function makeDbPath(dir: string): string {
	return path.join(dir, "memory.db");
}

afterEach(() => {
	vi.restoreAllMocks();
	while (tempDirs.length > 0) {
		fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
	}
});

/** Column names of `schema.table` in declaration order. */
function columnsOf(db: Database.Database, schema: string, table: string): string[] {
	return (db.prepare(`PRAGMA ${schema}.table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name);
}

/**
 * Rows of `schema.table` as column-keyed objects, ordered by a canonical key.
 *
 * Column-keyed rather than positional: the moved DDL lists a few appended columns
 * in a different position than the v40 `main` table, and that must not count as a
 * data difference. The canonical key is the row's own sorted JSON, so the two
 * sides can be compared with `toEqual` regardless of physical row order.
 */
function snapshotRows(db: Database.Database, schema: string, table: string): Array<Record<string, unknown>> {
	const cols = columnsOf(db, schema, table)
		.map((col) => `"${col}"`)
		.join(", ");
	const rows = db.prepare(`SELECT ${cols} FROM ${schema}.${table}`).all() as Array<Record<string, unknown>>;
	return rows
		.map((row) => row)
		.sort((a, b) => JSON.stringify(sortedEntries(a)).localeCompare(JSON.stringify(sortedEntries(b))));
}

/** Entries of `row` sorted by column name (stable comparison key). */
function sortedEntries(row: Record<string, unknown>): Array<[string, unknown]> {
	return Object.entries(row).sort(([a], [b]) => a.localeCompare(b));
}

/** Snapshot of every moved table, keyed `schema.table`, read from its OWN schema. */
function snapshotMovedTables(db: Database.Database): Record<string, Array<Record<string, unknown>>> {
	const out: Record<string, Array<Record<string, unknown>>> = {};
	for (const schema of DOMAIN_SCHEMAS) {
		for (const spec of DOMAIN_GROUP_TABLES[schema])
			out[`${schema}.${spec.table}`] = snapshotRows(db, schema, spec.table);
	}
	return out;
}

/**
 * Snapshot of every moved table read from `main` — the pre-split shape.
 *
 * Before the move all thirteen tables still live in `main`, so the same
 * `schema.table` keys are produced from the single source schema and the two
 * snapshots are directly comparable.
 */
function snapshotMainTables(db: Database.Database): Record<string, Array<Record<string, unknown>>> {
	const out: Record<string, Array<Record<string, unknown>>> = {};
	for (const schema of DOMAIN_SCHEMAS) {
		for (const spec of DOMAIN_GROUP_TABLES[schema])
			out[`${schema}.${spec.table}`] = snapshotRows(db, "main", spec.table);
	}
	return out;
}

/** `_docsize` row count of a schema-qualified FTS index (index-side truth). */
function indexedDocs(db: Database.Database, schema: string, fts: string): number {
	return (db.prepare(`SELECT COUNT(*) AS c FROM ${schema}.${fts}_docsize`).get() as { c: number }).c;
}

/**
 * Build a LEGACY single-file database: the v40 schema in `main` only, with
 * representative rows in every table the split moves. This is exactly what an
 * operator's `memory.db` looks like before the first start of this build.
 */
function createLegacyDb(dbPath: string): void {
	const db = new Database(dbPath);
	try {
		db.pragma("journal_mode = WAL");
		db.pragma("foreign_keys = ON");
		new MigrationManager(db).migrate();

		const now = "2026-01-01T00:00:00.000Z";
		const insert = (sql: string, ...params: unknown[]): void => {
			db.prepare(sql).run(...(params as (string | number | null)[]));
		};

		insert(
			`INSERT INTO memories (id, repo, owner, type, title, content, importance, created_at, updated_at, status, tags)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			"mem-1",
			"acme/widget",
			"acme",
			"code_fact",
			"legacy memory",
			"survived the split",
			4,
			now,
			now,
			"active",
			'["split"]'
		);

		insert(
			`INSERT INTO tasks (id, repo, owner, task_code, title, status, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			"task-1",
			"acme/widget",
			"acme",
			"T1",
			"legacy task",
			"in_progress",
			now,
			now
		);
		insert(
			`INSERT INTO task_comments (id, task_id, repo, owner, comment, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
			"comment-1",
			"task-1",
			"acme/widget",
			"acme",
			"legacy comment",
			now
		);
		insert(
			`INSERT INTO claims (id, repo, owner, task_id, agent, claimed_at) VALUES (?, ?, ?, ?, ?, ?)`,
			"claim-1",
			"acme/widget",
			"acme",
			"task-1",
			"backend",
			now
		);
		insert(
			`INSERT INTO handoffs (id, repo, owner, from_agent, task_id, summary, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			"handoff-1",
			"acme/widget",
			"acme",
			"backend",
			"task-1",
			"legacy handoff",
			now,
			now
		);

		insert(
			`INSERT INTO coding_standards (id, title, content, repo, owner, tags, stack, created_at, updated_at, code)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			"std-1",
			"legacy standard",
			"keep tabs",
			"acme/widget",
			"acme",
			'["style"]',
			'["typescript"]',
			now,
			now,
			"STD-1"
		);

		insert(
			`INSERT INTO entities (name, type, description, repo, owner, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			"SQLiteStore",
			"class",
			"storage entry point",
			"acme/widget",
			"acme",
			now,
			now
		);
		insert(
			`INSERT INTO entities (name, type, description, repo, owner, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			"MemoryEntity",
			"class",
			"memory persistence",
			"acme/widget",
			"acme",
			now,
			now
		);
		insert(
			`INSERT INTO relations (from_entity, to_entity, relation_type, repo, owner, created_at, confidence)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			"SQLiteStore",
			"MemoryEntity",
			"instantiates",
			"acme/widget",
			"acme",
			now,
			0.9
		);
		insert(
			`INSERT INTO observations (id, entity_name, observation, repo, owner, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
			"obs-1",
			"SQLiteStore",
			"owns the connection",
			"acme/widget",
			"acme",
			now
		);

		insert(
			`INSERT INTO exploration_observations
				(id, owner, repo, subject, fact, confidence, identity_hash, freshness, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			"exp-1",
			"acme",
			"acme/widget",
			"storage",
			"five files",
			0.75,
			"hash-1",
			"valid",
			now,
			now
		);
		insert(
			`INSERT INTO exploration_evidence (id, observation_id, file_path, created_at) VALUES (?, ?, ?, ?)`,
			"ev-1",
			"exp-1",
			"src/mcp/storage/domain-db.ts",
			now
		);
	} finally {
		db.close();
	}
}

describe("runDomainMigration on a legacy single-file store", () => {
	it("moves every table into its domain file without changing a single row", () => {
		const dbDir = makeTempDir();
		const legacyPath = makeDbPath(dbDir);
		createLegacyDb(legacyPath);

		// Before: capture the source of truth from `main`, plus the FTS document
		// counts the move has to reproduce.
		const legacy = new Database(legacyPath);
		let before: Record<string, Array<Record<string, unknown>>>;
		let beforeFts: Record<string, number>;
		try {
			before = snapshotMainTables(legacy);
			beforeFts = {
				"main.memories_fts": indexedDocs(legacy, "main", "memories_fts"),
				"standards.coding_standards_fts": indexedDocs(legacy, "main", "coding_standards_fts"),
				"kg.entity_names_fts": indexedDocs(legacy, "main", "entity_names_fts")
			};
		} finally {
			legacy.close();
		}
		expect(before["tasks.tasks"]).toHaveLength(1);
		expect(before["kg.entities"]).toHaveLength(2);
		expect(before["kg.kg_degrees"].length).toBeGreaterThan(0);

		// The production entry point: opening the store runs migrations, the derived
		// move and then the domain split.
		const store = new SQLiteStore(legacyPath);
		try {
			expect(store.getDomainDbPaths()).toEqual(resolveDomainDbPaths(legacyPath));

			// No source table left in `main`, every row now in its own file.
			for (const schema of DOMAIN_SCHEMAS) {
				for (const spec of DOMAIN_GROUP_TABLES[schema]) {
					const inMain = store.db
						.prepare("SELECT 1 AS present FROM main.sqlite_master WHERE type = 'table' AND name = ?")
						.get(spec.table);
					expect(inMain).toBeUndefined();
				}
			}

			// Data preservation, table by table, column by column.
			expect(snapshotMovedTables(store.db)).toEqual(before);

			// FTS: every index holds exactly one document per content row. A rebuild
			// happens in the move, so this is the post-move index state, not a copy.
			expect(indexedDocs(store.db, "main", "memories_fts")).toBe(beforeFts["main.memories_fts"]);
			expect(indexedDocs(store.db, "standards", "coding_standards_fts")).toBe(
				beforeFts["standards.coding_standards_fts"]
			);
			expect(indexedDocs(store.db, "kg", "entity_names_fts")).toBe(beforeFts["kg.entity_names_fts"]);

			// The four files the walk created sit next to memory.db, not in an
			// unrelated directory.
			for (const schema of DOMAIN_SCHEMAS) {
				expect(fs.existsSync(path.join(dbDir, `${schema}.db`))).toBe(true);
			}

			// Read semantics: the entity surface still sees the same rows.
			expect(store.tasks.getTaskById("task-1")?.title).toBe("legacy task");
			expect(store.memories.getById("mem-1")?.content).toBe("survived the split");
		} finally {
			store.close();
		}
	});
});

describe("runDomainMigration retry safety", () => {
	it("is a no-op once the store is split", () => {
		const dbPath = makeDbPath(makeTempDir());
		createLegacyDb(dbPath);

		const store = new SQLiteStore(dbPath);
		try {
			const before = snapshotMovedTables(store.db);
			const again = runDomainMigration(store.db, dbPath);
			expect(again.moved).toBe(false);
			expect(again.tablesMoved).toEqual([]);
			expect(again.copiedRows).toEqual({});
			expect(snapshotMovedTables(store.db)).toEqual(before);
		} finally {
			store.close();
		}
	});

	it("keeps the newer post-split row instead of overwriting it from main", () => {
		const dbPath = makeDbPath(makeTempDir());
		createLegacyDb(dbPath);

		// First start completes the split.
		const store = new SQLiteStore(dbPath);
		try {
			const newerRow = {
				id: "task-1",
				repo: "acme/widget",
				owner: "acme",
				task_code: "T1",
				phase: null,
				title: "RENAMED AFTER THE SPLIT",
				description: null,
				status: "completed",
				priority: 3,
				agent: "unknown",
				role: "unknown",
				doc_path: null,
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: "2026-02-01T00:00:00.000Z",
				finished_at: null,
				canceled_at: null,
				tags: null,
				metadata: null,
				parent_id: null,
				depends_on: null,
				est_tokens: 0,
				in_progress_at: null,
				commit_id: null,
				changed_files: null,
				suggested_skills: null
			};
			store.db.prepare("DELETE FROM tasks.tasks WHERE id = ?").run("task-1");
			const cols = Object.keys(newerRow);
			store.db
				.prepare(
					`INSERT INTO tasks.tasks (${cols.map((c) => `"${c}"`).join(", ")})
					 VALUES (${cols.map(() => "?").join(", ")})`
				)
				.run(...(Object.values(newerRow) as (string | number | null)[]));

			// Simulate the crash shape this guards: `main` STILL holds the stale copy
			// (an interrupted run copied but did not drop) plus an extra row only in
			// the target.
			store.db.exec(`
				CREATE TABLE main.tasks (
					id TEXT PRIMARY KEY, repo TEXT NOT NULL, owner TEXT NOT NULL DEFAULT '', task_code TEXT NOT NULL,
					phase TEXT, title TEXT NOT NULL, description TEXT, status TEXT NOT NULL DEFAULT 'backlog',
					priority INTEGER NOT NULL DEFAULT 3, agent TEXT NOT NULL DEFAULT 'unknown',
					role TEXT NOT NULL DEFAULT 'unknown', doc_path TEXT, created_at TEXT NOT NULL,
					updated_at TEXT NOT NULL, finished_at TEXT, canceled_at TEXT, tags TEXT, metadata TEXT,
					parent_id TEXT, depends_on TEXT, est_tokens INTEGER NOT NULL DEFAULT 0, in_progress_at TEXT,
					commit_id TEXT, changed_files TEXT, suggested_skills TEXT
				)
			`);
			store.db
				.prepare(
					`INSERT INTO main.tasks (id, repo, owner, task_code, title, status, created_at, updated_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
				)
				.run("task-1", "acme/widget", "acme", "T1", "STALE TITLE FROM MAIN", "in_progress", "2026-01-01", "2026-01-01");

			const retry = runDomainMigration(store.db, dbPath);
			expect(retry.moved).toBe(true);
			expect(retry.tablesMoved).toEqual(["tasks"]);

			const task = store.db.prepare("SELECT title, status FROM tasks.tasks WHERE id = ?").get("task-1") as {
				title: string;
				status: string;
			};
			expect(task.title).toBe("RENAMED AFTER THE SPLIT");
			expect(task.status).toBe("completed");
			// Nothing left behind in `main`.
			expect(
				store.db.prepare("SELECT 1 AS present FROM main.sqlite_master WHERE name = 'tasks'").get()
			).toBeUndefined();
		} finally {
			store.close();
		}
	});
});

describe("FTS healing on an already-split store", () => {
	it("rebuilds a drifted index when no main table remains", () => {
		const dbPath = makeDbPath(makeTempDir());
		createLegacyDb(dbPath);

		const store = new SQLiteStore(dbPath);
		try {
			// A crash between the `main` drop and the FTS rebuild leaves the content
			// rows in place and an empty standalone index.
			store.db.exec("DELETE FROM kg.entity_names_fts");
			expect(indexedDocs(store.db, "kg", "entity_names_fts")).toBe(0);

			const healed = ensureDomainReady(store.db, dbPath);
			expect(healed.moved).toBe(false);
			expect(healed.ftsRepaired).toContain("entity_names_fts");
			expect(indexedDocs(store.db, "kg", "entity_names_fts")).toBe(
				(store.db.prepare("SELECT COUNT(*) AS c FROM kg.entities").get() as { c: number }).c
			);
			expect(healed.ftsVerified).toContain("entity_names_fts");
		} finally {
			store.close();
		}
	});
});

describe("disk guard", () => {
	it("refuses to start the copy when the volume cannot hold it", () => {
		const dbPath = makeDbPath(makeTempDir());
		createLegacyDb(dbPath);

		// Probe before the store exists: the guard must fire BEFORE any write, so
		// `main` still holds every table afterwards.
		const db = new Database(dbPath);
		try {
			db.exec("ATTACH DATABASE ':memory:' AS tasks");
			db.exec("ATTACH DATABASE ':memory:' AS standards");
			db.exec("ATTACH DATABASE ':memory:' AS kg");
			db.exec("ATTACH DATABASE ':memory:' AS observability");
			vi.spyOn(fs, "statfsSync").mockReturnValue({ bavail: 0, bsize: 4096 } as unknown as ReturnType<
				typeof fs.statfsSync
			>);

			expect(() => runDomainMigration(db, dbPath)).toThrow(/insufficient disk space/i);
			expect(
				db.prepare("SELECT 1 AS present FROM main.sqlite_master WHERE type = 'table' AND name = 'tasks'").get()
			).toBeDefined();
		} finally {
			db.close();
		}
	});
});

describe("peer holding the write lock on a domain file", () => {
	/**
	 * Open a second connection to the FIRST domain file the copy touches (`tasks`
	 * leads DOMAIN_SCHEMAS) and hold its WAL write lock with `BEGIN IMMEDIATE`.
	 * The peer's own `busy_timeout = 0` keeps its setup from waiting on us.
	 */
	function holdTasksWriteLock(tasksPath: string): Database.Database {
		const peer = new Database(tasksPath);
		peer.pragma("busy_timeout = 0");
		peer.exec("BEGIN IMMEDIATE");
		return peer;
	}

	it("retries, then fails with concurrent-start guidance instead of a raw SQLITE_BUSY", () => {
		const dbDir = makeTempDir();
		const dbPath = makeDbPath(dbDir);
		createLegacyDb(dbPath);

		const db = new Database(dbPath);
		const paths = resolveDomainDbPaths(dbPath);
		let error: unknown;
		try {
			attachDomainDbs(db, dbPath);
			initDomainSchemas(db);

			const peer = holdTasksWriteLock(paths.tasks);
			try {
				runDomainMigration(db, dbPath);
			} catch (err) {
				error = err;
			} finally {
				peer.exec("ROLLBACK");
				peer.close();
			}

			// The run FAILED rather than reporting a completed move. If a busy target
			// were mapped to `concurrent: true`, the table would drop out of
			// `movedTables`/`dropMainSideObjects` and the caller would believe the
			// move succeeded while a table was never copied.
			expect(error).toBeInstanceOf(Error);
			const message = (error as Error).message;
			expect(message).toMatch(/domain migration on tasks\.tasks blocked by another process/);
			expect(message).toMatch(/stop the peer and restart/);
			expect(message).toMatch(/safe to retry/i);
			// The driver error survives as `cause`/`code`, so classifiers still see it.
			expect((error as { code?: string }).code).toBe("SQLITE_BUSY");
			expect((error as { cause?: unknown }).cause).toBeInstanceOf(Error);

			// A permanent lock must never retire a `main` table: nothing was copied,
			// so every source table (and its rows) is still in `main`.
			for (const schema of DOMAIN_SCHEMAS) {
				for (const spec of DOMAIN_GROUP_TABLES[schema]) {
					expect(
						db.prepare("SELECT 1 AS present FROM main.sqlite_master WHERE type = 'table' AND name = ?").get(spec.table)
					).toBeDefined();
				}
			}
			expect((db.prepare("SELECT COUNT(*) AS c FROM main.tasks").get() as { c: number }).c).toBe(1);
		} finally {
			db.close();
		}
	});

	it("completes the move once the peer releases the lock", () => {
		const dbDir = makeTempDir();
		const dbPath = makeDbPath(dbDir);
		createLegacyDb(dbPath);

		const db = new Database(dbPath);
		const paths = resolveDomainDbPaths(dbPath);
		try {
			attachDomainDbs(db, dbPath);
			initDomainSchemas(db);

			const peer = holdTasksWriteLock(paths.tasks);
			let blocked: unknown;
			try {
				runDomainMigration(db, dbPath);
			} catch (err) {
				blocked = err;
			} finally {
				peer.exec("ROLLBACK");
				peer.close();
			}
			expect(blocked).toBeInstanceOf(Error);

			// The peer is gone: the retry converges and moves every table.
			const retry = runDomainMigration(db, dbPath);
			expect(retry.moved).toBe(true);
			expect(retry.tablesMoved).toContain("tasks");

			const task = db.prepare("SELECT title FROM tasks.tasks WHERE id = ?").get("task-1") as { title: string };
			expect(task.title).toBe("legacy task");

			for (const schema of DOMAIN_SCHEMAS) {
				for (const spec of DOMAIN_GROUP_TABLES[schema]) {
					expect(
						db.prepare("SELECT 1 AS present FROM main.sqlite_master WHERE type = 'table' AND name = ?").get(spec.table)
					).toBeUndefined();
				}
			}
		} finally {
			db.close();
		}
	});
});
