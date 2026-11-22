import type Database from "better-sqlite3";

/**
 * Small SQLite inspection helpers shared by the domain split (ADR-012 /
 * TASK-003): `domain-copy.ts` (copy/verify), `domain-migration.ts` (scan/drop),
 * `domain-disk-guard.ts` (size estimate) and `domain-fts.ts` (rebuild/audit).
 *
 * Every helper takes an explicit schema name. That is unavoidable here: the whole
 * point of the split is that an UNQUALIFIED name resolves to `main` first, so a
 * probe that wants the target file must say so.
 */

/** True when `table` physically exists in `schema`. */
export function tableExists(db: Database.Database, schema: string, table: string): boolean {
	const row = db
		.prepare(`SELECT 1 AS present FROM ${schema}.sqlite_master WHERE type = 'table' AND name = ?`)
		.get(table);
	return row !== undefined;
}

/** Column names of `schema.table` in declaration order (empty when absent). */
export function tableColumns(db: Database.Database, schema: string, table: string): string[] {
	return (db.prepare(`PRAGMA ${schema}.table_info(${table})`).all() as Array<{ name: string }>).map((col) => col.name);
}

/** Row count of `schema.table`. */
export function countRows(db: Database.Database, schema: string, table: string): number {
	return (db.prepare(`SELECT COUNT(*) AS c FROM ${schema}.${table}`).get() as { c: number }).c;
}

/** Quote an identifier for use in SQL (defensive — names come from PRAGMA). */
export function quoteIdent(name: string): string {
	return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Read a scalar PRAGMA as a number; 0 when absent or non-numeric.
 *
 * Uses the row form (`[{ page_count: 42 }]`) rather than `{ simple: true }`:
 * `pragma(..., { simple: true })` returns an object for table-valued pragmas such
 * as `page_count`, so the row form is the only shape that is uniform across every
 * PRAGMA this module reads (mirrors `services/vacuum.ts`).
 */
export function readPragmaNumber(db: Database.Database, pragma: string): number {
	const rows = db.pragma(pragma) as Array<Record<string, number | string>>;
	const first = rows[0];
	if (!first) return 0;
	const value = Object.values(first)[0];
	const num = typeof value === "number" ? value : Number(value);
	return Number.isFinite(num) ? num : 0;
}

/**
 * Whether `schema.table` has an implicit `rowid`.
 *
 * Probed by preparing a `rowid` projection rather than by parsing
 * `sqlite_master.sql`: a `WITHOUT ROWID` table (e.g. `kg_degrees`) rejects the
 * projection, which is the exact signal needed.
 */
export function hasRowid(db: Database.Database, schema: string, table: string): boolean {
	try {
		db.prepare(`SELECT rowid FROM ${schema}.${quoteIdent(table)} LIMIT 0`).all();
		return true;
	} catch {
		return false;
	}
}
