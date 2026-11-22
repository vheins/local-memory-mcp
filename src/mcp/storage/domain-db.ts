import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { logger } from "../utils/logger";
import {
	DOMAIN_KG_DB_FILENAME,
	DOMAIN_OBSERVABILITY_DB_FILENAME,
	DOMAIN_SCHEMA_KG,
	DOMAIN_SCHEMA_OBSERVABILITY,
	DOMAIN_SCHEMA_STANDARDS,
	DOMAIN_SCHEMA_TASKS,
	DOMAIN_STANDARDS_DB_FILENAME,
	DOMAIN_TASKS_DB_FILENAME,
	MEMORY_DB_BUSY_TIMEOUT_MS
} from "../utils/constants";
import {
	DOMAIN_SCHEMAS,
	KG_SCHEMA_DDL,
	KG_SCHEMA_TRIGGERS,
	OBSERVABILITY_SCHEMA_DDL,
	STANDARDS_SCHEMA_DDL,
	STANDARDS_SCHEMA_TRIGGERS,
	TASKS_SCHEMA_DDL,
	type DomainSchema
} from "./domain-schema";

/**
 * Per-domain physical database split (ADR-012 / TASK-002).
 *
 * The hot store is one SQLite CONNECTION over five FILES. `memory.db` keeps the
 * `core` group — memories plus every table written inside the same transaction
 * as a memory (`queue_jobs`, `action_log`, `memory_summary`) — and four attached
 * files own the rest:
 *
 * | schema          | file               | tables                                                     |
 * | :-------------- | :----------------- | :--------------------------------------------------------- |
 * | `main` (core)   | `memory.db`        | memories, memories_fts, memory_tags, memory_summary, …      |
 * | `tasks`         | `tasks.db`         | tasks, task_comments, claims, handoffs                     |
 * | `standards`     | `standards.db`     | coding_standards, coding_standards_fts, standard_tags, …    |
 * | `kg`            | `kg.db`            | entities, relations, observations, kg_degrees, …            |
 * | `observability` | `observability.db` | exploration_observations, exploration_evidence             |
 *
 * Grouping is FK-closed: every foreign key target lives in the same file as the
 * child row, because SQLite cannot enforce an FK across databases. FTS5
 * external-content tables (`memories_fts`, `coding_standards_fts`,
 * `entity_names_fts`) are grouped with their `content=` table for the same
 * reason.
 *
 * ## `:memory:` mode keeps the SAME layout
 *
 * `createTestStore()` opens `SQLiteStore(":memory:")`, and ~130 test files run
 * raw SQL against these tables under their BARE names. Rather than special-casing
 * the schema layout per environment, every attached file resolves to its own
 * distinct in-memory database (`ATTACH ':memory:' AS tasks`), so the migration
 * path is identical and tests exercise the production layout. That works because
 * SQLite resolves an UNQUALIFIED table name against every attached schema when
 * exactly one database holds it — so `SELECT … FROM relations` still finds
 * `kg.relations` after the `main` copy is dropped. The one thing that does NOT
 * follow: `sqlite_master` is per-database, so a test that introspects
 * `main.sqlite_master` for a moved table must query the owning schema.
 *
 * ## Forward hazard
 *
 * `MIGRATIONS` only ever runs against `main`. Once the move completes, `main` no
 * longer holds the moved tables, so a future migration that alters one of them
 * must edit the static DDL in `domain-schema.ts` instead (and must not assume the
 * table is reachable from `main`).
 */

/** Copy group: the tables physically moved out of `main`, PARENTS FIRST. */
interface DomainTableSpec {
	/** Table name, identical in `main` (pre-move) and the domain schema. */
	table: string;
	/** Primary-key columns used for the row-by-row presence check. */
	pk: readonly string[];
}

/**
 * Table → group map, parents before children. The DROP phase walks each list in
 * reverse, so children are retired before the parents they reference.
 */
export const DOMAIN_GROUP_TABLES: Record<DomainSchema, readonly DomainTableSpec[]> = {
	tasks: [
		{ table: "tasks", pk: ["id"] },
		{ table: "task_comments", pk: ["id"] },
		{ table: "claims", pk: ["id"] },
		{ table: "handoffs", pk: ["id"] }
	],
	standards: [
		{ table: "coding_standards", pk: ["id"] },
		{ table: "standard_tags", pk: ["standard_id", "tag"] },
		{ table: "standard_stack", pk: ["standard_id", "stack"] }
	],
	kg: [
		{ table: "entities", pk: ["name", "repo"] },
		{ table: "relations", pk: ["from_entity", "to_entity", "relation_type", "repo"] },
		{ table: "observations", pk: ["id"] },
		{ table: "kg_degrees", pk: ["repo", "node"] }
	],
	observability: [
		{ table: "exploration_observations", pk: ["id"] },
		{ table: "exploration_evidence", pk: ["id"] }
	]
};

/**
 * FTS5 index per group, with the backfill strategy it needs after a copy.
 *
 * The two FTS flavours are NOT interchangeable here:
 *
 * - **External-content** (`content=<table>`): the index owns no text; the
 *   `'rebuild'` command re-reads the content table. Used by
 *   `coding_standards_fts` (and by `memories_fts`, which stays in `main`).
 * - **Standalone** (`entity_names_fts`): the index stores its OWN copy of the
 *   text in `entity_names_fts_content`, so `'rebuild'` regenerates it from that
 *   empty copy and silently yields zero rows. It must be repopulated from the
 *   content table explicitly, exactly as the `v15` migration backfill does.
 */
interface DomainFtsSpec {
	/** The FTS5 virtual table name. */
	table: string;
	/** Table the standalone index is repopulated from (absent ⇒ external-content). */
	source?: string;
	/** Indexed columns in FTS declaration order (standalone backfill only). */
	columns?: readonly string[];
}

/** FTS5 indexes owned by each group. */
export const DOMAIN_GROUP_FTS: Record<DomainSchema, readonly DomainFtsSpec[]> = {
	tasks: [],
	standards: [{ table: "coding_standards_fts" }],
	kg: [{ table: "entity_names_fts", source: "entities", columns: ["name", "repo"] }],
	observability: []
};

/** DDL executed to create a group's tables, indexes and FTS indexes. */
const DOMAIN_SCHEMA_DDL: Record<DomainSchema, string> = {
	tasks: TASKS_SCHEMA_DDL,
	standards: STANDARDS_SCHEMA_DDL,
	kg: KG_SCHEMA_DDL,
	observability: OBSERVABILITY_SCHEMA_DDL
};

/** DDL executed to (re)create a group's FTS / cache-maintenance triggers. */
const DOMAIN_SCHEMA_TRIGGERS: Record<DomainSchema, string | null> = {
	tasks: null,
	standards: STANDARDS_SCHEMA_TRIGGERS,
	kg: KG_SCHEMA_TRIGGERS,
	observability: null
};

/** Filename of each attached domain database, co-located with `memory.db`. */
const DOMAIN_DB_FILENAMES: Record<DomainSchema, string> = {
	[DOMAIN_SCHEMA_TASKS]: DOMAIN_TASKS_DB_FILENAME,
	[DOMAIN_SCHEMA_STANDARDS]: DOMAIN_STANDARDS_DB_FILENAME,
	[DOMAIN_SCHEMA_KG]: DOMAIN_KG_DB_FILENAME,
	[DOMAIN_SCHEMA_OBSERVABILITY]: DOMAIN_OBSERVABILITY_DB_FILENAME
};

/** Result of {@link runDomainMigration}. */
export interface DomainMigrationResult {
	/** True when at least one table was physically moved this run. */
	moved: boolean;
	/** Rows moved per table (only tables moved this run). */
	copiedRows: Record<string, number>;
}

/**
 * Resolve the four attached domain database paths that sit alongside the hot
 * memory DB.
 *
 * `:memory:` maps to `:memory:` for every group, so a test store attaches four
 * distinct in-memory databases and never touches disk. The layout (one schema
 * per group) is therefore identical in tests and in production; only the
 * backing file differs.
 */
export function resolveDomainDbPaths(memoryDbPath: string): Record<DomainSchema, string> {
	const resolved = {} as Record<DomainSchema, string>;
	for (const schema of DOMAIN_SCHEMAS) {
		resolved[schema] =
			memoryDbPath === ":memory:" ? ":memory:" : path.join(path.dirname(memoryDbPath), DOMAIN_DB_FILENAMES[schema]);
	}
	return resolved;
}

/** True when `schema` is already present on the connection (PRAGMA database_list). */
function isSchemaAttached(db: Database.Database, schema: string): boolean {
	const rows = db.prepare("PRAGMA database_list").all() as Array<{ name: string }>;
	return rows.some((row) => row.name === schema);
}

/** True when `table` physically exists in `schema`. */
function tableExists(db: Database.Database, schema: string, table: string): boolean {
	const row = db
		.prepare(`SELECT 1 AS present FROM ${schema}.sqlite_master WHERE type = 'table' AND name = ?`)
		.get(table);
	return row !== undefined;
}

/** Column names of `schema.table` in declaration order (empty when absent). */
function tableColumns(db: Database.Database, schema: string, table: string): string[] {
	return (db.prepare(`PRAGMA ${schema}.table_info(${table})`).all() as Array<{ name: string }>).map((col) => col.name);
}

/** Row count of `schema.table`. */
function countRows(db: Database.Database, schema: string, table: string): number {
	return (db.prepare(`SELECT COUNT(*) AS c FROM ${schema}.${table}`).get() as { c: number }).c;
}

/** Quote an identifier for use in SQL (defensive — names come from PRAGMA). */
function quoteIdent(name: string): string {
	return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Attach the four domain databases to the existing connection.
 *
 * Idempotent: a second call is a no-op once the schema is attached. WAL +
 * `synchronous=NORMAL` mirror the hot store; an in-memory domain database keeps
 * its memory journal (`journal_mode=WAL` reports "memory"), which is what tests
 * want. `busy_timeout` is CONNECTION-scoped — setting it per schema rewrites the
 * SAME connection's value, so it is set to the shared `MEMORY_DB_BUSY_TIMEOUT_MS`
 * (the FIX-032 rule from `derived-db.ts`) and never to a lower value.
 *
 * @returns The resolved path of each attached database.
 */
export function attachDomainDbs(db: Database.Database, memoryDbPath: string): Record<DomainSchema, string> {
	const paths = resolveDomainDbPaths(memoryDbPath);

	for (const schema of DOMAIN_SCHEMAS) {
		const dbPath = paths[schema];
		if (dbPath !== ":memory:") {
			const dir = path.dirname(dbPath);
			if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
		}
		if (isSchemaAttached(db, schema)) continue;
		db.prepare(`ATTACH DATABASE ? AS ${schema}`).run(dbPath);
		db.pragma(`${schema}.journal_mode = WAL`);
		db.pragma(`${schema}.synchronous = NORMAL`);
		db.pragma(`${schema}.busy_timeout = ${MEMORY_DB_BUSY_TIMEOUT_MS}`);
	}

	return paths;
}

/**
 * Create each group's tables, indexes and FTS indexes in its own schema.
 *
 * Idempotent by construction (`IF NOT EXISTS`). Table names are schema-qualified
 * while `REFERENCES` targets stay UNQUALIFIED, so an FK resolves inside the
 * group's own file instead of reaching across databases.
 */
export function initDomainSchemas(db: Database.Database): void {
	for (const schema of DOMAIN_SCHEMAS) db.exec(DOMAIN_SCHEMA_DDL[schema]);
}

/**
 * (Re)create each group's FTS and cache-maintenance triggers.
 *
 * Idempotent (`DROP TRIGGER IF EXISTS` + `CREATE`). Trigger NAMES are
 * schema-qualified; the `ON` table and the trigger body stay UNQUALIFIED because
 * SQLite forbids a qualified table name on an INSERT/UPDATE/DELETE inside a
 * trigger — an unqualified body resolves inside the trigger's own schema.
 */
export function createDomainTriggers(db: Database.Database): void {
	for (const schema of DOMAIN_SCHEMAS) {
		const ddl = DOMAIN_SCHEMA_TRIGGERS[schema];
		if (ddl) db.exec(ddl);
	}
}

/**
 * Repopulate every domain FTS index after the copy.
 *
 * The command table name must be UNQUALIFIED inside the command argument:
 * `INSERT INTO kg.entity_names_fts(entity_names_fts) VALUES('rebuild')` is valid,
 * while qualifying the inner argument is a syntax error. The schema qualifier on
 * the target is what selects the file.
 *
 * An external-content index is rebuilt from its content table. A standalone index
 * has no content table to read from, and `'rebuild'` / `'delete-all'` are rejected
 * for it (it keeps its own copy of the text), so it is cleared with a plain
 * `DELETE` and re-populated from the source table in rowid order — the same
 * statement the `v15` migration uses, which keeps each docid 1:1 with its source
 * row so trigger-driven deletes by rowid stay correct.
 */
export function rebuildDomainFts(db: Database.Database): void {
	for (const schema of DOMAIN_SCHEMAS) {
		for (const fts of DOMAIN_GROUP_FTS[schema]) {
			if (!fts.source) {
				db.exec(`INSERT INTO ${schema}.${fts.table}(${fts.table}) VALUES('rebuild')`);
				continue;
			}
			const colList = (fts.columns ?? []).map(quoteIdent).join(", ");
			db.exec(`DELETE FROM ${schema}.${fts.table}`);
			db.exec(
				`INSERT INTO ${schema}.${fts.table}(rowid, ${colList})
				 SELECT rowid, ${colList} FROM ${schema}.${fts.source} ORDER BY rowid`
			);
		}
	}
}

/**
 * Copy one table `main.T` → `<schema>.T` with an explicit column list (the
 * intersection of both schemas), then verify every `main` row is present.
 *
 * @returns The number of rows that existed in `main` (now also in the target).
 * @throws When the target schema is missing a `main` column (schema drift) or
 *   when any source row has no counterpart in the target — the caller aborts the
 *   whole move BEFORE dropping anything, so a failed copy never loses data.
 */
function copyTable(db: Database.Database, schema: DomainSchema, spec: DomainTableSpec): number {
	const { table, pk } = spec;
	const sourceCols = tableColumns(db, "main", table);
	const targetSet = new Set(tableColumns(db, schema, table));
	const missing = sourceCols.filter((col) => !targetSet.has(col));
	if (missing.length > 0) {
		throw new Error(`${schema}.${table} is missing columns present in main: ${missing.join(", ")}`);
	}

	const colList = sourceCols.map(quoteIdent).join(", ");
	db.exec(`INSERT OR REPLACE INTO ${schema}.${table} (${colList}) SELECT ${colList} FROM main.${table}`);

	// Presence check keyed on the primary key, NOT on the row count: an
	// `INSERT OR REPLACE` can collapse duplicate source rows, and a composite PK
	// needs one comparison per column.
	const match = pk.map((col) => `d.${quoteIdent(col)} = m.${quoteIdent(col)}`).join(" AND ");
	const notCopied = (
		db
			.prepare(
				`SELECT COUNT(*) AS c FROM main.${table} m
				 WHERE NOT EXISTS (SELECT 1 FROM ${schema}.${table} d WHERE ${match})`
			)
			.get() as { c: number }
	).c;
	if (notCopied > 0) {
		throw new Error(`${table}: ${notCopied} row(s) missing in ${schema} after copy`);
	}

	return countRows(db, "main", table);
}

/** Trigger names defined on `tables` inside `main` (pre-move cleanup list). */
function mainTriggerNames(db: Database.Database, tables: readonly string[]): string[] {
	const placeholders = tables.map(() => "?").join(", ");
	const rows = db
		.prepare(
			`SELECT name FROM main.sqlite_master WHERE type = 'trigger' AND tbl_name IN (${placeholders}) ORDER BY name`
		)
		.all(...tables) as Array<{ name: string }>;
	return rows.map((row) => row.name);
}

/**
 * One-time (idempotent) move of every non-core table from `main` into its domain
 * file.
 *
 * Copy ALL tables, verify ALL, and only then drop the `main` side — a failure
 * mid-way leaves every `main` table intact, because unqualified SQL keeps
 * resolving to `main` for any table that still lives there. `INSERT OR REPLACE`
 * keyed on each primary key makes a retried run a no-op for already-copied rows.
 *
 * A no-op once no moved table remains in `main`. The cross-file work is
 * deliberately NOT wrapped in a transaction (WAL makes cross-file transactions
 * non-atomic — MEM-132): a rollback would not undo the target-file writes anyway,
 * and the additive copy plus the verify-before-drop ordering is what makes the
 * operation recoverable.
 *
 * FK enforcement is suspended for the copy window because rows arrive in
 * arbitrary order (a child can precede its parent) and restored immediately
 * afterwards. The source rows are already consistent, so no orphan is created.
 * `PRAGMA foreign_keys` is a no-op inside a transaction, which is another reason
 * this function runs outside one.
 */
export function runDomainMigration(db: Database.Database): DomainMigrationResult {
	const toMove: Array<{ schema: DomainSchema; spec: DomainTableSpec }> = [];
	for (const schema of DOMAIN_SCHEMAS) {
		for (const spec of DOMAIN_GROUP_TABLES[schema]) {
			if (tableExists(db, "main", spec.table)) toMove.push({ schema, spec });
		}
	}
	if (toMove.length === 0) return { moved: false, copiedRows: {} };

	const copiedRows: Record<string, number> = {};
	const fkWasOn = (db.pragma("foreign_keys", { simple: true }) as number) === 1;
	if (fkWasOn) db.pragma("foreign_keys = OFF");
	try {
		for (const { schema, spec } of toMove) copiedRows[spec.table] = copyTable(db, schema, spec);
	} finally {
		if (fkWasOn) db.pragma("foreign_keys = ON");
	}

	// Every copy verified — retire the main-side objects. Triggers are dropped
	// explicitly (a virtual FTS table's triggers belong to the CONTENT table, so
	// dropping the FTS index alone would leave them behind); FTS indexes go before
	// their content table, and children before parents.
	for (const schema of DOMAIN_SCHEMAS) {
		const moved = toMove.filter((entry) => entry.schema === schema).map((entry) => entry.spec.table);
		if (moved.length === 0) continue;
		for (const trigger of mainTriggerNames(db, moved)) {
			db.exec(`DROP TRIGGER IF EXISTS main.${quoteIdent(trigger)}`);
		}
		for (const fts of DOMAIN_GROUP_FTS[schema]) {
			if (tableExists(db, "main", fts.table)) db.exec(`DROP TABLE main.${quoteIdent(fts.table)}`);
		}
		for (const table of [...moved].reverse()) db.exec(`DROP TABLE main.${quoteIdent(table)}`);
	}

	logger.info("[DomainDb] Moved domain tables into their own files", {
		tables: toMove.map((e) => e.spec.table),
		copiedRows
	});
	return { moved: true, copiedRows };
}

/**
 * Passive-checkpoint every attached domain database.
 *
 * `wal_checkpoint(PASSIVE)` is a PER-DATABASE operation: the unqualified form
 * only drains `main`'s WAL, so without this the four domain `-wal` files would
 * only shrink on SQLite's own autocheckpoint threshold. Cheap, non-blocking, and
 * safe to call on `:memory:` (which reports no WAL). Failures are the caller's
 * to log — a failed checkpoint never affects committed data.
 */
export function checkpointDomainDbs(db: Database.Database): void {
	for (const schema of DOMAIN_SCHEMAS) {
		if (!isSchemaAttached(db, schema)) continue;
		db.pragma(`${schema}.wal_checkpoint(PASSIVE)`);
	}
}

/**
 * Bring the domain split to a ready state: attach the four files, ensure their
 * schemas, run the one-time move out of `main`, and (re)create the triggers.
 *
 * ## Why a failed move THROWS here (unlike `ensureDerivedReady`)
 *
 * Production SQL for the moved tables is schema-qualified (`tasks.tasks`,
 * `kg.relations`, …). Those schemas are created empty by
 * {@link initDomainSchemas} BEFORE the copy, so after a partially failed copy the
 * qualified SQL would read a HALF-EMPTY domain file while `main` still holds the
 * complete data: rows would silently disappear from reads and writes would land
 * in the incomplete copy. Serving a partly-migrated hot store is worse than not
 * starting, so the failure propagates.
 *
 * This is safe to retry: the move copies every table (idempotent
 * `INSERT OR REPLACE` keyed on the primary key) and drops `main` only after every
 * copy is verified, so a restart re-copies whatever is missing and converges. To
 * roll back instead, stop the server and delete the four `*.db` files next to
 * `memory.db` — `main` is untouched until the drop phase, so it still holds
 * everything (ADR-012 § Data-Preserving Migration Strategy).
 *
 * @returns The migration outcome (`moved: false` when already split).
 * @throws When the move fails; `main` keeps every table so a retry converges.
 */
export function ensureDomainReady(db: Database.Database, memoryDbPath: string): DomainMigrationResult {
	attachDomainDbs(db, memoryDbPath);
	initDomainSchemas(db);

	const migration = runDomainMigration(db);
	createDomainTriggers(db);

	if (migration.moved) {
		try {
			rebuildDomainFts(db);
		} catch (err) {
			logger.warn("[DomainDb] FTS rebuild after move failed", { error: String(err) });
		}
	}

	return migration;
}
