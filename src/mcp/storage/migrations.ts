import Database from "better-sqlite3";
import { logger } from "../utils/logger";

export const SCHEMA_VERSION = 2;

interface Migration {
	version: number;
	name: string;
	up: (db: Database.Database) => void;
}

const MIGRATIONS: Migration[] = [
	{
		version: 1,
		name: "initial-schema",
		up: (db) => {
			// ──────────────────────────────────────────────
			// All base tables + indexes
			// ──────────────────────────────────────────────
			db.exec(`
        CREATE TABLE IF NOT EXISTS memories (
          id TEXT PRIMARY KEY,
          repo TEXT NOT NULL,
          owner TEXT NOT NULL DEFAULT '',
          type TEXT NOT NULL,
          title TEXT,
          content TEXT NOT NULL,
          importance INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 5),
          folder TEXT,
          language TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          hit_count INTEGER NOT NULL DEFAULT 0,
          recall_count INTEGER NOT NULL DEFAULT 0,
          last_used_at TEXT,
          agent TEXT NOT NULL DEFAULT 'unknown',
          role TEXT NOT NULL DEFAULT 'unknown',
          model TEXT NOT NULL DEFAULT 'unknown',
          completed_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_memories_repo ON memories(repo);
        CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
        CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance);
        CREATE INDEX IF NOT EXISTS idx_memories_hit_count ON memories(hit_count);
        CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at);
        CREATE INDEX IF NOT EXISTS idx_memories_updated_at ON memories(updated_at);
        CREATE INDEX IF NOT EXISTS idx_memories_repo_created_at ON memories(repo, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_memories_repo_hit_count ON memories(repo, hit_count DESC);
        CREATE INDEX IF NOT EXISTS idx_memories_title ON memories(title);

        CREATE TABLE IF NOT EXISTS memory_summary (
          repo TEXT NOT NULL,
          owner TEXT NOT NULL DEFAULT '',
          summary TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (owner, repo)
        );

        CREATE TABLE IF NOT EXISTS memory_vectors (
          memory_id TEXT PRIMARY KEY,
          vector TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          repo TEXT NOT NULL,
          owner TEXT NOT NULL DEFAULT '',
          task_code TEXT NOT NULL,
          phase TEXT,
          title TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL DEFAULT 'backlog',
          priority INTEGER NOT NULL DEFAULT 3,
          agent TEXT NOT NULL DEFAULT 'unknown',
          role TEXT NOT NULL DEFAULT 'unknown',
          doc_path TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          finished_at TEXT,
          canceled_at TEXT,
          tags TEXT,
          metadata TEXT,
          parent_id TEXT,
          depends_on TEXT,
          est_tokens INTEGER NOT NULL DEFAULT 0,
          in_progress_at TEXT,
          commit_id TEXT,
          changed_files TEXT,
          FOREIGN KEY (parent_id) REFERENCES tasks(id) ON DELETE SET NULL,
          FOREIGN KEY (depends_on) REFERENCES tasks(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_tasks_repo ON tasks(repo);
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_tasks_phase ON tasks(phase);
        CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
        CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);

        CREATE TABLE IF NOT EXISTS task_comments (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          repo TEXT NOT NULL,
          owner TEXT NOT NULL DEFAULT '',
          comment TEXT NOT NULL,
          agent TEXT NOT NULL DEFAULT 'unknown',
          role TEXT NOT NULL DEFAULT 'unknown',
          model TEXT NOT NULL DEFAULT 'unknown',
          previous_status TEXT,
          next_status TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON task_comments(task_id);
        CREATE INDEX IF NOT EXISTS idx_task_comments_repo ON task_comments(repo);
        CREATE INDEX IF NOT EXISTS idx_task_comments_created_at ON task_comments(created_at DESC);

        CREATE TABLE IF NOT EXISTS coding_standards (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          parent_id TEXT,
          context TEXT,
          version TEXT,
          language TEXT,
          stack TEXT,
          is_global INTEGER NOT NULL DEFAULT 0,
          repo TEXT,
          owner TEXT NOT NULL DEFAULT '',
          tags TEXT,
          metadata TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          hit_count INTEGER NOT NULL DEFAULT 0,
          last_used_at TEXT,
          agent TEXT NOT NULL DEFAULT 'unknown',
          model TEXT NOT NULL DEFAULT 'unknown',
          FOREIGN KEY (parent_id) REFERENCES coding_standards(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_coding_standards_repo ON coding_standards(repo);
        CREATE INDEX IF NOT EXISTS idx_coding_standards_is_global ON coding_standards(is_global);
        CREATE INDEX IF NOT EXISTS idx_coding_standards_language ON coding_standards(language);

        CREATE TABLE IF NOT EXISTS standard_vectors (
          standard_id TEXT PRIMARY KEY,
          vector TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          vector_version INTEGER NOT NULL DEFAULT 1,
          FOREIGN KEY (standard_id) REFERENCES coding_standards(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS memories_archive (
          id TEXT PRIMARY KEY,
          repo TEXT NOT NULL,
          owner TEXT NOT NULL DEFAULT '',
          type TEXT NOT NULL,
          content TEXT NOT NULL,
          importance INTEGER NOT NULL,
          folder TEXT,
          language TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          hit_count INTEGER NOT NULL DEFAULT 0,
          recall_count INTEGER NOT NULL DEFAULT 0,
          last_used_at TEXT,
          expires_at TEXT,
          archived_at TEXT NOT NULL,
          agent TEXT NOT NULL DEFAULT 'unknown',
          role TEXT NOT NULL DEFAULT 'unknown',
          model TEXT NOT NULL DEFAULT 'unknown',
          completed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS action_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          action TEXT NOT NULL,
          query TEXT,
          response TEXT,
          memory_id TEXT,
          task_id TEXT,
          repo TEXT NOT NULL,
          owner TEXT NOT NULL DEFAULT '',
          result_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_action_log_repo ON action_log(repo);
        CREATE INDEX IF NOT EXISTS idx_action_log_created_at ON action_log(created_at);

        CREATE TABLE IF NOT EXISTS handoffs (
          id TEXT PRIMARY KEY,
          repo TEXT NOT NULL,
          owner TEXT NOT NULL DEFAULT '',
          from_agent TEXT NOT NULL,
          to_agent TEXT,
          task_id TEXT,
          summary TEXT NOT NULL,
          context TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          expires_at TEXT,
          FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_handoffs_repo ON handoffs(repo);
        CREATE INDEX IF NOT EXISTS idx_handoffs_status ON handoffs(status);
        CREATE INDEX IF NOT EXISTS idx_handoffs_from_agent ON handoffs(from_agent);
        CREATE INDEX IF NOT EXISTS idx_handoffs_to_agent ON handoffs(to_agent);
        CREATE INDEX IF NOT EXISTS idx_handoffs_task_id ON handoffs(task_id);
        CREATE INDEX IF NOT EXISTS idx_handoffs_created_at ON handoffs(created_at);

        CREATE TABLE IF NOT EXISTS claims (
          id TEXT PRIMARY KEY,
          repo TEXT NOT NULL,
          owner TEXT NOT NULL DEFAULT '',
          task_id TEXT NOT NULL,
          agent TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'unknown',
          claimed_at TEXT NOT NULL,
          released_at TEXT,
          metadata TEXT NOT NULL DEFAULT '{}',
          FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_claims_repo ON claims(repo);
        CREATE INDEX IF NOT EXISTS idx_claims_task_id ON claims(task_id);
        CREATE INDEX IF NOT EXISTS idx_claims_agent ON claims(agent);
        CREATE INDEX IF NOT EXISTS idx_claims_claimed_at ON claims(claimed_at);

        CREATE TABLE IF NOT EXISTS entities (
          name TEXT PRIMARY KEY,
          type TEXT NOT NULL DEFAULT 'unknown',
          description TEXT,
          repo TEXT NOT NULL DEFAULT '',
          owner TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
        CREATE INDEX IF NOT EXISTS idx_entities_repo ON entities(repo);

        CREATE TABLE IF NOT EXISTS relations (
          from_entity TEXT NOT NULL,
          to_entity TEXT NOT NULL,
          relation_type TEXT NOT NULL,
          repo TEXT NOT NULL DEFAULT '',
          owner TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          PRIMARY KEY (from_entity, to_entity, relation_type),
          FOREIGN KEY (from_entity) REFERENCES entities(name) ON DELETE CASCADE,
          FOREIGN KEY (to_entity) REFERENCES entities(name) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_relations_from ON relations(from_entity);
        CREATE INDEX IF NOT EXISTS idx_relations_to ON relations(to_entity);
        CREATE INDEX IF NOT EXISTS idx_relations_type ON relations(relation_type);
        CREATE INDEX IF NOT EXISTS idx_relations_repo ON relations(repo);

        CREATE TABLE IF NOT EXISTS observations (
          id TEXT PRIMARY KEY,
          entity_name TEXT NOT NULL,
          observation TEXT NOT NULL,
          repo TEXT NOT NULL DEFAULT '',
          owner TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          FOREIGN KEY (entity_name) REFERENCES entities(name) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_observations_entity ON observations(entity_name);
        CREATE INDEX IF NOT EXISTS idx_observations_repo ON observations(repo);
        CREATE INDEX IF NOT EXISTS idx_observations_created_at ON observations(created_at);

        CREATE TABLE IF NOT EXISTS codebase_files (
          id TEXT PRIMARY KEY,
          repo TEXT NOT NULL,
          file_path TEXT NOT NULL,
          language TEXT,
          checksum TEXT,
          lines INTEGER DEFAULT 0,
          size_bytes INTEGER DEFAULT 0,
          last_indexed_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_codebase_files_repo_path ON codebase_files(repo, file_path);
        CREATE INDEX IF NOT EXISTS idx_codebase_files_repo_indexed ON codebase_files(repo, last_indexed_at);

        CREATE TABLE IF NOT EXISTS codebase_symbols (
          id TEXT PRIMARY KEY,
          repo TEXT NOT NULL,
          file_path TEXT NOT NULL,
          name TEXT NOT NULL,
          kind TEXT NOT NULL,
          exported INTEGER NOT NULL DEFAULT 0,
          default_export INTEGER NOT NULL DEFAULT 0,
          start_line INTEGER,
          start_col INTEGER,
          end_line INTEGER,
          end_col INTEGER,
          signature TEXT,
          doc_comment TEXT,
          parent_symbol_id TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (parent_symbol_id) REFERENCES codebase_symbols(id)
        );

        CREATE INDEX IF NOT EXISTS idx_cs_repo_name ON codebase_symbols(repo, name);
        CREATE INDEX IF NOT EXISTS idx_cs_repo_file ON codebase_symbols(repo, file_path);
        CREATE INDEX IF NOT EXISTS idx_cs_repo_kind ON codebase_symbols(repo, kind);
        CREATE INDEX IF NOT EXISTS idx_cs_name ON codebase_symbols(name);
        CREATE INDEX IF NOT EXISTS idx_cs_parent ON codebase_symbols(parent_symbol_id);
      `);

			// ──────────────────────────────────────────────
			// FTS5 for codebase_symbols
			// ──────────────────────────────────────────────
			const ftsExists = db
				.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='codebase_symbols_fts'")
				.get();
			if (!ftsExists) {
				db.exec(`
          CREATE VIRTUAL TABLE codebase_symbols_fts USING fts5(
            name, doc_comment, content='codebase_symbols', content_rowid='rowid'
          );

          CREATE TRIGGER codebase_symbols_ai AFTER INSERT ON codebase_symbols BEGIN
            INSERT INTO codebase_symbols_fts(rowid, name, doc_comment)
            VALUES (new.rowid, new.name, new.doc_comment);
          END;

          CREATE TRIGGER codebase_symbols_ad AFTER DELETE ON codebase_symbols BEGIN
            INSERT INTO codebase_symbols_fts(codebase_symbols_fts, rowid, name, doc_comment)
            VALUES('delete', old.rowid, old.name, old.doc_comment);
          END;

          CREATE TRIGGER codebase_symbols_au AFTER UPDATE ON codebase_symbols BEGIN
            INSERT INTO codebase_symbols_fts(codebase_symbols_fts, rowid, name, doc_comment)
            VALUES('delete', old.rowid, old.name, old.doc_comment);
            INSERT INTO codebase_symbols_fts(rowid, name, doc_comment)
            VALUES (new.rowid, new.name, new.doc_comment);
          END;
        `);
			}

			// ──────────────────────────────────────────────
			// Legacy column additions (idempotent)
			// ──────────────────────────────────────────────
			const columnsToAdd: Array<{ name: string; table: string; definition: string }> = [
				{ name: "title", table: "memories", definition: "ALTER TABLE memories ADD COLUMN title TEXT" },
				{
					name: "hit_count",
					table: "memories",
					definition: "ALTER TABLE memories ADD COLUMN hit_count INTEGER NOT NULL DEFAULT 0"
				},
				{
					name: "recall_count",
					table: "memories",
					definition: "ALTER TABLE memories ADD COLUMN recall_count INTEGER NOT NULL DEFAULT 0"
				},
				{
					name: "last_used_at",
					table: "memories",
					definition: "ALTER TABLE memories ADD COLUMN last_used_at TEXT"
				},
				{ name: "expires_at", table: "memories", definition: "ALTER TABLE memories ADD COLUMN expires_at TEXT" },
				{ name: "supersedes", table: "memories", definition: "ALTER TABLE memories ADD COLUMN supersedes TEXT" },
				{
					name: "status",
					table: "memories",
					definition: "ALTER TABLE memories ADD COLUMN status TEXT NOT NULL DEFAULT 'active'"
				},
				{
					name: "is_global",
					table: "memories",
					definition: "ALTER TABLE memories ADD COLUMN is_global INTEGER NOT NULL DEFAULT 0"
				},
				{ name: "tags", table: "memories", definition: "ALTER TABLE memories ADD COLUMN tags TEXT" },
				{ name: "metadata", table: "memories", definition: "ALTER TABLE memories ADD COLUMN metadata TEXT" },
				{
					name: "vector_version",
					table: "memory_vectors",
					definition: "ALTER TABLE memory_vectors ADD COLUMN vector_version INTEGER NOT NULL DEFAULT 1"
				},
				{
					name: "parent_id",
					table: "coding_standards",
					definition: "ALTER TABLE coding_standards ADD COLUMN parent_id TEXT"
				},
				{
					name: "hit_count",
					table: "coding_standards",
					definition: "ALTER TABLE coding_standards ADD COLUMN hit_count INTEGER NOT NULL DEFAULT 0"
				},
				{
					name: "last_used_at",
					table: "coding_standards",
					definition: "ALTER TABLE coding_standards ADD COLUMN last_used_at TEXT"
				},
				{
					name: "depends_on",
					table: "tasks",
					definition: "ALTER TABLE tasks ADD COLUMN depends_on TEXT"
				},
				{
					name: "est_tokens",
					table: "tasks",
					definition: "ALTER TABLE tasks ADD COLUMN est_tokens INTEGER NOT NULL DEFAULT 0"
				},
				{
					name: "in_progress_at",
					table: "tasks",
					definition: "ALTER TABLE tasks ADD COLUMN in_progress_at TEXT"
				},
				{ name: "task_code", table: "tasks", definition: "ALTER TABLE tasks ADD COLUMN task_code TEXT" },
				{ name: "task_id", table: "action_log", definition: "ALTER TABLE action_log ADD COLUMN task_id TEXT" },
				{
					name: "agent",
					table: "memories",
					definition: "ALTER TABLE memories ADD COLUMN agent TEXT NOT NULL DEFAULT 'unknown'"
				},
				{
					name: "role",
					table: "memories",
					definition: "ALTER TABLE memories ADD COLUMN role TEXT NOT NULL DEFAULT 'unknown'"
				},
				{
					name: "model",
					table: "memories",
					definition: "ALTER TABLE memories ADD COLUMN model TEXT NOT NULL DEFAULT 'unknown'"
				},
				{
					name: "completed_at",
					table: "memories",
					definition: "ALTER TABLE memories ADD COLUMN completed_at TEXT"
				},
				{
					name: "agent",
					table: "tasks",
					definition: "ALTER TABLE tasks ADD COLUMN agent TEXT NOT NULL DEFAULT 'unknown'"
				},
				{
					name: "role",
					table: "tasks",
					definition: "ALTER TABLE tasks ADD COLUMN role TEXT NOT NULL DEFAULT 'unknown'"
				},
				{ name: "doc_path", table: "tasks", definition: "ALTER TABLE tasks ADD COLUMN doc_path TEXT" },
				{ name: "response", table: "action_log", definition: "ALTER TABLE action_log ADD COLUMN response TEXT" },
				{
					name: "commit_id",
					table: "tasks",
					definition: "ALTER TABLE tasks ADD COLUMN commit_id TEXT"
				},
				{
					name: "changed_files",
					table: "tasks",
					definition: "ALTER TABLE tasks ADD COLUMN changed_files TEXT"
				},
				{
					name: "suggested_skills",
					table: "tasks",
					definition: "ALTER TABLE tasks ADD COLUMN suggested_skills TEXT"
				},
				{
					name: "owner",
					table: "memories",
					definition: "ALTER TABLE memories ADD COLUMN owner TEXT NOT NULL DEFAULT ''"
				},
				{
					name: "owner",
					table: "tasks",
					definition: "ALTER TABLE tasks ADD COLUMN owner TEXT NOT NULL DEFAULT ''"
				},
				{
					name: "owner",
					table: "task_comments",
					definition: "ALTER TABLE task_comments ADD COLUMN owner TEXT NOT NULL DEFAULT ''"
				},
				{
					name: "owner",
					table: "coding_standards",
					definition: "ALTER TABLE coding_standards ADD COLUMN owner TEXT NOT NULL DEFAULT ''"
				},
				{
					name: "owner",
					table: "memories_archive",
					definition: "ALTER TABLE memories_archive ADD COLUMN owner TEXT NOT NULL DEFAULT ''"
				},
				{
					name: "owner",
					table: "action_log",
					definition: "ALTER TABLE action_log ADD COLUMN owner TEXT NOT NULL DEFAULT ''"
				},
				{
					name: "owner",
					table: "handoffs",
					definition: "ALTER TABLE handoffs ADD COLUMN owner TEXT NOT NULL DEFAULT ''"
				},
				{
					name: "owner",
					table: "claims",
					definition: "ALTER TABLE claims ADD COLUMN owner TEXT NOT NULL DEFAULT ''"
				},
				{
					name: "owner",
					table: "memory_summary",
					definition: "ALTER TABLE memory_summary ADD COLUMN owner TEXT NOT NULL DEFAULT ''"
				}
			];

			for (const col of columnsToAdd) {
				try {
					const tableInfo = db.prepare(`PRAGMA table_info(${col.table})`).all() as Array<{ name: string }>;
					const existingTableColumns = tableInfo.map((c) => c.name);

					if (tableInfo.length > 0 && !existingTableColumns.includes(col.name)) {
						db.exec(col.definition);
					}
				} catch {
					// Ignore errors - column might already exist or table doesn't exist
				}
			}

			// ──────────────────────────────────────────────
			// Constraint migrations
			// ──────────────────────────────────────────────
			ensureMemoryTypeConstraint(db);
			ensureTaskStatusConstraintRemoved(db);
			ensureMemoryStatusConstraintRemoved(db);

			// ──────────────────────────────────────────────
			// Additional indexes
			// ──────────────────────────────────────────────
			db.exec(`
        CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);
        CREATE INDEX IF NOT EXISTS idx_memories_supersedes ON memories(supersedes);
        CREATE INDEX IF NOT EXISTS idx_memories_is_global ON memories(is_global);
        CREATE INDEX IF NOT EXISTS idx_coding_standards_hit_count ON coding_standards(hit_count);
      `);

			// ──────────────────────────────────────────────
			// Task code deduplication + unique index
			// ──────────────────────────────────────────────
			const dupRows = db
				.prepare(
					`SELECT owner, repo, task_code, COUNT(*) as cnt
           FROM tasks
           GROUP BY owner, repo, task_code
           HAVING cnt > 1`
				)
				.all() as Array<{ owner: string; repo: string; task_code: string; cnt: number }>;

			if (dupRows.length > 0) {
				logger.info(`Found ${dupRows.length} duplicate task_code(s). Deduplicating by suffix...`);
				for (const dup of dupRows) {
					const rows = db
						.prepare(
							`SELECT id, task_code, created_at FROM tasks
               WHERE owner = ? AND repo = ? AND task_code = ?
               ORDER BY created_at ASC, id ASC`
						)
						.all(dup.owner, dup.repo, dup.task_code) as Array<{
						id: string;
						task_code: string;
						created_at: string;
					}>;

					for (let i = 1; i < rows.length; i++) {
						const newCode = `${dup.task_code}-${i + 1}`;
						db.prepare("UPDATE tasks SET task_code = ? WHERE id = ?").run(newCode, rows[i].id);
					}
					logger.info(`  Deduplicated ${dup.task_code}: kept 1 (${rows[0].id}), renamed ${rows.length - 1} rows`);
				}
			}

			db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_code_owner_repo ON tasks(owner, repo, task_code);");
			db.exec("DROP INDEX IF EXISTS idx_tasks_code;");

			try {
				db.prepare("UPDATE tasks SET task_code = substr(id, 1, 8) WHERE task_code IS NULL").run();
			} catch {
				// Ignore if column doesn't exist
			}

			// ──────────────────────────────────────────────
			// Drop obsolete memories_fts
			// ──────────────────────────────────────────────
			dropObsoleteMemoriesFts(db);
		}
	},
	{
		version: 2,
		name: "memory-and-standard-codes",
		up: (db) => {
			// code column on memories
			const memoriesCols = db.prepare("PRAGMA table_info(memories)").all() as Array<{ name: string }>;
			if (!memoriesCols.some((col) => col.name === "code")) {
				db.prepare("ALTER TABLE memories ADD COLUMN code TEXT").run();
				db.prepare("CREATE INDEX IF NOT EXISTS idx_memories_code ON memories(code)").run();
				db.prepare("CREATE INDEX IF NOT EXISTS idx_memories_repo_code ON memories(repo, code)").run();
			}

			// code column on coding_standards
			const standardsCols = db.prepare("PRAGMA table_info(coding_standards)").all() as Array<{ name: string }>;
			if (!standardsCols.some((col) => col.name === "code")) {
				db.prepare("ALTER TABLE coding_standards ADD COLUMN code TEXT").run();
				db.prepare("CREATE INDEX IF NOT EXISTS idx_coding_standards_code ON coding_standards(code)").run();
				db.prepare("CREATE INDEX IF NOT EXISTS idx_coding_standards_repo_code ON coding_standards(repo, code)").run();
			}
		}
	}
];

// ──────────────────────────────────────────────
// Helper functions (used by migrations)
// ──────────────────────────────────────────────

function dropObsoleteMemoriesFts(db: Database.Database): void {
	try {
		const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts'").get();
		if (!exists) return;

		db.exec("DROP TRIGGER IF EXISTS memories_ai");
		db.exec("DROP TRIGGER IF EXISTS memories_ad");
		db.exec("DROP TRIGGER IF EXISTS memories_au");
		db.exec("DROP TABLE IF EXISTS memories_fts");

		logger.info("[Migration] Dropped obsolete memories_fts FTS5 table and sync triggers");
	} catch (err) {
		logger.warn("[Migration] Failed to drop memories_fts — may have been dropped already", {
			error: String(err)
		});
	}
}

function ensureMemoryTypeConstraint(db: Database.Database): void {
	const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'memories'").get() as
		{ sql: string } | undefined;
	if (!tableInfo?.sql || !String(tableInfo.sql).includes("CHECK (type IN")) {
		return;
	}

	db.exec(`
    CREATE TABLE memories__migrated (
      id TEXT PRIMARY KEY,
      repo TEXT NOT NULL,
      owner TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL,
      title TEXT,
      content TEXT NOT NULL,
      importance INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 5),
      folder TEXT,
      language TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      hit_count INTEGER NOT NULL DEFAULT 0,
      recall_count INTEGER NOT NULL DEFAULT 0,
      last_used_at TEXT,
      expires_at TEXT,
      supersedes TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      is_global INTEGER NOT NULL DEFAULT 0,
      tags TEXT,
      metadata TEXT,
      agent TEXT NOT NULL DEFAULT 'unknown',
      role TEXT NOT NULL DEFAULT 'unknown',
      model TEXT NOT NULL DEFAULT 'unknown',
      completed_at TEXT
    );

    INSERT INTO memories__migrated (
      id, repo, owner, type, title, content, importance, folder, language,
      created_at, updated_at, hit_count, recall_count, last_used_at, expires_at,
      supersedes, status, is_global, tags, metadata, agent, role, model, completed_at
    )
    SELECT
      id, repo, owner, type, title, content, importance, folder, language,
      created_at, updated_at, hit_count, recall_count, last_used_at, expires_at,
      supersedes, status, is_global, tags, metadata, agent, role, model, completed_at
    FROM memories;

    DROP TABLE memories;
    ALTER TABLE memories__migrated RENAME TO memories;
  `);
}

function ensureTaskStatusConstraintRemoved(db: Database.Database): void {
	const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tasks'").get() as
		{ sql: string } | undefined;

	if (
		!tableInfo?.sql ||
		(!String(tableInfo.sql).includes("CHECK (status IN") && !String(tableInfo.sql).includes("DEFAULT 'pending'"))
	) {
		return;
	}

	db.exec(`
    CREATE TABLE tasks__migrated (
      id TEXT PRIMARY KEY,
      repo TEXT NOT NULL,
      owner TEXT NOT NULL DEFAULT '',
      task_code TEXT NOT NULL,
      phase TEXT,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'backlog',
      priority INTEGER NOT NULL DEFAULT 3,
      agent TEXT NOT NULL DEFAULT 'unknown',
      role TEXT NOT NULL DEFAULT 'unknown',
      doc_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT,
      canceled_at TEXT,
      tags TEXT,
      metadata TEXT,
      parent_id TEXT,
      depends_on TEXT,
      est_tokens INTEGER NOT NULL DEFAULT 0,
      in_progress_at TEXT,
      commit_id TEXT,
      changed_files TEXT,
      FOREIGN KEY (parent_id) REFERENCES tasks(id) ON DELETE SET NULL,
      FOREIGN KEY (depends_on) REFERENCES tasks(id) ON DELETE SET NULL
    );

    INSERT INTO tasks__migrated (
      id, repo, owner, task_code, phase, title, description, status, priority,
      agent, role, doc_path, created_at, updated_at, finished_at, canceled_at, tags, metadata, parent_id, depends_on, est_tokens, in_progress_at,
      commit_id, changed_files
    )
    SELECT
      id, repo, owner, task_code, phase, title, description, status, priority,
      agent, role, doc_path, created_at, updated_at, finished_at, canceled_at, tags, metadata, parent_id, depends_on, est_tokens, in_progress_at,
      commit_id, changed_files
    FROM tasks;

    DROP TABLE tasks;
    ALTER TABLE tasks__migrated RENAME TO tasks;
  `);
}

function ensureMemoryStatusConstraintRemoved(db: Database.Database): void {
	const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'memories'").get() as
		{ sql: string } | undefined;
	if (!tableInfo?.sql || !String(tableInfo.sql).includes("CHECK (status IN")) {
		return;
	}

	db.exec(`
    CREATE TABLE memories__migrated (
      id TEXT PRIMARY KEY,
      repo TEXT NOT NULL,
      owner TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL,
      title TEXT,
      content TEXT NOT NULL,
      importance INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 5),
      folder TEXT,
      language TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      hit_count INTEGER NOT NULL DEFAULT 0,
      recall_count INTEGER NOT NULL DEFAULT 0,
      last_used_at TEXT,
      expires_at TEXT,
      supersedes TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      is_global INTEGER NOT NULL DEFAULT 0,
      tags TEXT,
      metadata TEXT,
      agent TEXT NOT NULL DEFAULT 'unknown',
      role TEXT NOT NULL DEFAULT 'unknown',
      model TEXT NOT NULL DEFAULT 'unknown',
      completed_at TEXT
    );

    INSERT INTO memories__migrated (
      id, repo, owner, type, title, content, importance, folder, language,
      created_at, updated_at, hit_count, recall_count, last_used_at, expires_at,
      supersedes, status, is_global, tags, metadata, agent, role, model, completed_at
    )
    SELECT
      id, repo, owner, type, title, content, importance, folder, language,
      created_at, updated_at, hit_count, recall_count, last_used_at, expires_at,
      supersedes, status, is_global, tags, metadata, agent, role, model, completed_at
    FROM memories;

    DROP TABLE memories;
    ALTER TABLE memories__migrated RENAME TO memories;
  `);
}

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
