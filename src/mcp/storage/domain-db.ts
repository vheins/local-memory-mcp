import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
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
import { runDomainMigration, type DomainMigrationResult } from "./domain-migration";

export { DOMAIN_GROUP_FTS, auditDomainFts, rebuildDomainFts, repairDomainFts } from "./domain-fts";
export { DOMAIN_GROUP_TABLES } from "./domain-migration";
export type { DomainFtsSpec } from "./domain-fts";
export type { DomainMigrationResult, DomainTableSpec } from "./domain-migration";

/**
 * Per-domain physical database split (ADR-012 / TASK-002).
 *
 * The hot store is one SQLite CONNECTION over five FILES. `memory.db` keeps the
 * `core` group — memories plus every table written inside the same transaction
 * as a memory (`queue_jobs`, `action_log`, `memory_summary`) — and four attached
 * files own the rest:
 *
 * | schema          | file               | tables                                                      |
 * | :-------------- | :----------------- | :---------------------------------------------------------- |
 * | `main` (core)   | `memory.db`        | memories, memories_fts, memory_tags, memory_summary, …      |
 * | `tasks`         | `tasks.db`         | tasks, task_comments, claims, handoffs                      |
 * | `standards`     | `standards.db`     | coding_standards, coding_standards_fts, standard_tags, …    |
 * | `kg`            | `kg.db`            | entities, relations, observations, kg_degrees, …            |
 * | `observability` | `observability.db` | exploration_observations, exploration_evidence              |
 *
 * Grouping is FK-closed: every foreign key target lives in the same file as the
 * child row, because SQLite cannot enforce an FK across databases. FTS5
 * external-content tables (`memories_fts`, `coding_standards_fts`,
 * `entity_names_fts`) are grouped with their `content=` table for the same
 * reason.
 *
 * The one-time data move lives in `domain-migration.ts` (copy → verify → FTS
 * audit → drop), which this module attaches, schemas and orchestrates.
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
 * Retrying is the recovery path: the move copies every table (additive, verified)
 * and drops `main` only after every copy and the FTS audit pass, so a restart
 * re-copies whatever is missing and converges. An interrupted drop leaves the
 * remaining tables in `main` and is completed on the next start; a crash between
 * the drop and the FTS audit leaves no `main` table behind, and the already-split
 * path audits every FTS index and rebuilds a drifted one
 * (`repairDomainFts`). To roll back instead, stop the server and delete the four
 * `*.db` files next to `memory.db` — `main` is untouched until the drop phase, so
 * it still holds everything (ADR-012 § Data-Preserving Migration Strategy).
 *
 * @returns The migration outcome (`moved: false` when already split).
 * @throws When the move fails; `main` keeps every table so a retry converges.
 */
export function ensureDomainReady(db: Database.Database, memoryDbPath: string): DomainMigrationResult {
	attachDomainDbs(db, memoryDbPath);
	initDomainSchemas(db);

	const migration = runDomainMigration(db, memoryDbPath);
	createDomainTriggers(db);

	return migration;
}
