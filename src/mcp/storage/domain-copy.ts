import type Database from "better-sqlite3";
import { logger } from "../utils/logger";
import { isTransientSqliteError } from "./base";
import type { DomainSchema } from "./domain-schema";
import { countRows, hasRowid, quoteIdent, tableColumns, tableExists } from "./domain-sql";

/**
 * Copy half of the domain split (ADR-012 / TASK-003): move one `main` table into
 * its attached domain file, with a bounded retry when a peer holds the target.
 *
 * The move is additive and verified, never destructive-first: every source table
 * is copied with an EXPLICIT column list (the intersection of source and target
 * columns) via `INSERT OR IGNORE`, so a row the target already holds is left
 * alone — a partially migrated store never has its newer, post-split rows
 * overwritten. The drop phase lives in `domain-migration.ts` and only runs after
 * every copy here has been verified.
 *
 * Two properties make the step safe without a cross-process file lock:
 *
 * - it runs OUTSIDE a transaction (WAL makes cross-file transactions non-atomic,
 *   MEM-132) and never takes `BEGIN IMMEDIATE`, so a long copy can never push a
 *   second process past its `busy_timeout`;
 * - every step tolerates a concurrent peer that already did part of the work: a
 *   source table that disappears mid-copy counts as moved, and the copy itself is
 *   idempotent.
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
 */

/** Schema of the hot store and of everything retired by the move. */
export const CORE_SCHEMA = "main";

/** Copy group: the tables physically moved out of `main`, PARENTS FIRST. */
export interface DomainTableSpec {
	/** Table name, identical in `main` (pre-move) and the domain schema. */
	table: string;
	/** Primary-key columns used for the row-by-row presence check. */
	pk: readonly string[];
}

/** Outcome of copying one table. */
export interface TableCopyOutcome {
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

/**
 * True when `error` is SQLite reporting that `table` is absent from `main`.
 *
 * Anchored on the exact qualified name SQLite emits, so a message about a
 * different (prefix-sharing) table can never be misread as a peer's drop.
 */
export function isMissingSourceTable(error: unknown, table: string): boolean {
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
export function withShortCopyBusyTimeout<T>(db: Database.Database, fn: () => T): T {
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
export function copyTable(db: Database.Database, schema: DomainSchema, spec: DomainTableSpec): TableCopyOutcome {
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
