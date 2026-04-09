import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import { MemoryEntry, MemoryScope, Task, TaskStats, TaskStatus } from "../types.js";
import { tokenize } from "../utils/normalize.js";
import { logger } from "../utils/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolve database path with following priority:
 * 1. MEMORY_DB_PATH env var
 * 2. ~/.config/local-memory-mcp/memory.db (standard user config)
 * 3. Local storage/ folder in CWD (for npx/global usage)
 * 4. Project root storage/ folder
 */
function resolveDbPath(): string {
  if (process.env.MEMORY_DB_PATH) {
    return process.env.MEMORY_DB_PATH;
  }

  // 1. Define the standard global path for this platform
  const standardConfigDir = process.platform === "win32"
    ? path.join(os.homedir(), ".local-memory-mcp")
    : process.platform === "darwin"
      ? path.join(os.homedir(), "Library", "Application Support", "local-memory-mcp")
      : path.join(os.homedir(), ".config", "local-memory-mcp");

  const standardPath = path.join(standardConfigDir, "memory.db");

  // 2. If the global database already exists, ALWAYS use it to ensure consistency
  if (fs.existsSync(standardPath)) {
    return standardPath;
  }

  // 3. Migration/Legacy check: ~/.config/local-memory-mcp/memory.db
  const legacyPath = path.join(os.homedir(), ".config", "local-memory-mcp", "memory.db");
  if (fs.existsSync(legacyPath)) {
    return legacyPath;
  }

  // 4. Development/Portable check: ONLY use local storage if the FILE actually exists.
  // This prevents divergence when one process sees a 'storage/' folder and another doesn't.
  const localCwdFile = path.join(process.cwd(), "storage", "memory.db");
  if (fs.existsSync(localCwdFile)) {
    return localCwdFile;
  }

  const localProjFile = path.join(__dirname, "../../storage", "memory.db");
  if (fs.existsSync(localProjFile)) {
     return localProjFile;
  }

  // 5. Default: Return the standard global path (it will be created by the constructor)
  return standardPath;
}

const DB_PATH = resolveDbPath();

export class SQLiteStore {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const finalPath = dbPath ?? DB_PATH;
    const dbDir = path.dirname(finalPath);
    
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.db = new Database(finalPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("busy_timeout = 5000");
    this.migrate();
  }

  public getDbPath(): string {
    return DB_PATH;
  }

  private migrate() {
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
    `);

    // 2. Safely add missing columns for existing tables
    const columnsToAdd: Array<{ name: string; table: string; definition: string }> = [
      { name: "title", table: "memories", definition: "ALTER TABLE memories ADD COLUMN title TEXT" },
      { name: "hit_count", table: "memories", definition: "ALTER TABLE memories ADD COLUMN hit_count INTEGER NOT NULL DEFAULT 0" },
      { name: "recall_count", table: "memories", definition: "ALTER TABLE memories ADD COLUMN recall_count INTEGER NOT NULL DEFAULT 0" },
      { name: "last_used_at", table: "memories", definition: "ALTER TABLE memories ADD COLUMN last_used_at TEXT" },
      { name: "expires_at", table: "memories", definition: "ALTER TABLE memories ADD COLUMN expires_at TEXT" },
      { name: "supersedes", table: "memories", definition: "ALTER TABLE memories ADD COLUMN supersedes TEXT" },
      { name: "status", table: "memories", definition: "ALTER TABLE memories ADD COLUMN status TEXT NOT NULL DEFAULT 'active'" },
      { name: "is_global", table: "memories", definition: "ALTER TABLE memories ADD COLUMN is_global INTEGER NOT NULL DEFAULT 0" },
      { name: "tags", table: "memories", definition: "ALTER TABLE memories ADD COLUMN tags TEXT" },
      { name: "metadata", table: "memories", definition: "ALTER TABLE memories ADD COLUMN metadata TEXT" },
      { name: "vector_version", table: "memory_vectors", definition: "ALTER TABLE memory_vectors ADD COLUMN vector_version INTEGER NOT NULL DEFAULT 1" },
      { name: "depends_on", table: "tasks", definition: "ALTER TABLE tasks ADD COLUMN depends_on TEXT" },
      { name: "est_tokens", table: "tasks", definition: "ALTER TABLE tasks ADD COLUMN est_tokens INTEGER NOT NULL DEFAULT 0" },
      { name: "in_progress_at", table: "tasks", definition: "ALTER TABLE tasks ADD COLUMN in_progress_at TEXT" },
      { name: "task_code", table: "tasks", definition: "ALTER TABLE tasks ADD COLUMN task_code TEXT" },
      { name: "task_id", table: "action_log", definition: "ALTER TABLE action_log ADD COLUMN task_id TEXT" },
      { name: "agent", table: "memories", definition: "ALTER TABLE memories ADD COLUMN agent TEXT NOT NULL DEFAULT 'unknown'" },
      { name: "role", table: "memories", definition: "ALTER TABLE memories ADD COLUMN role TEXT NOT NULL DEFAULT 'unknown'" },
      { name: "model", table: "memories", definition: "ALTER TABLE memories ADD COLUMN model TEXT NOT NULL DEFAULT 'unknown'" },
      { name: "completed_at", table: "memories", definition: "ALTER TABLE memories ADD COLUMN completed_at TEXT" },
      { name: "agent", table: "tasks", definition: "ALTER TABLE tasks ADD COLUMN agent TEXT NOT NULL DEFAULT 'unknown'" },
      { name: "role", table: "tasks", definition: "ALTER TABLE tasks ADD COLUMN role TEXT NOT NULL DEFAULT 'unknown'" },
      { name: "doc_path", table: "tasks", definition: "ALTER TABLE tasks ADD COLUMN doc_path TEXT" },
      { name: "response", table: "action_log", definition: "ALTER TABLE action_log ADD COLUMN response TEXT" },
    ];

    for (const col of columnsToAdd) {
      try {
        const tableInfo = this.db.prepare(`PRAGMA table_info(${col.table})`).all() as Array<{ name: string }>;
        const existingTableColumns = tableInfo.map((c) => c.name);

        // Only run ALTER TABLE if table exists and column doesn't
        if (tableInfo.length > 0 && !existingTableColumns.includes(col.name)) {
          this.db.exec(col.definition);
        }
      } catch (e) {
        // Skip safely
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
    } catch (e) {}
  }

  insert(entry: MemoryEntry): void {
    const stmt = this.db.prepare(`
      INSERT INTO memories (
        id, repo, type, title, content, importance, folder, language,
        created_at, updated_at, hit_count, recall_count, last_used_at, expires_at,
        supersedes, status, is_global, tags, metadata, agent, role, model, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      entry.id,
      entry.scope.repo,
      entry.type,
      entry.title || null,
      entry.content,
      entry.importance,
      entry.scope.folder || null,
      entry.scope.language || null,
      entry.created_at,
      entry.updated_at,
      entry.expires_at ?? null,
      entry.supersedes ?? null,
      entry.status || "active",
      entry.is_global ? 1 : 0,
      entry.tags ? JSON.stringify(entry.tags) : null,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
      entry.agent || 'unknown',
      entry.role || 'unknown',
      entry.model || 'unknown',
      entry.completed_at || null
    );
  }

  update(id: string, updates: any): void {
    const fields: string[] = [];
    const values: unknown[] = [];

    Object.keys(updates).forEach(key => {
      if (updates[key] !== undefined) {
        if (key === 'tags') {
          fields.push(`tags = ?`);
          values.push(JSON.stringify(updates[key]));
        } else if (key === 'metadata') {
          fields.push(`metadata = ?`);
          values.push(JSON.stringify(updates[key]));
        } else if (key === 'is_global') {
          fields.push(`is_global = ?`);
          values.push(updates[key] ? 1 : 0);
        } else {
          fields.push(`${key} = ?`);
          values.push(updates[key]);
        }
      }
    });

    if (fields.length === 0) return;

    fields.push("updated_at = ?");
    values.push(new Date().toISOString());
    values.push(id);

    const stmt = this.db.prepare(`UPDATE memories SET ${fields.join(", ")} WHERE id = ?`);
    stmt.run(...values);
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
    const tableSql = this.db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tasks'")
      .get() as { sql?: string } | undefined;
    
    // Check if status column has the old restrictive CHECK constraint or old default 'pending'
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
    
    // Check if status column has any check constraint
    if (!tableSql?.sql || !tableSql.sql.includes("status TEXT NOT NULL DEFAULT 'active' CHECK")) {
      if (!tableSql?.sql?.includes("status TEXT NOT NULL DEFAULT 'active'")) {
         // If it doesn't even have the status column, it will be added by the general migration loop anyway
      } else if (!tableSql.sql.includes("CHECK")) {
         // Already removed or not present
         return;
      }
    } else {
        // Continue to migration
    }

    // Re-use ensureMemoryTypeConstraint logic or specifically target status if needed.
    // Since ensureMemoryTypeConstraint already rebuilds the table without checks on type, 
    // we just need to make sure it also doesn't have checks on status in its target schema.
    // The ensureMemoryTypeConstraint target schema (memories__migrated) already has no status check.
  }

  getById(id: string): MemoryEntry | null {
    const row = this.db.prepare("SELECT * FROM memories WHERE id = ?").get(id) as any;
    return row ? this.rowToMemoryEntry(row) : null;
  }

  getByIdWithStats(id: string): any | null {
    const row = this.db.prepare(`
      SELECT *, CASE WHEN hit_count > 0 THEN CAST(recall_count AS REAL) / hit_count ELSE 0 END AS recall_rate
      FROM memories WHERE id = ?
    `).get(id) as any;
    return row ? { ...this.rowToMemoryEntry(row), recall_rate: row.recall_rate ?? 0 } : null;
  }

  getByIds(ids: string[], filters?: { type?: string; status?: string }): MemoryEntry[] {
    if (ids.length === 0) return [];
    
    let query = "SELECT * FROM memories WHERE id IN (" + ids.map(() => "?").join(",") + ")";
    const params: any[] = [...ids];

    if (filters?.type) {
      query += " AND type = ?";
      params.push(filters.type);
    }
    if (filters?.status) {
      query += " AND status = ?";
      params.push(filters.status);
    }

    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map(r => this.rowToMemoryEntry(r));
  }

  searchByRepo(repo: string, options: any = {}): MemoryEntry[] {
    let where = ["(repo = ? OR is_global = 1)"];
    const params: any[] = [repo];

    if (options.tags?.length) {
      const tagConditions = options.tags.map(() => "tags LIKE ?").join(" OR ");
      where.push(`(${tagConditions})`);
      options.tags.forEach((tag: string) => params.push(`%${tag}%`));
    }

    let query = `SELECT * FROM memories WHERE ${where.join(" AND ")} AND (expires_at IS NULL OR expires_at > datetime('now'))`;

    if (!options.includeArchived) query += " AND status = 'active'";
    if (options.types?.length) {
      query += ` AND type IN (${options.types.map(() => "?").join(",")})`;
      params.push(...options.types);
    }
    if (options.minImportance) {
      query += " AND importance >= ?";
      params.push(options.minImportance);
    }

    query += " ORDER BY CASE WHEN repo = ? THEN 0 ELSE 1 END, importance DESC, created_at DESC";
    params.push(repo);

    if (options.limit) {
      query += " LIMIT ?";
      params.push(options.limit);
    }

    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map(r => this.rowToMemoryEntry(r));
  }

  searchBySimilarity(query: string, repo: string, limit: number = 10, includeArchived: boolean = false, currentTags: string[] = []): any[] {
    const queryVector = this.computeVector(query);
    const now = new Date();

    let where = ["(repo = ? OR is_global = 1)"];
    const params: any[] = [repo];

    if (currentTags.length > 0) {
      const tagConditions = currentTags.map(() => "tags LIKE ?").join(" OR ");
      where.push(`(${tagConditions})`);
      currentTags.forEach(tag => params.push(`%${tag}%`));
    }

    let sql = `SELECT * FROM memories WHERE (${where.join(" OR ")}) AND (expires_at IS NULL OR expires_at > ?)`;
    if (!includeArchived) sql += " AND status = 'active'";
    sql += ` ORDER BY CASE WHEN repo = ? THEN 0 ELSE 1 END, importance DESC, created_at DESC LIMIT 100`;
    
    let candidates = this.db.prepare(sql).all(...params, now.toISOString(), repo) as any[];

    // Ensure we have at least some candidates for re-ranking
    if (candidates.length < 5) {
      const recentSql = `SELECT * FROM memories WHERE (${where.join(" OR ")}) AND status = 'active' AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC LIMIT 10`;
      const recent = this.db.prepare(recentSql).all(...params, now.toISOString()) as any[];
      for (const r of recent) {
        if (!candidates.find(c => c.id === r.id)) candidates.push(r);
      }
    }

    return candidates.map(row => {
      const memory = this.rowToMemoryEntry(row);
      
      // Strict validity check
      const isExpired = row.expires_at && new Date(row.expires_at) <= now;
      const isArchived = row.status === 'archived' && !includeArchived;
      
      if (isExpired || isArchived) {
        return { ...memory, similarity: 0 };
      }

      const similarity = this.cosineSimilarity(queryVector, this.computeVector(memory.content));
      
      let score = similarity;
      if (!score) {
        score = 0.16; // Baseline for active candidates
      }
      
      if (row.repo === repo) score += 0.1;
      
      return { ...memory, similarity: score };
    }).filter(r => r.similarity > 0)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  archiveExpiredMemories(force: boolean = false): number {
    if (process.env.ENABLE_AUTO_ARCHIVE !== "true" && !force) return 0;
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE memories SET status = 'archived', updated_at = ? 
      WHERE expires_at IS NOT NULL AND expires_at <= ? AND status = 'active'
    `).run(now, now);
    return result.changes;
  }

  archiveLowScoreMemories(force: boolean = false): number {
    if (process.env.ENABLE_AUTO_ARCHIVE !== "true" && !force) return 0;
    const result = this.db.prepare(`
      UPDATE memories SET status = 'archived', updated_at = ? 
      WHERE status = 'active' AND (
        (julianday('now') - julianday(COALESCE(last_used_at, created_at)) > 90 AND importance < 3)
        OR (hit_count > 10 AND recall_count = 0)
      )
    `).run(new Date().toISOString());
    return result.changes;
  }

  listRecent(limit: number = 10): Array<{ id: string; type: string; repo: string }> {
    const stmt = this.db.prepare("SELECT id, type, repo FROM memories ORDER BY created_at DESC LIMIT ?");
    return stmt.all(limit) as any[];
  }

  getStats(repo?: string): { total: number; byType: Record<string, number>; unused: number } {
    let query = "SELECT type, COUNT(*) as count FROM memories";
    const params: any[] = [];
    if (repo) { query += " WHERE repo = ?"; params.push(repo); }
    query += " GROUP BY type";
    
    const rows = this.db.prepare(query).all(...params) as any[];
    const byType: Record<string, number> = {};
    let total = 0;
    for (const row of rows) { byType[row.type] = row.count; total += row.count; }

    const unusedStmt = repo 
      ? this.db.prepare("SELECT COUNT(*) as count FROM memories WHERE hit_count = 0 AND repo = ?")
      : this.db.prepare("SELECT COUNT(*) as count FROM memories WHERE hit_count = 0");
    const unused = (repo ? unusedStmt.get(repo) : unusedStmt.get()) as any;

    return { total, byType, unused: unused?.count || 0 };
  }

  getTaskStats(repo?: string): any {
    let query = "SELECT status, COUNT(*) as count FROM tasks";
    const params: any[] = [];
    if (repo) {
      query += " WHERE repo = ?";
      params.push(repo);
    }
    query += " GROUP BY status";

    const rows = this.db.prepare(query).all(...params) as any[];
    const stats: TaskStats = {
      total: 0,
      backlog: 0,
      todo: 0,
      inProgress: 0,
      completed: 0,
      blocked: 0,
      canceled: 0
    };

    for (const row of rows) {
      stats.total += row.count;
      if (row.status === "backlog") stats.backlog = row.count;
      else if (row.status === "pending") stats.todo = row.count;
      else if (row.status === "in_progress") stats.inProgress = row.count;
      else if (row.status === "completed") stats.completed = row.count;
      else if (row.status === "blocked") stats.blocked = row.count;
      else if (row.status === "canceled") stats.canceled = row.count;
    }

    return stats;
  }

  getDashboardStats(repo?: string): any {
    const memoryStats = this.getStats(repo);
    const taskStats = this.getTaskStats(repo);

    // Additional stats for dashboard
    let importanceSql = "SELECT AVG(importance) as avg FROM memories";
    let hitsSql = "SELECT SUM(hit_count) as totalHits FROM memories";
    let expiringSql = "SELECT COUNT(*) as count FROM memories WHERE expires_at IS NOT NULL AND expires_at < date('now', '+7 days')";
    
    const params: any[] = [];
    if (repo) {
      importanceSql += " WHERE repo = ?";
      hitsSql += " WHERE repo = ?";
      expiringSql += " AND repo = ?";
      params.push(repo);
    }

    const avgImportance = (this.db.prepare(importanceSql).get(...params) as any)?.avg || 0;
    const totalHitCount = (this.db.prepare(hitsSql).get(...params) as any)?.totalHits || 0;
    const expiringSoon = (this.db.prepare(expiringSql).get(...params) as any)?.count || 0;

    // Today's stats
    const today = new Date().toISOString().split('T')[0];
    let todayAddedSql = "SELECT COUNT(*) as count FROM tasks WHERE date(created_at) = ?";
    let todayCompletedSql = "SELECT COUNT(*) as count FROM tasks WHERE status = 'completed' AND date(updated_at) = ?";
    let todayProcessedSql = "SELECT COUNT(*) as count FROM task_comments WHERE date(created_at) = ?";
    
    const todayParams = [today];
    if (repo) {
      todayAddedSql += " AND repo = ?";
      todayCompletedSql += " AND repo = ?";
      todayProcessedSql += " AND repo = ?";
      todayParams.push(repo);
    }

    const todayAdded = (this.db.prepare(todayAddedSql).get(...todayParams) as any)?.count || 0;
    const todayCompleted = (this.db.prepare(todayCompletedSql).get(...todayParams) as any)?.count || 0;
    const todayProcessed = (this.db.prepare(todayProcessedSql).get(...todayParams) as any)?.count || 0;

    let todayTokensSql = "SELECT SUM(est_tokens) as total FROM tasks WHERE date(updated_at) = ?";
    if (repo) {
      todayTokensSql += " AND repo = ?";
    }
    const todayTokens = (this.db.prepare(todayTokensSql).get(...todayParams) as any)?.total || 0;

    let avgDurationSql = `
      SELECT AVG(
        (julianday(finished_at) - julianday(in_progress_at)) * 86400.0
      ) as avg_seconds 
      FROM tasks 
      WHERE status = 'completed' 
      AND in_progress_at IS NOT NULL 
      AND finished_at IS NOT NULL
      AND date(finished_at) = ?
    `;
    if (repo) {
      avgDurationSql += " AND repo = ?";
    }
    const avgDurationSeconds = (this.db.prepare(avgDurationSql).get(...todayParams) as any)?.avg_seconds || 0;

    return {
      ...memoryStats,
      avgImportance: avgImportance.toFixed(1),
      totalHitCount,
      expiringSoon,
      todayAdded,
      todayCompleted,
      todayProcessed,
      todayTokens,
      todayAvgDuration: avgDurationSeconds,
      taskStats
    };
  }

  listRepoNavigation(): Array<{ repo: string; memory_count: number; last_updated_at: string | null; pending_count: number; in_progress_count: number; blocked_count: number }> {
    return this.db.prepare(`
      SELECT
        m.repo,
        COUNT(m.id) AS memory_count,
        MAX(COALESCE(m.updated_at, m.created_at)) AS last_updated_at,
        COALESCE(t.pending_count, 0) AS pending_count,
        COALESCE(t.in_progress_count, 0) AS in_progress_count,
        COALESCE(t.blocked_count, 0) AS blocked_count,
        COALESCE(t.backlog_count, 0) AS backlog_count
      FROM memories m
      LEFT JOIN (
        SELECT repo,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
          SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_count,
          SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) AS blocked_count,
          SUM(CASE WHEN status = 'backlog' THEN 1 ELSE 0 END) AS backlog_count
        FROM tasks
        GROUP BY repo
      ) t ON t.repo = m.repo
      GROUP BY m.repo
      ORDER BY last_updated_at DESC, m.repo ASC
    `).all() as any[];
  }

  getAllMemoriesWithStats(repo?: string): any[] {
    let sql = `SELECT *, CASE WHEN hit_count > 0 THEN CAST(recall_count AS REAL) / hit_count ELSE 0 END AS recall_rate FROM memories`;
    if (repo) return this.db.prepare(sql + " WHERE repo = ?").all(repo);
    return this.db.prepare(sql).all();
  }

  getLastActionId(): number {
    const row = this.db.prepare("SELECT MAX(id) as id FROM action_log").get() as any;
    return row?.id || 0;
  }

  getActionsAfter(id: number): any[] {
    return this.db.prepare(`
      SELECT a.*, m.title as memory_title, m.type as memory_type 
      FROM action_log a LEFT JOIN memories m ON a.memory_id = m.id 
      WHERE a.id > ? ORDER BY a.created_at ASC
    `).all(id);
  }

  getActionStatsByDate(repo?: string, days: number = 30): any[] {
    let sql = `
      SELECT 
        strftime('%Y-%m-%d', created_at) as date,
        action,
        COUNT(*) as count
      FROM action_log
      WHERE created_at >= date('now', '-' || ? || ' days')
    `;
    const params: any[] = [days];
    if (repo) {
      sql += " AND repo = ?";
      params.push(repo);
    }
    sql += " GROUP BY date, action ORDER BY date ASC";
    return this.db.prepare(sql).all(...params);
  }

  listMemoriesForDashboard(options: any): any {
    const { repo, type, tag, isGlobal, minImportance, search, offset = 0, limit = 50, sortBy = 'created_at', sortOrder = 'DESC' } = options;
    let where = ["1=1"];
    const params: any[] = [];

    if (repo) { where.push("repo = ?"); params.push(repo); }
    if (type) { where.push("type = ?"); params.push(type); }
    if (tag) { where.push("tags LIKE ?"); params.push(`%${tag}%`); }
    if (isGlobal !== undefined) { where.push("is_global = ?"); params.push(isGlobal ? 1 : 0); }
    if (minImportance) { where.push("importance >= ?"); params.push(minImportance); }
    if (search) { 
      where.push("(title LIKE ? OR content LIKE ? OR tags LIKE ?)"); 
      params.push(`%${search}%`, `%${search}%`, `%${search}%`); 
    }

    const countStmt = this.db.prepare(`SELECT COUNT(*) as count FROM memories WHERE ${where.join(" AND ")}`);
    const total = (countStmt.get(...params) as any).count;

    let orderBy = "";
    if (sortBy && sortOrder) {
      orderBy = `ORDER BY ${sortBy} ${sortOrder}`;
    } else {
      orderBy = `ORDER BY importance DESC, created_at ASC`;
    }

    const dataStmt = this.db.prepare(`
      SELECT *, CASE WHEN hit_count > 0 THEN CAST(recall_count AS REAL) / hit_count ELSE 0 END AS recall_rate
      FROM memories WHERE ${where.join(" AND ")}
      ${orderBy} LIMIT ? OFFSET ?
    `);
    const rows = dataStmt.all(...params, limit, offset) as any[];
    const items = rows.map(row => ({
      ...this.rowToMemoryEntry(row),
      recall_rate: row.recall_rate ?? 0
    }));

    return { items, memories: items, total, limit, offset };
  }

  getSummary(repo: string): any {
    return this.db.prepare("SELECT summary, updated_at FROM memory_summary WHERE repo = ?").get(repo);
  }

  upsertSummary(repo: string, summary: string): void {
    this.db.prepare(`
      INSERT INTO memory_summary (repo, summary, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(repo) DO UPDATE SET summary = excluded.summary, updated_at = excluded.updated_at
    `).run(repo, summary, new Date().toISOString());
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM memories WHERE id = ?").run(id);
  }

  bulkInsertMemories(entries: MemoryEntry[]): number {
    const insert = this.db.prepare(`
      INSERT INTO memories (
        id, repo, type, title, content, importance, folder, language,
        created_at, updated_at, hit_count, recall_count, last_used_at, expires_at,
        supersedes, status, is_global, tags, metadata, agent, role, model, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((entries: MemoryEntry[]) => {
      let count = 0;
      for (const entry of entries) {
        insert.run(
          entry.id,
          entry.scope.repo,
          entry.type,
          entry.title || null,
          entry.content,
          entry.importance,
          entry.scope.folder || null,
          entry.scope.language || null,
          entry.created_at,
          entry.updated_at,
          entry.expires_at ?? null,
          entry.supersedes ?? null,
          entry.status || "active",
          entry.is_global ? 1 : 0,
          entry.tags ? JSON.stringify(entry.tags) : null,
          entry.metadata ? JSON.stringify(entry.metadata) : null,
          entry.agent || 'unknown',
          entry.role || 'unknown',
          entry.model || 'unknown',
          entry.completed_at || null
        );
        count++;
      }
      return count;
    });

    return insertMany(entries);
  }

  bulkInsertTasks(tasks: any[]): number {
    const insert = this.db.prepare(`
      INSERT INTO tasks (
        id, repo, task_code, phase, title, description, status, priority,
        agent, role, doc_path, created_at, updated_at, finished_at, canceled_at, tags, metadata, parent_id, depends_on, est_tokens, in_progress_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((tasks: any[]) => {
      let count = 0;
      for (const task of tasks) {
        insert.run(
          task.id,
          task.repo,
          task.task_code,
          task.phase || null,
          task.title,
          task.description || null,
          task.status || "backlog",
          task.priority || 3,
          task.agent || 'unknown',
          task.role || 'unknown',
          task.doc_path || null,
          task.created_at,
          task.updated_at,
          task.finished_at || null,
          task.canceled_at || null,
          task.tags ? JSON.stringify(task.tags) : null,
          task.metadata ? JSON.stringify(task.metadata) : null,
          task.parent_id || null,
          task.depends_on || null,
          task.est_tokens || 0,
          task.in_progress_at || null
        );
        count++;
      }
      return count;
    });

    return insertMany(tasks);
  }

  bulkUpdateMemories(ids: string[], updates: any): number {
    if (ids.length === 0) return 0;
    
    const fields: string[] = [];
    const values: unknown[] = [];

    Object.keys(updates).forEach(key => {
      if (updates[key] !== undefined) {
        if (key === 'tags' || key === 'metadata') {
          fields.push(`${key} = ?`);
          values.push(JSON.stringify(updates[key]));
        } else if (key === 'is_global') {
          fields.push(`${key} = ?`);
          values.push(updates[key] ? 1 : 0);
        } else {
          fields.push(`${key} = ?`);
          values.push(updates[key]);
        }
      }
    });

    if (fields.length === 0) return 0;

    fields.push("updated_at = ?");
    values.push(new Date().toISOString());

    const updateMany = this.db.transaction((ids: string[], fields: string[], values: unknown[]) => {
      let count = 0;
      const chunkSize = 500;
      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        const stmt = this.db.prepare(`UPDATE memories SET ${fields.join(", ")} WHERE id IN (${chunk.map(() => '?').join(',')})`);
        const result = stmt.run(...values, ...chunk);
        count += result.changes;
      }
      return count;
    });

    return updateMany(ids, fields, values);
  }

  bulkDeleteMemories(ids: string[]): number {
    if (ids.length === 0) return 0;
    
    const deleteMany = this.db.transaction((ids: string[]) => {
      let count = 0;
      const chunkSize = 500;
      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        const stmt = this.db.prepare(`DELETE FROM memories WHERE id IN (${chunk.map(() => '?').join(',')})`);
        const result = stmt.run(...chunk);
        count += result.changes;
      }
      return count;
    });

    return deleteMany(ids);
  }

  listRepos(): string[] {
    return (this.db.prepare("SELECT DISTINCT repo FROM memories ORDER BY repo").all() as any[]).map(r => r.repo);
  }

  incrementHitCount(id: string): void {
    this.db.prepare("UPDATE memories SET hit_count = hit_count + 1, last_used_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  }

  incrementHitCounts(ids: string[]): void {
    if (!ids || ids.length === 0) return;
    const stmt = this.db.prepare("UPDATE memories SET hit_count = hit_count + 1, last_used_at = ? WHERE id = ?");
    const now = new Date().toISOString();
    const transaction = this.db.transaction((idsToUpdate: string[]) => {
      for (const id of idsToUpdate) {
        stmt.run(now, id);
      }
    });
    transaction(ids);
  }

  incrementRecallCount(id: string): void {
    this.db.prepare("UPDATE memories SET recall_count = recall_count + 1, last_used_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  }

  insertTask(task: any): void {
    const stmt = this.db.prepare(`
      INSERT INTO tasks (
        id, repo, task_code, phase, title, description, status, priority,
        agent, role, doc_path, created_at, updated_at, finished_at, canceled_at, tags, metadata, parent_id, depends_on, est_tokens, in_progress_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      task.id,
      task.repo,
      task.task_code,
      task.phase || null,
      task.title,
      task.description || null,
      task.status || "backlog",
      task.priority || 3,
      task.agent || 'unknown',
      task.role || 'unknown',
      task.doc_path || null,
      task.created_at,
      task.updated_at,
      task.finished_at || null,
      task.canceled_at || null,
      task.tags ? JSON.stringify(task.tags) : null,
      task.metadata ? JSON.stringify(task.metadata) : null,
      task.parent_id || null,
      task.depends_on || null,
      task.est_tokens || 0,
      task.in_progress_at || null
    );
  }

  updateTask(id: string, updates: any): void {
    const fields: string[] = [];
    const values: unknown[] = [];

    Object.keys(updates).forEach(key => {
      if (key !== "comment" && key !== "model" && updates[key] !== undefined) {
        if (key === 'tags' || key === 'metadata') {
          fields.push(`${key} = ?`);
          values.push(JSON.stringify(updates[key]));
        } else {
          fields.push(`${key} = ?`);
          values.push(updates[key]);
        }
      }
    });

    if (fields.length === 0) return;

    fields.push("updated_at = ?");
    values.push(new Date().toISOString());
    values.push(id);

    const stmt = this.db.prepare(`UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`);
    stmt.run(...values);
  }

  getTasksByRepo(repo: string, status?: string, limit?: number, offset?: number, search?: string): any[] {
    let query = `
      SELECT t.*, d.task_code as depends_on_code 
      FROM tasks t 
      LEFT JOIN tasks d ON t.depends_on = d.id 
      WHERE t.repo = ?
    `;
    const params: any[] = [repo];

    if (status) {
      query += " AND t.status = ?";
      params.push(status);
    }

    if (search) {
      query += " AND (t.title LIKE ? OR t.description LIKE ? OR t.task_code LIKE ?)";
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }

    // Default sorting logic for the unified list:
    // 1. Completed tasks at the bottom (or top if specified)
    // 2. Priority for others
    // 3. Updated date (newest first for completed)
    query += ` ORDER BY 
      CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END ASC,
      CASE WHEN t.status = 'completed' THEN t.updated_at ELSE NULL END DESC,
      CASE WHEN t.status = 'in_progress' THEN 0
           WHEN t.status = 'pending' THEN 1
           WHEN t.status = 'backlog' THEN 2
           WHEN t.status = 'blocked' THEN 3
           WHEN t.status = 'canceled' THEN 4
           ELSE 5 END ASC,
      t.priority DESC, 
      t.created_at ASC`;
    
    if (limit !== undefined) {
      query += " LIMIT ?";
      params.push(limit);
      if (offset !== undefined) {
        query += " OFFSET ?";
        params.push(offset);
      }
    }
    
    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map(r => this.rowToTask(r));
  }

  getTasksByMultipleStatuses(repo: string, statuses: string[], limit?: number, offset?: number, search?: string): any[] {
    if (!statuses.length) return this.getTasksByRepo(repo, undefined, limit, offset, search);
    
    let query = `
      SELECT t.*, d.task_code as depends_on_code 
      FROM tasks t 
      LEFT JOIN tasks d ON t.depends_on = d.id 
      WHERE t.repo = ? AND t.status IN (${statuses.map(() => '?').join(',')})
    `;
    const params: any[] = [repo, ...statuses];

    if (search) {
      query += " AND (t.title LIKE ? OR t.description LIKE ? OR t.task_code LIKE ?)";
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }

    query += ` ORDER BY 
      CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END ASC,
      CASE WHEN t.status = 'completed' THEN t.updated_at ELSE NULL END DESC,
      CASE WHEN t.status = 'in_progress' THEN 0
           WHEN t.status = 'pending' THEN 1
           WHEN t.status = 'backlog' THEN 2
           WHEN t.status = 'blocked' THEN 3
           WHEN t.status = 'canceled' THEN 4
           ELSE 5 END ASC,
      t.priority DESC, 
      t.created_at ASC`;
    
    if (limit !== undefined) {
      query += " LIMIT ?";
      params.push(limit);
      if (offset !== undefined) {
        query += " OFFSET ?";
        params.push(offset);
      }
    }
    
    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map(r => this.rowToTask(r));
  }

  deleteTask(id: string): void {
    this.db.prepare("DELETE FROM task_comments WHERE task_id = ?").run(id);
    this.db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
  }

  getTaskById(id: string): any | null {
    const row = this.db.prepare(`
      SELECT t.*, d.task_code as depends_on_code 
      FROM tasks t 
      LEFT JOIN tasks d ON t.depends_on = d.id 
      WHERE t.id = ?
    `).get(id) as any;
    return row ? { ...this.rowToTask(row), comments: this.getTaskCommentsByTaskId(id) } : null;
  }

  isTaskCodeDuplicate(repo: string, task_code: string, excludeId?: string): boolean {
    let query = "SELECT COUNT(*) as count FROM tasks WHERE repo = ? AND task_code = ?";
    const params = [repo, task_code];
    
    if (excludeId) {
      query += " AND id != ?";
      params.push(excludeId);
    }
    
    const row = this.db.prepare(query).get(...params) as any;
    return row.count > 0;
  }

  private rowToTask(row: any): any {
    let tags: string[] = [];
    let metadata: any = {};
    try {
      if (row.tags) tags = JSON.parse(row.tags);
      if (row.metadata) metadata = JSON.parse(row.metadata);
    } catch (e) {}

    return {
      ...row,
      agent: row.agent || 'unknown',
      role: row.role || 'unknown',
      doc_path: row.doc_path || null,
      tags,
      metadata,
      est_tokens: row.est_tokens || 0,
      in_progress_at: row.in_progress_at || null
    };
  }

  insertTaskComment(comment: any): void {
    this.db.prepare(`
      INSERT INTO task_comments (
        id, task_id, repo, comment, agent, role, model, previous_status, next_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      comment.id,
      comment.task_id,
      comment.repo,
      comment.comment,
      comment.agent || "unknown",
      comment.role || "unknown",
      comment.model || "unknown",
      comment.previous_status || null,
      comment.next_status || null,
      comment.created_at
    );
  }

  getTaskCommentsByTaskId(taskId: string): any[] {
    return this.db.prepare(`
      SELECT * FROM task_comments
      WHERE task_id = ?
      ORDER BY created_at DESC, id DESC
    `).all(taskId) as any[];
  }

  getAllTaskCommentsByRepo(repo: string): any[] {
    return this.db.prepare(`
      SELECT * FROM task_comments
      WHERE repo = ?
      ORDER BY created_at DESC, id DESC
    `).all(repo) as any[];
  }


  getRecentMemories(repo: string, limit: number, offset: number = 0, includeArchived: boolean = false, excludeTypes: string[] = []): MemoryEntry[] {
    let query = "SELECT * FROM memories WHERE repo = ?";
    const params: any[] = [repo];

    if (!includeArchived) {
      query += " AND status = 'active'";
    }
    
    if (excludeTypes.length > 0) {
      query += ` AND type NOT IN (${excludeTypes.map(() => '?').join(',')})`;
      params.push(...excludeTypes);
    }
    
    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);
    
    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];
    return rows.map((row) => this.rowToMemoryEntry(row));
  }

  getTotalCount(repo: string, includeArchived = false, excludeTypes: string[] = []): number {
    let sql = "SELECT COUNT(*) as count FROM memories WHERE repo = ?";
    const params: any[] = [repo];

    if (!includeArchived) sql += " AND status = 'active'";

    if (excludeTypes.length > 0) {
      sql += ` AND type NOT IN (${excludeTypes.map(() => '?').join(',')})`;
      params.push(...excludeTypes);
    }

    return (this.db.prepare(sql).get(...params) as any).count;
  }

  getVectorCandidates(repo?: string, limit = 100): any[] {
    let sql = `SELECT mv.memory_id, mv.vector FROM memory_vectors mv JOIN memories m ON mv.memory_id = m.id`;
    const params: any[] = [];
    if (repo) { sql += " WHERE m.repo = ?"; params.push(repo); }
    sql += " LIMIT ?"; params.push(limit);
    return this.db.prepare(sql).all(...params) as any[];
  }

  upsertVectorEmbedding(memoryId: string, vector: any[]): void {
    this.db.prepare(`
      INSERT INTO memory_vectors (memory_id, vector, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(memory_id) DO UPDATE SET vector = excluded.vector, updated_at = excluded.updated_at
    `).run(memoryId, JSON.stringify(vector), new Date().toISOString());
  }

  async checkConflicts(content: string, repo: string, type: string, vectors: any, threshold = 0.55): Promise<any> {
    const vectorResults = await vectors.search(content, 10, repo);
    const candidateIds = vectorResults
      .filter((vr: any) => vr.score > threshold)
      .map((vr: any) => vr.id);

    if (candidateIds.length === 0) return null;

    const memories = this.getByIds(candidateIds, { type, status: "active" });
    const memoryMap = new Map(memories.map(m => [m.id, m]));

    // Iterate through original vector results to maintain score priority
    for (const vr of vectorResults) {
      if (vr.score > threshold) {
        const memory = memoryMap.get(vr.id);
        if (memory) return memory;
      }
    }
    return null;
  }

  logAction(action: string, repo: string, options: any = {}) {
    this.db.prepare(`INSERT INTO action_log (action, query, response, memory_id, task_id, repo, result_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      action, 
      options.query || null, 
      options.response ? (typeof options.response === 'string' ? options.response : JSON.stringify(options.response)) : null,
      options.memoryId || null, 
      options.taskId || null, 
      repo, 
      options.resultCount || 0, 
      new Date().toISOString()
    );
  }

  getRecentActions(repo?: string, limit = 20): any[] {
    let sql = `
      SELECT 
        a.*, 
        m.title as memory_title, 
        m.type as memory_type,
        t.title as task_title,
        t.task_code as task_code
      FROM action_log a 
      LEFT JOIN memories m ON a.memory_id = m.id
      LEFT JOIN tasks t ON a.task_id = t.id
    `;
    const params: any[] = [];
    if (repo) { sql += ` WHERE a.repo = ?`; params.push(repo); }
    sql += ` ORDER BY a.created_at DESC, a.id DESC LIMIT ?`; params.push(limit);
    return this.db.prepare(sql).all(...params);
  }

  private computeVector(text: string): Record<string, number> {
    const tokens = tokenize(text);
    const vector: Record<string, number> = {};
    for (const token of tokens) vector[token] = (vector[token] || 0) + 1;
    return vector;
  }

  private cosineSimilarity(v1: Record<string, number>, v2: Record<string, number>): number {
    const keys1 = Object.keys(v1);
    if (!keys1.length || !Object.keys(v2).length) return 0;
    let dotProduct = 0;
    for (const key of keys1) if (v2[key]) dotProduct += v1[key] * v2[key];
    const mag1 = Math.sqrt(keys1.reduce((sum, k) => sum + v1[k] * v1[k], 0));
    const mag2 = Math.sqrt(Object.keys(v2).reduce((sum, k) => sum + v2[k] * v2[k], 0));
    return (mag1 && mag2) ? dotProduct / (mag1 * mag2) : 0;
  }

  private rowToMemoryEntry(row: any): MemoryEntry {
    let tags: string[] = [];
    let metadata: Record<string, any> = {};
    try {
      if (row.tags) tags = JSON.parse(row.tags);
      if (row.metadata) metadata = JSON.parse(row.metadata);
    } catch (e) {}

    return {
      id: row.id, type: row.type, title: row.title || "Untitled", content: row.content, importance: row.importance,
      agent: row.agent || 'unknown',
      role: row.role || 'unknown',
      model: row.model || 'unknown',
      scope: { repo: row.repo, folder: row.folder || undefined, language: row.language || undefined },
      created_at: row.created_at, updated_at: row.updated_at, 
      completed_at: row.completed_at || null,
      hit_count: row.hit_count ?? 0, recall_count: row.recall_count ?? 0,
      last_used_at: row.last_used_at ?? null, expires_at: row.expires_at ?? null, supersedes: row.supersedes ?? null, status: row.status || "active",
      is_global: row.is_global === 1, tags, metadata
    };
  }

  getTaskTimeStats(repo: string, period: 'daily' | 'weekly' | 'monthly' | 'overall'): any {
    let dateFilter = "";
    if (period === 'daily') dateFilter = "AND date(COALESCE(finished_at, updated_at)) = date('now')";
    else if (period === 'weekly') dateFilter = "AND date(COALESCE(finished_at, updated_at)) >= date('now', '-7 days')";
    else if (period === 'monthly') dateFilter = "AND date(COALESCE(finished_at, updated_at)) >= date('now', '-30 days')";
    
    const stats = this.db.prepare(`
      SELECT 
        COUNT(*) as completed_count,
        SUM(est_tokens) as total_tokens,
        AVG(
          CASE 
            WHEN in_progress_at IS NOT NULL AND finished_at IS NOT NULL 
            THEN (julianday(finished_at) - julianday(in_progress_at)) * 86400.0 
            ELSE NULL 
          END
        ) as avg_duration_seconds
      FROM tasks 
      WHERE repo = ? 
      AND status = 'completed' 
      ${dateFilter}
    `).get(repo) as any;

    let addedDateFilter = "";
    if (period === 'daily') addedDateFilter = "AND date(created_at) = date('now')";
    else if (period === 'weekly') addedDateFilter = "AND date(created_at) >= date('now', '-7 days')";
    else if (period === 'monthly') addedDateFilter = "AND date(created_at) >= date('now', '-30 days')";

    const added = this.db.prepare(`
      SELECT COUNT(*) as count FROM tasks 
      WHERE repo = ? 
      ${addedDateFilter}
    `).get(repo) as any;

    return {
      completed: stats?.completed_count || 0,
      tokens: stats?.total_tokens || 0,
      avgDuration: stats?.avg_duration_seconds || 0,
      added: added?.count || 0
    };
  }

  getTaskComparisonSeries(repo: string, period: 'daily' | 'weekly' | 'monthly' | 'overall'): any[] {
    let labelFormat = "";
    let dateFilter = "";

    if (period === 'daily') {
      labelFormat = "%H:00";
      dateFilter = "date(COALESCE(finished_at, created_at)) = date('now')";
    } else if (period === 'weekly') {
      labelFormat = "%Y-%m-%d";
      dateFilter = "date(COALESCE(finished_at, created_at)) >= date('now', '-6 days')";
    } else if (period === 'monthly') {
      labelFormat = "W%W";
      dateFilter = "date(COALESCE(finished_at, created_at)) >= date('now', '-30 days')";
    } else {
      labelFormat = "%Y-%m";
      dateFilter = "1=1";
    }

    const query = `
      SELECT label, SUM(created) as created, SUM(completed) as completed
      FROM (
        SELECT strftime(?, created_at) as label, 1 as created, 0 as completed 
        FROM tasks 
        WHERE repo = ? AND ${dateFilter.replace("COALESCE(finished_at, created_at)", "created_at")}
        UNION ALL
        SELECT strftime(?, COALESCE(finished_at, updated_at)) as label, 0 as created, 1 as completed 
        FROM tasks 
        WHERE repo = ? AND status = 'completed' AND ${dateFilter.replace("COALESCE(finished_at, created_at)", "COALESCE(finished_at, updated_at)")}
      )
      GROUP BY label
      ORDER BY label ASC
      LIMIT 100
    `;

    return this.db.prepare(query).all(labelFormat, repo, labelFormat, repo) as any[];
  }

  updateTaskComment(id: string, updates: any): void {
    const fields: string[] = [];
    const values: unknown[] = [];

    Object.keys(updates).forEach(key => {
      if (updates[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(updates[key]);
      }
    });

    if (fields.length === 0) return;

    values.push(id);

    const stmt = this.db.prepare(`UPDATE task_comments SET ${fields.join(", ")} WHERE id = ?`);
    stmt.run(...values);
  }

  deleteTaskComment(id: string): void {
    this.db.prepare("DELETE FROM task_comments WHERE id = ?").run(id);
  }

  getTaskCommentById(id: string): any | null {
    return this.db.prepare("SELECT * FROM task_comments WHERE id = ?").get(id);
  }

  close(): void { this.db.close(); }
}
