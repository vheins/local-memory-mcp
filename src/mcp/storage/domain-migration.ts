import type Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { logger } from "../utils/logger";
import { isTransientSqliteError } from "./base";
import { DOMAIN_SCHEMAS, type DomainSchema } from "./domain-schema";
import { auditDomainFts, DOMAIN_GROUP_FTS, repairDomainFts, verifyDomainFtsAfterCopy } from "./domain-fts";
import { countRows, hasRowid, quoteIdent, readPragmaNumber, tableColumns, tableExists } from "./domain-sql";

/**
 * Data-preserving move of the non-core tables out of `main` into the four
 * attached domain files (ADR-012 / TASK-003).
 *
 * The move is additive and verified, never destructive-first:
 *
 * 1. every source table is copied with an EXPLICIT column list (the intersection
 *    of source and target columns) via `INSERT OR IGNORE`, so a row the target
 *    already holds is left alone — a partially migrated store never has its
 *    newer, post-split rows overwritten;
 * 2. every source row is then verified present in the target by primary key, and
 *    the target must hold at least as many rows as the source;
 * 3. the FTS indexes are rebuilt from their content tables and audited against
 *    them (`domain-fts.ts`);
 * 4. ONLY after every check passes are the `main`-side triggers, FTS index and
 *    tables dropped. A failure at any earlier point leaves `main` complete, so
 *    the next startup re-runs the step and converges.
 *
 * Two properties make the step safe without a cross-process file lock:
 *
 * - it runs OUTSIDE a transaction (WAL makes cross-file transactions non-atomic,
 *   MEM-132) and never takes `BEGIN IMMEDIATE`, so a long copy can never push a
 *   second process past its `busy_timeout`;
 * - every step tolerates a concurrent peer that already did part of the work: a
 *   source table that disappears mid-copy counts as moved, drops use
 *   `IF EXISTS`, and the copy itself is idempotent.
 *
 * ## A peer holding the write lock (the inverse case)
 *
 * The properties above protect the PEER from this process; they do not protect
 * this process from a peer. A second process holding a domain file's write lock
 * makes the copy statements fail with `SQLITE_BUSY` (or `SQLITE_BUSY_SNAPSHOT`,
 * which the busy handler does not wait out). Each statement is retried a few
 * times inside a copy window that uses a short `busy_timeout`, so the budget
 * stays far below `MEMORY_DB_BUSY_TIMEOUT_MS`; exhaustion throws an error that
 * names the concurrent start and says the move is safe to retry. A busy target
 * NEVER counts as `concurrent` (that flag means "a peer already dropped
 * `main`"): a copy that did not run is never treated as a completed move, and
 * nothing is dropped from `main` on that path.
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

/** Copy group: the tables physically moved out of `main`, PARENTS FIRST. */
export interface DomainTableSpec {
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

/** Schema of the hot store and of everything retired by the move. */
const CORE_SCHEMA = "main";

/**
 * Free-disk margin on top of the estimated copy size. A fixed safety floor, not a
 * tuning knob: the copy writes new files while `main` still holds every source
 * page, and a volume driven to zero would break the live store too.
 */
const DISK_HEADROOM_MARGIN_BYTES = 16 * 1024 * 1024;

/** `:memory:` stores never touch disk, so the space guard is skipped for them. */
const IN_MEMORY = ":memory:";

/**
 * Attempts per copy statement before a busy target becomes a terminal error.
 *
 * Small on purpose: a legitimate peer start finishes its copy in seconds, and a
 * peer that holds the lock for longer than this budget is a real conflict the
 * operator has to resolve, not something more waiting will fix.
 */
const COPY_BUSY_ATTEMPTS = 3;

/**
 * Per-attempt `busy_timeout` for the copy window (ms).
 *
 * `PRAGMA busy_timeout` is a per-ATTEMPT wait, not a per-operation budget, so
 * inheriting the configured 30s would make even one retry overshoot the whole
 * timeout. Lowering it for the copy window only keeps the total bounded:
 * `3 x 250ms + <= 100ms backoff ≈ 0.9s`, far below `MEMORY_DB_BUSY_TIMEOUT_MS`.
 */
const COPY_BUSY_TIMEOUT_MS = 250;

/** Base backoff between copy retries (ms); doubles per attempt up to the cap. */
const COPY_RETRY_BASE_MS = 50;

/** Ceiling for a single copy-retry backoff (ms), bounding the blocking wait. */
const COPY_RETRY_MAX_MS = 400;

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

/** Outcome of copying one table. */
interface TableCopyOutcome {
	/** Rows the source table held. */
	sourceRows: number;
	/** Rows added to the target by this call. */
	insertedRows: number;
	/**
	 * True when a concurrent process retired the source table mid-copy. This is
	 * the ONLY meaning: a `SQLITE_BUSY` target is a bounded retryable failure that
	 * throws, never a "someone else finished" outcome.
	 */
	concurrent: boolean;
}

/** Free bytes on the filesystem that holds `dirPath`; degrades OPEN on probe failure. */
function availableDiskBytes(dirPath: string): number {
	try {
		const stats = fs.statfsSync(dirPath);
		return stats.bavail * stats.bsize;
	} catch (err) {
		logger.debug("[DomainMigration] statfs unavailable; assuming ample free disk", {
			dirPath,
			error: String(err)
		});
		return Number.MAX_SAFE_INTEGER;
	}
}

/**
 * Upper bound of the bytes the copy will write, from three O(1) PRAGMAs.
 *
 * `(page_count - freelist_count) * page_size` is the USED size of `main`, which
 * over-estimates the moved tables (the core group stays behind). An exact
 * per-table `dbstat` sum would walk every page of a multi-GB file at startup —
 * not worth it for a pre-flight guard.
 */
function estimateMoveBytes(db: Database.Database): number {
	const pageCount = readPragmaNumber(db, "page_count");
	const pageSize = readPragmaNumber(db, "page_size");
	const freelist = readPragmaNumber(db, "freelist_count");
	return Math.max(0, pageCount - freelist) * pageSize;
}

/**
 * Refuse to start the copy when the target volume cannot hold it.
 *
 * Throws BEFORE any write, so `main` is untouched and the next startup retries.
 * Skipping is not an option: production SQL is schema-qualified, so serving with
 * the move unfinished would read the empty domain tables instead of the complete
 * `main` ones. Failing fast is the only data-safe outcome.
 */
function assertEnoughDiskSpace(db: Database.Database, memoryDbPath: string, tableCount: number): void {
	if (memoryDbPath === IN_MEMORY) return;

	const estimatedBytes = estimateMoveBytes(db);
	const requiredBytes = estimatedBytes + DISK_HEADROOM_MARGIN_BYTES;
	const dirPath = path.dirname(memoryDbPath);
	const freeBytes = availableDiskBytes(dirPath);

	if (freeBytes < requiredBytes) {
		throw new Error(
			`[DomainMigration] insufficient disk space to split memory.db: need ~${requiredBytes} bytes ` +
				`(copy estimate ${estimatedBytes} + ${DISK_HEADROOM_MARGIN_BYTES} margin) but only ${freeBytes} bytes ` +
				`are free on ${dirPath}. Free space (or point MEMORY_DB_PATH at a larger volume) and restart. ` +
				"Nothing was copied or dropped; the move retries on the next startup."
		);
	}

	logger.info("[DomainMigration] disk headroom for the split is sufficient", {
		dirPath,
		freeBytes,
		requiredBytes,
		estimatedCopyBytes: estimatedBytes,
		tableCount
	});
}

/**
 * True when `error` is SQLite reporting that `table` is absent from `main`.
 *
 * Anchored on the exact qualified name SQLite emits, so a message about a
 * different (prefix-sharing) table can never be misread as a peer's drop.
 */
function isMissingSourceTable(error: unknown, table: string): boolean {
	if (!(error instanceof Error)) return false;
	const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`no such table: ${CORE_SCHEMA}\\.${escaped}(?![\\w$])`, "i").test(error.message);
}

/**
 * Block the (synchronous) thread for `ms` milliseconds.
 *
 * better-sqlite3 is synchronous, so a blocking sleep is the only way to back off
 * between retries without yielding the copy; the wait is bounded and only runs
 * on an otherwise-fatal error path (same primitive as `base.ts`).
 */
function sleepSync(ms: number): void {
	if (ms <= 0) return;
	const buffer = new Int32Array(new SharedArrayBuffer(4));
	Atomics.wait(buffer, 0, 0, ms);
}

/**
 * Jittered backoff before retry `attempt` (1-based: the just-failed try).
 *
 * Exponential growth capped at {@link COPY_RETRY_MAX_MS}, plus half-range jitter
 * so two contending starters do not re-collide in lockstep.
 */
function computeCopyBackoffMs(attempt: number): number {
	const ceiling = Math.min(COPY_RETRY_BASE_MS * 2 ** (attempt - 1), COPY_RETRY_MAX_MS);
	return Math.floor(ceiling / 2 + Math.random() * (ceiling / 2));
}

/**
 * Build the terminal error thrown once the bounded copy retry is exhausted.
 *
 * The message names the concurrent start as the cause and states that the move
 * is safe to retry, instead of surfacing a bare `database is locked`. The
 * original driver error is preserved as `cause` and its `code` is copied onto
 * the wrapper, so downstream classifiers still see `SQLITE_BUSY`.
 */
function buildCopyBlockedError(error: unknown, schema: DomainSchema, table: string, attempts: number): Error {
	const original = error instanceof Error ? error : new Error(String(error));
	const code = (original as { code?: unknown }).code;
	const wrapped = new Error(
		`domain migration on ${schema}.${table} blocked by another process after ${attempts} attempt(s) ` +
			`(${original.message}). Another local-memory-mcp process holds the write lock of the target file; ` +
			"stop the peer and restart. Nothing was dropped: `main` still holds every row, so the move is safe to retry.",
		{ cause: original }
	);
	if (typeof code === "string") (wrapped as { code?: string }).code = code;
	return wrapped;
}

/**
 * Run one copy statement, retrying a transient `SQLITE_BUSY` /
 * `SQLITE_BUSY_SNAPSHOT` a bounded number of times.
 *
 * Every attempt runs in autocommit, so a retry starts a FRESH read snapshot —
 * that is what makes `SQLITE_BUSY_SNAPSHOT` retryable at all. Exhaustion throws
 * the terminal error from {@link buildCopyBlockedError}: a busy target is never
 * reported as a completed move, and never as a peer's completed drop.
 */
function runCopyStatement(db: Database.Database, schema: DomainSchema, table: string, sql: string): void {
	let attempt = 0;
	for (;;) {
		try {
			db.exec(sql);
			return;
		} catch (err) {
			attempt += 1;
			if (!isTransientSqliteError(err)) throw err;
			if (attempt >= COPY_BUSY_ATTEMPTS) {
				logger.error("[DomainMigration] copy blocked by another process — giving up", {
					schema,
					table,
					attempts: attempt,
					error: err instanceof Error ? err.message : String(err)
				});
				throw buildCopyBlockedError(err, schema, table, attempt);
			}
			const backoffMs = computeCopyBackoffMs(attempt);
			logger.warn("[DomainMigration] copy blocked by a peer — retrying", {
				schema,
				table,
				attempt,
				maxAttempts: COPY_BUSY_ATTEMPTS,
				backoffMs,
				error: err instanceof Error ? err.message : String(err)
			});
			sleepSync(backoffMs);
		}
	}
}

/**
 * Run `fn` with a SHORT per-attempt `busy_timeout`, then restore the previous
 * value.
 *
 * `busy_timeout` is CONNECTION-scoped (FIX-032), so the store's steady-state
 * value is `MEMORY_DB_BUSY_TIMEOUT_MS` (30s). The copy window lowers it for the
 * duration of the loop only, because that timeout is a per-ATTEMPT wait and the
 * bounded retry budget has to stay far below it. The window is reverted in a
 * `finally` (also when the copy throws), no global constant is touched, and
 * `SQLiteStore` re-asserts the configured value right after startup anyway.
 */
function withShortCopyBusyTimeout<T>(db: Database.Database, fn: () => T): T {
	const configured = Number(db.pragma("busy_timeout", { simple: true }));
	const previous = Number.isFinite(configured) ? configured : 0;
	if (previous <= COPY_BUSY_TIMEOUT_MS) return fn();
	db.pragma(`busy_timeout = ${COPY_BUSY_TIMEOUT_MS}`);
	try {
		return fn();
	} finally {
		db.pragma(`busy_timeout = ${previous}`);
	}
}

/**
 * Copy one table `main.T` → `<schema>.T` with an explicit column list, then
 * verify the row count and per-primary-key presence.
 *
 * Two insert passes, because a partially migrated store can already hold rows:
 *
 * 1. `INSERT OR IGNORE … SELECT rowid, …` preserves each source row's `rowid`, so
 *    an external-content FTS index stays docid-aligned with its content table
 *    (`WITHOUT ROWID` targets skip this pass).
 * 2. `INSERT OR IGNORE … WHERE NOT EXISTS (pk match)` fills the source rows pass
 *    1 had to skip because the target's `rowid` was already taken by a DIFFERENT
 *    row (possible after a crashed or partial run). Those rows get fresh rowids,
 *    which the later FTS rebuild reconciles.
 *
 * `OR IGNORE` (never `OR REPLACE`) is the data-safety choice: an existing target
 * row is the post-split version and wins over the `main` snapshot.
 *
 * @returns Rows the source held, rows added, and whether a peer retired the
 *   source mid-copy.
 * @throws When the target is missing a source column (schema drift), when a
 *   source row has no counterpart in the target, when the target ends up with
 *   fewer rows than the source, or when the target stays locked by another
 *   process after the bounded retry (that error names the concurrent start and
 *   states that the move is safe to retry). The caller aborts before any drop.
 */
function copyTable(db: Database.Database, schema: DomainSchema, spec: DomainTableSpec): TableCopyOutcome {
	const { table, pk } = spec;

	try {
		const sourceCols = tableColumns(db, CORE_SCHEMA, table);
		if (sourceCols.length === 0) {
			// Vanished between the caller's scan and this call.
			return { sourceRows: 0, insertedRows: 0, concurrent: true };
		}
		const targetCols = new Set(tableColumns(db, schema, table));
		const missing = sourceCols.filter((col) => !targetCols.has(col));
		if (missing.length > 0) {
			throw new Error(`${schema}.${table} is missing columns present in main: ${missing.join(", ")}`);
		}

		const colList = sourceCols.map(quoteIdent).join(", ");
		const before = countRows(db, schema, table);

		if (hasRowid(db, schema, table)) {
			runCopyStatement(
				db,
				schema,
				table,
				`INSERT OR IGNORE INTO ${schema}.${table} (rowid, ${colList})
				 SELECT rowid, ${colList} FROM ${CORE_SCHEMA}.${table}`
			);
		}

		const match = pk.map((col) => `t.${quoteIdent(col)} = m.${quoteIdent(col)}`).join(" AND ");
		runCopyStatement(
			db,
			schema,
			table,
			`INSERT OR IGNORE INTO ${schema}.${table} (${colList})
			 SELECT ${colList} FROM ${CORE_SCHEMA}.${table} m
			 WHERE NOT EXISTS (SELECT 1 FROM ${schema}.${table} t WHERE ${match})`
		);

		const sourceRows = countRows(db, CORE_SCHEMA, table);
		const targetRows = countRows(db, schema, table);
		if (targetRows < sourceRows) {
			throw new Error(
				`${table}: target ${schema} holds ${targetRows} row(s) but main holds ${sourceRows} — aborting before any drop`
			);
		}

		const notCopied = (
			db
				.prepare(
					`SELECT COUNT(*) AS c FROM ${CORE_SCHEMA}.${table} m
					 WHERE NOT EXISTS (SELECT 1 FROM ${schema}.${table} t WHERE ${match})`
				)
				.get() as { c: number }
		).c;
		if (notCopied > 0) {
			throw new Error(`${table}: ${notCopied} row(s) missing in ${schema} after copy`);
		}

		return { sourceRows, insertedRows: targetRows - before, concurrent: false };
	} catch (err) {
		// ONLY a peer's completed drop (`no such table: main.T`, re-checked) maps to
		// `concurrent`. A busy/locked target is rethrown as the guided terminal
		// error from `runCopyStatement`; mapping it to `concurrent` would drop the
		// table from `movedTables`/`dropMainSideObjects` and then retire a `main`
		// table whose rows were never copied.
		if (isMissingSourceTable(err, table) && !tableExists(db, CORE_SCHEMA, table)) {
			return { sourceRows: 0, insertedRows: 0, concurrent: true };
		}
		throw err;
	}
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
