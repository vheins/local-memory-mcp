import Database from "better-sqlite3";
import { logger } from "../../utils/logger";

import { migration as v01 } from "./v01-initial-schema";
import { migration as v02 } from "./v02-memory-and-standard-codes";
import { migration as v03 } from "./v03-fix-memory-summary-pk";
import { migration as v04 } from "./v04-coding-standards-fts";
import { migration as v05 } from "./v05-composite-owner-repo-indexes";
import { migration as v06 } from "./v06-codebase-symbol-vectors";
import { migration as v07 } from "./v07-task-vectors";
import { migration as v08 } from "./v08-observations-observation-index";
import { migration as v09 } from "./v09-embedding-queue-jobs";
import { migration as v10 } from "./v10-memories-fts";
import { migration as v11 } from "./v11-queue-jobs-status-index";
import { migration as v12 } from "./v12-kg-relations-composite-index";
import { migration as v13 } from "./v13-memories-branch-column";
import { migration as v14 } from "./v14-normalized-tag-indexes";
import { migration as v15 } from "./v15-entity-names-fts";
import { migration as v16 } from "./v16-queue-jobs-content-hash";
import { migration as v17 } from "./v17-symbols-repo-exported-parent-index";
import { migration as v18 } from "./v18-symbols-fts-signature";
import { migration as v19 } from "./v19-symbols-file-path-index";
import { migration as v20 } from "./v20-symbols-name-lower-index";
import { migration as v21 } from "./v21-codebase-references";
import { migration as v22 } from "./v22-kg-degree-cache";
import { migration as v23 } from "./v23-codebase-references-edge-targets";
import { migration as v24 } from "./v24-relations-confidence";

export const SCHEMA_VERSION = 24;

/**
 * A single versioned schema migration. `up` runs inside the migration runner's
 * transaction and MUST be idempotent (the runner re-runs unapplied migrations
 * on every startup and after a crash mid-migration rolls back).
 */
export interface Migration {
	version: number;
	name: string;
	up: (db: Database.Database) => void;
}

// Ordered migration registry — version order MUST be strictly ascending and
// immutable once a version ships (applied-DB determinism). New migrations are
// appended as a new v{N} module; never renumber or edit historical modules.
const MIGRATIONS: Migration[] = [
	v01,
	v02,
	v03,
	v04,
	v05,
	v06,
	v07,
	v08,
	v09,
	v10,
	v11,
	v12,
	v13,
	v14,
	v15,
	v16,
	v17,
	v18,
	v19,
	v20,
	v21,
	v22,
	v23,
	v24
];

// ──────────────────────────────────────────────
// Utils for _schema_version table
// ──────────────────────────────────────────────

const SCHEMA_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS _schema_version (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`;

/**
 * Read the old-style _schema_version table (single-row, version INTEGER NOT NULL).
 * Returns the version number if the old table exists, or 0 if it doesn't.
 */
function readOldSchemaVersion(db: Database.Database): { version: number; exists: true } | { exists: false } {
	try {
		const tableInfo = db.prepare("PRAGMA table_info(_schema_version)").all() as Array<{ name: string }>;
		// Old style: only column named "version", no "name" column
		const isOldStyle =
			tableInfo.length > 0 && tableInfo[0]?.name === "version" && !tableInfo.some((c) => c.name === "name");
		if (!isOldStyle) return { exists: false };

		const row = db.prepare("SELECT IFNULL(MAX(version), 0) as v FROM _schema_version").get() as {
			v: number;
		};
		return { version: row?.v ?? 0, exists: true };
	} catch {
		return { exists: false };
	}
}

/**
 * Get the set of already-applied migration versions from the new-style table.
 */
function getAppliedVersions(db: Database.Database): Set<number> {
	const applied = new Set<number>();
	try {
		const rows = db.prepare("SELECT version FROM _schema_version").all() as { version: number }[];
		for (const row of rows) applied.add(row.version);
	} catch {
		// Table doesn't exist yet — fresh DB
	}
	return applied;
}

export class MigrationManager {
	constructor(private db: Database.Database) {}

	public migrate(): void {
		// ── Step 1: Handle migration of the _schema_version table itself ──
		const oldState = readOldSchemaVersion(this.db);

		if (oldState.exists) {
			// Transition from old single-row format to new per-migration format
			this.db.exec("DROP TABLE IF EXISTS _schema_version");
			this.db.exec(SCHEMA_TABLE_DDL);

			// Mark all migrations up to oldState.version as applied
			for (const m of MIGRATIONS) {
				if (m.version <= oldState.version) {
					this.db.prepare("INSERT OR IGNORE INTO _schema_version (version, name) VALUES (?, ?)").run(m.version, m.name);
				}
			}
			logger.info(`[Migration] Transitioned from old schema version ${oldState.version} to per-migration tracking`);
		} else {
			// Ensure new-style table exists (fresh DB or already transitioned)
			this.db.exec(SCHEMA_TABLE_DDL);
		}

		// ── Step 2: Get already-applied versions ──
		const applied = getAppliedVersions(this.db);

		// ── Step 3: Run unapplied migrations in order ──
		for (const m of MIGRATIONS) {
			if (applied.has(m.version)) {
				logger.debug(`[Migration] v${m.version} (${m.name}) already applied, skipping`);
				continue;
			}

			logger.info(`[Migration] Applying v${m.version}: ${m.name}`);
			this.db.transaction(() => {
				m.up(this.db);
				this.db.prepare("INSERT OR IGNORE INTO _schema_version (version, name) VALUES (?, ?)").run(m.version, m.name);
			})();
			logger.info(`[Migration] Applied v${m.version}: ${m.name}`);
		}
	}

	/**
	 * @deprecated Use the versioned migration system instead.
	 *             addMemoryCodeColumn is now included in migration v2.
	 */
	public addMemoryCodeColumn(): void {
		// Forward to migration 2's up() for idempotency
		const m2 = MIGRATIONS.find((m) => m.version === 2);
		if (m2) m2.up(this.db);
	}

	/**
	 * @deprecated Use the versioned migration system instead.
	 *             addStandardCodeColumn is now included in migration v2.
	 */
	public addStandardCodeColumn(): void {
		// Forward to migration 2's up() for idempotency
		const m2 = MIGRATIONS.find((m) => m.version === 2);
		if (m2) m2.up(this.db);
	}
}
