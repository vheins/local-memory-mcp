import type Database from "better-sqlite3";
import { logger } from "../utils/logger";
import { DOMAIN_SCHEMAS, type DomainSchema } from "./domain-schema";
import { countRows, quoteIdent, tableExists } from "./domain-sql";

/**
 * FTS5 maintenance for the domain split (ADR-012 / TASK-003).
 *
 * Moving a content table invalidates its FTS index, and the two FTS flavours the
 * store uses need different treatment:
 *
 * - **External-content** (`content=<table>`): the index owns no text; the
 *   `'rebuild'` command re-reads the content table. Used by
 *   `coding_standards_fts` and by `memories_fts` (which never leaves `main`).
 * - **Standalone** (`entity_names_fts`): the index stores its OWN copy of the
 *   text in `entity_names_fts_content`, so `'rebuild'` regenerates it from that
 *   own copy and silently yields zero rows. It must be cleared and repopulated
 *   from the content table explicitly, exactly as the `v15` migration backfill
 *   does.
 *
 * ## Why the audit reads `_docsize`, not `COUNT(*)`
 *
 * `COUNT(*)` on an external-content FTS table reads THROUGH its content table, so
 * it reports the content row count no matter how broken the index is. The
 * `_docsize` shadow table holds one row per INDEXED document and is the only
 * independent oracle available for "did the rebuild actually run".
 */

/** Schema of the hot store (where `memories` and its FTS index live). */
const CORE_SCHEMA = "main";

/** FTS5 index owned by a group, with the backfill strategy it needs. */
export interface DomainFtsSpec {
	/** The FTS5 virtual table name. */
	table: string;
	/** Content table of an external-content index (absent ⇒ standalone). */
	content?: string;
	/** Table a standalone index is repopulated from (absent ⇒ external-content). */
	source?: string;
	/** Indexed columns in FTS declaration order (standalone backfill only). */
	columns?: readonly string[];
}

/** FTS5 indexes owned by each domain group. */
export const DOMAIN_GROUP_FTS: Record<DomainSchema, readonly DomainFtsSpec[]> = {
	tasks: [],
	standards: [{ table: "coding_standards_fts", content: "coding_standards" }],
	kg: [{ table: "entity_names_fts", source: "entities", columns: ["name", "repo"] }],
	observability: []
};

/** FTS index that stays in `main` because its content table stays there. */
const CORE_FTS: DomainFtsSpec = { table: "memories_fts", content: "memories" };

/** One FTS integrity assertion: index document count vs content-table row count. */
interface FtsCheck {
	schema: string;
	fts: string;
	content: string;
	contentRows: number;
	indexedDocs: number | null;
	/** The spec needed to rebuild the index when the check fails. */
	spec: DomainFtsSpec;
}

/** One disagreement between an index and its content table. */
interface FtsMismatch {
	check: FtsCheck;
	detail: string;
}

/** Number of documents the FTS index itself holds, or `null` when it has no `_docsize` shadow table. */
function indexedDocCount(db: Database.Database, schema: string, fts: string): number | null {
	try {
		return (db.prepare(`SELECT COUNT(*) AS c FROM ${schema}.${fts}_docsize`).get() as { c: number }).c;
	} catch {
		return null;
	}
}

/** Every FTS index the split must leave consistent, with its current state. */
function collectFtsChecks(db: Database.Database): FtsCheck[] {
	const checks: FtsCheck[] = [];

	const collect = (schema: string, spec: DomainFtsSpec): void => {
		if (!tableExists(db, schema, spec.table)) return;
		const contentTable = spec.source ?? spec.content;
		if (!contentTable || !tableExists(db, schema, contentTable)) return;
		checks.push({
			schema,
			fts: spec.table,
			content: contentTable,
			contentRows: countRows(db, schema, contentTable),
			indexedDocs: indexedDocCount(db, schema, spec.table),
			spec
		});
	};

	collect(CORE_SCHEMA, CORE_FTS);
	for (const schema of DOMAIN_SCHEMAS) for (const spec of DOMAIN_GROUP_FTS[schema]) collect(schema, spec);
	return checks;
}

/** Mismatches across every auditable index. */
function ftsMismatches(checks: readonly FtsCheck[]): FtsMismatch[] {
	const out: FtsMismatch[] = [];
	for (const check of checks) {
		if (check.indexedDocs === null) continue;
		if (check.indexedDocs === check.contentRows) continue;
		out.push({
			check,
			detail: `${check.schema}.${check.fts}: ${check.indexedDocs} indexed doc(s) vs ${check.contentRows} row(s) in ${check.content}`
		});
	}
	return out;
}

/**
 * Repopulate one FTS index from its content table.
 *
 * The command argument must be UNQUALIFIED: `INSERT INTO kg.entity_names_fts
 * (entity_names_fts) VALUES('rebuild')` is valid, while qualifying the inner
 * argument is a syntax error. The schema qualifier on the TARGET is what selects
 * the file. A standalone index is cleared and re-populated in rowid order, which
 * keeps each docid 1:1 with its source row so trigger-driven deletes by rowid
 * stay correct.
 */
function rebuildFtsIndex(db: Database.Database, schema: string, spec: DomainFtsSpec): void {
	if (!spec.source) {
		db.exec(`INSERT INTO ${schema}.${spec.table}(${spec.table}) VALUES('rebuild')`);
		return;
	}
	const colList = (spec.columns ?? []).map(quoteIdent).join(", ");
	db.exec(`DELETE FROM ${schema}.${spec.table}`);
	db.exec(
		`INSERT INTO ${schema}.${spec.table}(rowid, ${colList})
		 SELECT rowid, ${colList} FROM ${schema}.${spec.source} ORDER BY rowid`
	);
}

/**
 * Rebuild every domain-owned FTS index from its content table.
 *
 * Idempotent and safe on an already-correct index. `memories_fts` is not touched:
 * its content table never leaves `main`.
 */
export function rebuildDomainFts(db: Database.Database): void {
	for (const schema of DOMAIN_SCHEMAS) {
		for (const spec of DOMAIN_GROUP_FTS[schema]) {
			if (tableExists(db, schema, spec.table)) rebuildFtsIndex(db, schema, spec);
		}
	}
}

/**
 * Audit every FTS index against its content table.
 *
 * Audit-only: nothing is written, so the caller decides whether drift is a
 * failure (during the move) or a repair (on an already-split store).
 *
 * @returns The FTS table names that were readable and consistent.
 */
export function auditDomainFts(db: Database.Database): string[] {
	const checks = collectFtsChecks(db);
	const mismatched = new Set(ftsMismatches(checks).map((entry) => entry.check.fts));
	const verified: string[] = [];
	for (const check of checks) {
		if (check.indexedDocs === null) {
			logger.warn("[DomainMigration] FTS index has no _docsize shadow table; cannot audit it", {
				schema: check.schema,
				fts: check.fts
			});
			continue;
		}
		if (!mismatched.has(check.fts)) verified.push(check.fts);
	}
	return verified;
}

/**
 * Strict FTS verification for the move: rebuild the domain indexes, then require
 * every DOMAIN index to hold exactly one document per content row.
 *
 * `memories_fts` is excluded from the failure set — its rows were never copied by
 * this migration, so a mismatch there is pre-existing derived-index drift and
 * must not block a data move that has nothing to do with it
 * ({@link repairDomainFts} heals it on the already-split path).
 *
 * One rebuild+audit retry absorbs a peer process writing between the rebuild and
 * the audit; a mismatch that survives the retry means the copy is broken.
 *
 * @throws When a domain FTS index still disagrees with its content table.
 */
export function verifyDomainFtsAfterCopy(db: Database.Database): string[] {
	for (let attempt = 0; attempt < 2; attempt += 1) {
		rebuildDomainFts(db);
		const mismatches = ftsMismatches(collectFtsChecks(db)).filter((entry) => entry.check.schema !== CORE_SCHEMA);
		if (mismatches.length === 0) return auditDomainFts(db);
		if (attempt === 1) {
			throw new Error(
				`FTS verification failed after the domain copy: ${mismatches.map((entry) => entry.detail).join("; ")}`
			);
		}
		logger.warn("[DomainMigration] FTS audit mismatched after a rebuild; rebuilding once more", {
			mismatches: mismatches.map((entry) => entry.detail)
		});
	}
	// Unreachable: the loop either returns or throws on its last attempt.
	return [];
}

/**
 * Audit every FTS index and rebuild any that drifted from its content table.
 *
 * Used on the already-split path, where there is no `main` copy left to protect
 * and FTS is derived data: drift is REPAIRED (and logged) rather than thrown, so
 * a stale index left by a crashed or older build heals on the next startup
 * instead of stopping the process.
 *
 * @returns The index names that were rebuilt.
 */
export function repairDomainFts(db: Database.Database): string[] {
	const mismatches = ftsMismatches(collectFtsChecks(db));
	if (mismatches.length === 0) return [];

	for (const { check, detail } of mismatches) {
		logger.warn("[DomainMigration] FTS index drifted from its content table; rebuilding", {
			schema: check.schema,
			fts: check.fts,
			detail
		});
		rebuildFtsIndex(db, check.schema, check.spec);
	}

	const remaining = ftsMismatches(collectFtsChecks(db));
	if (remaining.length > 0) {
		logger.error("[DomainMigration] FTS index still inconsistent after a rebuild; serving with a degraded index", {
			mismatches: remaining.map((entry) => entry.detail)
		});
	}
	return mismatches.map((entry) => entry.check.fts);
}
