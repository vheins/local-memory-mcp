import Database from "better-sqlite3";
import { logger } from "../utils/logger";

/**
 * Handles database schema migrations and initial table creation.
 */
export class MigrationManager {
	constructor(private db: Database.Database) {}

	public migrate() {
		// 1. Create base tables first
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        repo TEXT NOT NULL,
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
        repo TEXT PRIMARY KEY,
        summary TEXT NOT NULL,
        updated_at TEXT NOT NULL
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
        FOREIGN KEY (parent_id) REFERENCES tasks(id) ON DELETE SET NULL,
        FOREIGN KEY (depends_on) REFERENCES tasks(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_repo ON tasks(repo);
      CREATE INDEX IF NOT EXISTS idx_tasks_code ON tasks(task_code);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_phase ON tasks(phase);
      CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
      CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);

      CREATE TABLE IF NOT EXISTS task_comments (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        repo TEXT NOT NULL,
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

      CREATE TABLE IF NOT EXISTS memories_archive (
        id TEXT PRIMARY KEY,
        repo TEXT NOT NULL,
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
        result_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_action_log_repo ON action_log(repo);
      CREATE INDEX IF NOT EXISTS idx_action_log_created_at ON action_log(created_at);

      -- FTS5 Virtual Table for Memories
      -- Note: Only using id, title, and content for search indexing
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        id UNINDEXED,
        repo,
        type,
        title,
        content,
        metadata UNINDEXED,
        content='memories',
        content_rowid='id'
      );

      -- Triggers to keep FTS index in sync with base table
      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(id, repo, type, title, content, metadata) 
        VALUES (new.id, new.repo, new.type, new.title, new.content, new.metadata);
      END;
      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, id, repo, type, title, content, metadata) 
        VALUES ('delete', old.id, old.repo, old.type, old.title, old.content, old.metadata);
      END;
      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, id, repo, type, title, content, metadata) 
        VALUES ('delete', old.id, old.repo, old.type, old.title, old.content, old.metadata);
        INSERT INTO memories_fts(id, repo, type, title, content, metadata) 
        VALUES (new.id, new.repo, new.type, new.title, new.content, new.metadata);
      END;
    `);

		// 2. Safely add missing columns for existing tables
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
			{ name: "last_used_at", table: "memories", definition: "ALTER TABLE memories ADD COLUMN last_used_at TEXT" },
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
			{ name: "depends_on", table: "tasks", definition: "ALTER TABLE tasks ADD COLUMN depends_on TEXT" },
			{
				name: "est_tokens",
				table: "tasks",
				definition: "ALTER TABLE tasks ADD COLUMN est_tokens INTEGER NOT NULL DEFAULT 0"
			},
			{ name: "in_progress_at", table: "tasks", definition: "ALTER TABLE tasks ADD COLUMN in_progress_at TEXT" },
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
			{ name: "completed_at", table: "memories", definition: "ALTER TABLE memories ADD COLUMN completed_at TEXT" },
			{
				name: "agent",
				table: "tasks",
				definition: "ALTER TABLE tasks ADD COLUMN agent TEXT NOT NULL DEFAULT 'unknown'"
			},
			{ name: "role", table: "tasks", definition: "ALTER TABLE tasks ADD COLUMN role TEXT NOT NULL DEFAULT 'unknown'" },
			{ name: "doc_path", table: "tasks", definition: "ALTER TABLE tasks ADD COLUMN doc_path TEXT" },
			{ name: "response", table: "action_log", definition: "ALTER TABLE action_log ADD COLUMN response TEXT" }
		];

		for (const col of columnsToAdd) {
			try {
				const tableInfo = this.db.prepare(`PRAGMA table_info(${col.table})`).all() as Array<{ name: string }>;
				const existingTableColumns = tableInfo.map((c) => c.name);

				if (tableInfo.length > 0 && !existingTableColumns.includes(col.name)) {
					this.db.exec(col.definition);
				}
			} catch (e) {
				logger.error(
					`Migration step failed for ${col.table}.${col.name}: ${e instanceof Error ? e.message : String(e)}`
				);
			}
		}

		this.ensureMemoryTypeConstraint();
		this.ensureTaskStatusConstraintRemoved();
		this.ensureMemoryStatusConstraintRemoved();

		this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);
      CREATE INDEX IF NOT EXISTS idx_memories_supersedes ON memories(supersedes);
      CREATE INDEX IF NOT EXISTS idx_memories_is_global ON memories(is_global);
    `);

		// Backfill task_code if it was added via migration
		try {
			this.db.exec("UPDATE tasks SET task_code = substr(id, 1, 8) WHERE task_code IS NULL");
		} catch (e) {
			logger.error(`Legacy backfill task_code failed: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	private ensureMemoryTypeConstraint(): void {
		const tableSql = this.db
			.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'memories'")
			.get() as { sql?: string } | undefined;
		if (!tableSql?.sql || !tableSql.sql.includes("CHECK (type IN")) {
			return;
		}

		this.db.exec(`
      BEGIN TRANSACTION;

      CREATE TABLE memories__migrated (
        id TEXT PRIMARY KEY,
        repo TEXT NOT NULL,
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
        id, repo, type, title, content, importance, folder, language,
        created_at, updated_at, hit_count, recall_count, last_used_at, expires_at,
        supersedes, status, is_global, tags, metadata, agent, role, model, completed_at
      )
      SELECT
        id, repo, type, title, content, importance, folder, language,
        created_at, updated_at, hit_count, recall_count, last_used_at, expires_at,
        supersedes, status, is_global, tags, metadata, agent, role, model, completed_at
      FROM memories;

      DROP TABLE memories;
      ALTER TABLE memories__migrated RENAME TO memories;

      COMMIT;
    `);
	}

	private ensureTaskStatusConstraintRemoved(): void {
		const tableSql = this.db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tasks'").get() as
			| { sql?: string }
			| undefined;

		if (!tableSql?.sql || (!tableSql.sql.includes("CHECK (status IN") && !tableSql.sql.includes("DEFAULT 'pending'"))) {
			return;
		}

		this.db.exec(`
      BEGIN TRANSACTION;

      CREATE TABLE tasks__migrated (
        id TEXT PRIMARY KEY,
        repo TEXT NOT NULL,
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
        FOREIGN KEY (parent_id) REFERENCES tasks(id) ON DELETE SET NULL,
        FOREIGN KEY (depends_on) REFERENCES tasks(id) ON DELETE SET NULL
      );

      INSERT INTO tasks__migrated (
        id, repo, task_code, phase, title, description, status, priority,
        agent, role, doc_path, created_at, updated_at, finished_at, canceled_at, tags, metadata, parent_id, depends_on, est_tokens, in_progress_at
      )
      SELECT
        id, repo, task_code, phase, title, description, status, priority,
        agent, role, doc_path, created_at, updated_at, finished_at, canceled_at, tags, metadata, parent_id, depends_on, est_tokens, in_progress_at
      FROM tasks;

      DROP TABLE tasks;
      ALTER TABLE tasks__migrated RENAME TO tasks;

      COMMIT;
    `);
	}

	private ensureMemoryStatusConstraintRemoved(): void {
		const tableSql = this.db
			.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'memories'")
			.get() as { sql?: string } | undefined;

		if (tableSql?.sql?.includes("status TEXT NOT NULL DEFAULT 'active' CHECK")) {
			this.ensureMemoryTypeConstraint(); // Re-use rebuild logic
		}
	}
}
