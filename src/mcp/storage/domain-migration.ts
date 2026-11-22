import type Database from "better-sqlite3";
import { logger } from "../utils/logger";
import { DOMAIN_SCHEMAS, type DomainSchema } from "./domain-schema";
import { auditDomainFts, DOMAIN_GROUP_FTS, repairDomainFts, verifyDomainFtsAfterCopy } from "./domain-fts";
import { quoteIdent, tableExists } from "./domain-sql";
import {
	CORE_SCHEMA,
	copyTable,
	isMissingSourceTable,
	withShortCopyBusyTimeout,
	type DomainTableSpec
} from "./domain-copy";
import { assertEnoughDiskSpace, IN_MEMORY } from "./domain-disk-guard";

/**
 * Data-preserving move of the non-core tables out of `main` into the four
 * attached domain files (ADR-012 / TASK-003).
 *
 * This module owns the SEQUENCE; the pieces live next door:
 *
 * - `domain-copy.ts` — copy one table with an explicit column list, verify it by
 *   row count and primary key, and bound a peer's `SQLITE_BUSY` to a short
 *   retry that ends in a guided error;
 * - `domain-disk-guard.ts` — refuse to start when the volume cannot hold the copy;
 * - `domain-fts.ts` — rebuild and audit the domain-owned FTS indexes.
 *
 * The move is additive and verified, never destructive-first:
 *
 * 1. every source table is copied (see `domain-copy.ts`), so a partially
 *    migrated store never has its newer, post-split rows overwritten;
 * 2. every copy is verified present in the target by primary key, and the target
 *    must hold at least as many rows as the source;
 * 3. the FTS indexes are rebuilt from their content tables and audited against
 *    them (`domain-fts.ts`);
 * 4. ONLY after every check passes are the `main`-side triggers, FTS index and
 *    tables dropped. A failure at any earlier point leaves `main` complete, so
 *    the next startup re-runs the step and converges.
 *
 * ## Crash recovery
 *
 * Any interruption converges on the next startup:
 *
 * - crash during the copy → `main` still holds every table, so the whole move
 *   re-runs (the copy is additive);
 * - crash during the drop → `main` holds only the tables not yet retired, so the
 *   remaining groups move and the already-retired ones are simply absent;
 * - crash after the drop → no source table remains, and the already-split path
 *   audits every FTS index and rebuilds a drifted one.
 *
 * The last case also heals a store left behind by an earlier build that dropped
 * `main` before its FTS rebuild succeeded.
 *
 * ## Resurrected rows (accepted)
 *
 * If a crashed run already copied a row and the user then deleted it, the retry
 * re-inserts it from `main`. That window cannot be served: a failed move makes
 * startup throw (see `ensureDomainReady`), so no post-split mutation can happen
 * while `main` still holds the tables.
 *
 * ## Sequences
 *
 * `sqlite_sequence` is per-database, but the only `AUTOINCREMENT` tables
 * (`action_log`, `bug_reports`) stay in the core group, and an explicit-id insert
 * into an attached `AUTOINCREMENT` table updates that database's own sequence. No
 * sequence bookkeeping is needed for this move.
 */

export type { DomainTableSpec } from "./domain-copy";

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

/** Result of {@link runDomainMigration}. */
export interface DomainMigrationResult {
	/** True when at least one table was physically moved this run. */
	moved: boolean;
	/** Rows the source held per table moved this run. */
	copiedRows: Record<string, number>;
	/** Tables retired from `main` this run (empty when the store was already split). */
	tablesMoved: string[];
	/** FTS indexes found consistent with their content tables this run. */
	ftsVerified: string[];
	/** FTS indexes rebuilt because they had drifted from their content table. */
	ftsRepaired: string[];
	/** Wall-clock duration of the whole step in milliseconds. */
	durationMs: number;
}

/** Trigger names defined on `tables` inside `main` (pre-move cleanup list). */
function mainTriggerNames(db: Database.Database, tables: readonly string[]): string[] {
	if (tables.length === 0) return [];
	const placeholders = tables.map(() => "?").join(", ");
	const rows = db
		.prepare(
			`SELECT name FROM main.sqlite_master WHERE type = 'trigger' AND tbl_name IN (${placeholders}) ORDER BY name`
		)
		.all(...tables) as Array<{ name: string }>;
	return rows.map((row) => row.name);
}

/**
 * Main-side FTS indexes whose content tables were moved this run.
 *
 * Scoped per GROUP: a run that moved only the `tasks` tables must not retire
 * `main.coding_standards_fts`, because its content table is still in `main`.
 */
function mainFtsOfMovedGroups(db: Database.Database, movedTables: readonly string[]): string[] {
	const out: string[] = [];
	for (const schema of DOMAIN_SCHEMAS) {
		const groupTables = DOMAIN_GROUP_TABLES[schema].map((spec) => spec.table);
		if (!groupTables.some((table) => movedTables.includes(table))) continue;
		for (const spec of DOMAIN_GROUP_FTS[schema]) {
			if (tableExists(db, CORE_SCHEMA, spec.table)) out.push(spec.table);
		}
	}
	return out;
}

/**
 * Retire the `main`-side objects of the tables that passed verification.
 *
 * Triggers are dropped explicitly (a virtual FTS table's triggers belong to the
 * CONTENT table, so dropping the FTS index alone would leave them behind); FTS
 * indexes go before their content table, and children before parents. Every
 * statement is `IF EXISTS` and each drop is individually guarded, so a peer
 * dropping the same objects concurrently cannot make this fail.
 *
 * @returns The retired table and FTS names.
 */
function dropMainSideObjects(
	db: Database.Database,
	moved: readonly DomainTableSpec[],
	ftsTables: readonly string[]
): string[] {
	const tables = moved.map((spec) => spec.table);
	const retired: string[] = [];

	for (const trigger of mainTriggerNames(db, tables)) {
		db.exec(`DROP TRIGGER IF EXISTS main.${quoteIdent(trigger)}`);
	}
	for (const fts of ftsTables) {
		try {
			db.exec(`DROP TABLE IF EXISTS main.${quoteIdent(fts)}`);
			retired.push(fts);
		} catch (err) {
			if (!isMissingSourceTable(err, fts)) throw err;
		}
	}
	for (const table of [...tables].reverse()) {
		try {
			db.exec(`DROP TABLE IF EXISTS main.${quoteIdent(table)}`);
			retired.push(table);
		} catch (err) {
			if (!isMissingSourceTable(err, table)) throw err;
		}
	}
	return retired;
}

/**
 * One-time (idempotent) move of every non-core table from `main` into its domain
 * file, followed by an FTS rebuild + verification, then the `main`-side drop.
 *
 * A no-op once no moved table remains in `main`; that path still audits the FTS
 * indexes and repairs drift, which is what makes a crashed or older split
 * converge. The cross-file work is deliberately NOT wrapped in a transaction
 * (WAL makes cross-file transactions non-atomic — MEM-132): a rollback would not
 * undo the target-file writes anyway, and the additive copy plus the
 * verify-before-drop ordering is what makes the operation recoverable.
 *
 * FK enforcement is suspended for the copy window because rows arrive in
 * arbitrary order (a child can precede its parent) and restored immediately
 * afterwards. The source rows are already consistent, so no orphan is created.
 * `PRAGMA foreign_keys` is a no-op inside a transaction, which is another reason
 * this runs outside one.
 *
 * @param db - Connection with the domain schemas already attached.
 * @param memoryDbPath - Path of the hot store (`:memory:` skips the disk guard).
 * @returns What moved this run, with row counts, FTS names and duration.
 * @throws When the disk guard, a copy, a count check, or the FTS verification
 *   fails; `main` keeps every table so the next startup's retry converges. A
 *   target held by another process's write lock surfaces as a bounded error that
 *   names the concurrent start and states the move is safe to retry — never as
 *   a bare `SQLITE_BUSY`, and never as a peer's completed drop.
 */
export function runDomainMigration(db: Database.Database, memoryDbPath: string = IN_MEMORY): DomainMigrationResult {
	const startedAt = Date.now();

	const toMove: Array<{ schema: DomainSchema; spec: DomainTableSpec }> = [];
	for (const schema of DOMAIN_SCHEMAS) {
		for (const spec of DOMAIN_GROUP_TABLES[schema]) {
			if (tableExists(db, CORE_SCHEMA, spec.table)) toMove.push({ schema, spec });
		}
	}

	if (toMove.length === 0) {
		// Already split: no data to move, but a crashed or older run may have left
		// an incomplete FTS index, so audit and heal instead of trusting it.
		const ftsRepaired = repairDomainFts(db);
		const durationMs = Date.now() - startedAt;
		if (ftsRepaired.length > 0) {
			logger.warn("[DomainMigration] Repaired drifted FTS indexes on an already-split store", {
				ftsRepaired,
				durationMs
			});
		}
		return {
			moved: false,
			copiedRows: {},
			tablesMoved: [],
			ftsVerified: auditDomainFts(db),
			ftsRepaired,
			durationMs
		};
	}

	assertEnoughDiskSpace(db, memoryDbPath, toMove.length);

	const copiedRows: Record<string, number> = {};
	const concurrentTables: string[] = [];
	const movedTables: string[] = [];

	const fkWasOn = (db.pragma("foreign_keys", { simple: true }) as number) === 1;
	if (fkWasOn) db.pragma("foreign_keys = OFF");
	try {
		// Short per-attempt busy timeout for the copy window only (restored when the
		// loop returns or throws); see `withShortCopyBusyTimeout`.
		withShortCopyBusyTimeout(db, () => {
			for (const { schema, spec } of toMove) {
				const outcome = copyTable(db, schema, spec);
				copiedRows[spec.table] = outcome.sourceRows;
				if (outcome.concurrent) concurrentTables.push(spec.table);
				else movedTables.push(spec.table);
				logger.debug("[DomainMigration] table copied", {
					table: spec.table,
					schema,
					sourceRows: outcome.sourceRows,
					insertedRows: outcome.insertedRows,
					concurrent: outcome.concurrent
				});
			}
		});
	} finally {
		if (fkWasOn) db.pragma("foreign_keys = ON");
	}

	// Every copy verified (row count + per-PK presence). The FTS step still runs
	// BEFORE any drop, so a mismatch aborts with `main` fully intact.
	const ftsVerified = verifyDomainFtsAfterCopy(db);

	let retired: string[] = [];
	if (movedTables.length > 0) {
		const movedSpecs = toMove.filter((entry) => movedTables.includes(entry.spec.table)).map((entry) => entry.spec);
		retired = dropMainSideObjects(db, movedSpecs, mainFtsOfMovedGroups(db, movedTables));
	}

	const durationMs = Date.now() - startedAt;
	logger.info("[DomainMigration] Moved domain tables into their own files", {
		tables: movedTables,
		copiedRows,
		concurrentTables,
		ftsVerified,
		mainObjectsDropped: retired.length,
		durationMs
	});

	return {
		moved: movedTables.length > 0,
		copiedRows,
		tablesMoved: movedTables,
		ftsVerified,
		ftsRepaired: [],
		durationMs
	};
}
