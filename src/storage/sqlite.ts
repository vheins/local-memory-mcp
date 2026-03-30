import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import { MemoryEntry, MemoryScope } from "../types.js";
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

  // Define platform-specific standard paths
  let standardConfigDir: string;
  if (process.platform === "win32") {
    // Windows: Use %USERPROFILE%\.local-memory-mcp (common for CLI tools)
    standardConfigDir = path.join(os.homedir(), ".local-memory-mcp");
  } else if (process.platform === "darwin") {
    // macOS: Use ~/Library/Application Support/local-memory-mcp
    standardConfigDir = path.join(os.homedir(), "Library", "Application Support", "local-memory-mcp");
  } else {
    // Linux/Others: Use ~/.config/local-memory-mcp
    standardConfigDir = path.join(os.homedir(), ".config", "local-memory-mcp");
  }

  const standardPath = path.join(standardConfigDir, "memory.db");

  // Priority 1: Check if the standard path already exists
  if (fs.existsSync(standardPath)) {
    return standardPath;
  }

  // Priority 2: Check legacy ~/.config/local-memory-mcp/memory.db (for cross-platform compatibility with older versions)
  const legacyHomeConfig = path.join(os.homedir(), ".config", "local-memory-mcp", "memory.db");
  if (fs.existsSync(legacyHomeConfig)) {
    return legacyHomeConfig;
  }

  // Priority 3: Check local storage/ folder in CWD (useful for development)
  const cwdStorage = path.join(process.cwd(), "storage");
  if (fs.existsSync(cwdStorage) && fs.existsSync(path.join(cwdStorage, "memory.db"))) {
    return path.join(cwdStorage, "memory.db");
  }

  // Priority 4: Check project root storage/ folder (useful for repo-local usage)
  const projectRootStorage = path.join(__dirname, "../../storage");
  if (fs.existsSync(projectRootStorage) && fs.existsSync(path.join(projectRootStorage, "memory.db"))) {
     return path.join(projectRootStorage, "memory.db");
  }

  // Default: Return the standard platform-specific path (it will be created by the constructor)
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
    // Create base tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        repo TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN (
          'code_fact',
          'decision',
          'mistake',
          'pattern'
        )),
        title TEXT,
        content TEXT NOT NULL,
        importance INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 5),
        folder TEXT,
        language TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        hit_count INTEGER NOT NULL DEFAULT 0,
        recall_count INTEGER NOT NULL DEFAULT 0,
        last_used_at TEXT
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
    `);

    // Add title column if it doesn't exist (for existing databases)
    try {
      this.db.exec(`ALTER TABLE memories ADD COLUMN title TEXT`);
    } catch (e) {}

    this.db.exec(`
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
        archived_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS action_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL CHECK (action IN ('search', 'read', 'write', 'update', 'delete')),
        query TEXT,
        memory_id TEXT,
        repo TEXT NOT NULL,
        result_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_action_log_repo ON action_log(repo);
      CREATE INDEX IF NOT EXISTS idx_action_log_created_at ON action_log(created_at);
    `);

    // Add missing columns safely
    const existingColumns = (
      this.db.prepare("PRAGMA table_info(memories)").all() as Array<{ name: string }>
    ).map((col) => col.name);

    const columnsToAdd: Array<{ name: string; table: string; definition: string }> = [
      { name: "hit_count", table: "memories", definition: "ALTER TABLE memories ADD COLUMN hit_count INTEGER NOT NULL DEFAULT 0" },
      { name: "recall_count", table: "memories", definition: "ALTER TABLE memories ADD COLUMN recall_count INTEGER NOT NULL DEFAULT 0" },
      { name: "last_used_at", table: "memories", definition: "ALTER TABLE memories ADD COLUMN last_used_at TEXT" },
      { name: "expires_at", table: "memories", definition: "ALTER TABLE memories ADD COLUMN expires_at TEXT" },
      { name: "supersedes", table: "memories", definition: "ALTER TABLE memories ADD COLUMN supersedes TEXT" },
      { name: "status", table: "memories", definition: "ALTER TABLE memories ADD COLUMN status TEXT NOT NULL DEFAULT 'active'" },
      { name: "is_global", table: "memories", definition: "ALTER TABLE memories ADD COLUMN is_global INTEGER NOT NULL DEFAULT 0" },
      { name: "tags", table: "memories", definition: "ALTER TABLE memories ADD COLUMN tags TEXT" },
      { name: "vector_version", table: "memory_vectors", definition: "ALTER TABLE memory_vectors ADD COLUMN vector_version INTEGER NOT NULL DEFAULT 1" },
    ];

    for (const col of columnsToAdd) {
      const existingTableColumns = (
        this.db.prepare(`PRAGMA table_info(${col.table})`).all() as Array<{ name: string }>
      ).map((c) => c.name);

      if (!existingTableColumns.includes(col.name)) {
        this.db.exec(col.definition);
      }
    }

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);
      CREATE INDEX IF NOT EXISTS idx_memories_supersedes ON memories(supersedes);
      CREATE INDEX IF NOT EXISTS idx_memories_is_global ON memories(is_global);
    `);
  }

  insert(entry: MemoryEntry): void {
    const stmt = this.db.prepare(`
      INSERT INTO memories (
        id, repo, type, title, content, importance, folder, language,
        created_at, updated_at, hit_count, recall_count, last_used_at, expires_at,
        supersedes, status, is_global, tags
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, ?, ?, ?, ?, ?)
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
      entry.tags ? JSON.stringify(entry.tags) : null
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

  listRepoNavigation(): Array<{ repo: string; memory_count: number; last_updated_at: string | null }> {
    return this.db.prepare(`
      SELECT repo, COUNT(*) AS memory_count, MAX(COALESCE(updated_at, created_at)) AS last_updated_at
      FROM memories GROUP BY repo ORDER BY last_updated_at DESC, repo ASC
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

    const dataStmt = this.db.prepare(`
      SELECT *, CASE WHEN hit_count > 0 THEN CAST(recall_count AS REAL) / hit_count ELSE 0 END AS recall_rate
      FROM memories WHERE ${where.join(" AND ")}
      ORDER BY ${sortBy} ${sortOrder} LIMIT ? OFFSET ?
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

  listRepos(): string[] {
    return (this.db.prepare("SELECT DISTINCT repo FROM memories ORDER BY repo").all() as any[]).map(r => r.repo);
  }

  incrementHitCount(id: string): void {
    this.db.prepare("UPDATE memories SET hit_count = hit_count + 1, last_used_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  }

  incrementRecallCount(id: string): void {
    this.db.prepare("UPDATE memories SET recall_count = recall_count + 1, last_used_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  }

  getRecentMemories(repo: string, limit: number, offset: number = 0, includeArchived: boolean = false): MemoryEntry[] {
    let query = "SELECT * FROM memories WHERE repo = ?";
    if (!includeArchived) {
      query += " AND status = 'active'";
    }
    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    
    const stmt = this.db.prepare(query);
    const rows = stmt.all(repo, limit, offset) as any[];
    return rows.map((row) => this.rowToMemoryEntry(row));
  }

  getTotalCount(repo: string, includeArchived = false): number {
    let sql = "SELECT COUNT(*) as count FROM memories WHERE repo = ?";
    if (!includeArchived) sql += " AND status = 'active'";
    return (this.db.prepare(sql).get(repo) as any).count;
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
    for (const vr of vectorResults) {
      if (vr.score > threshold) {
        const memory = this.getById(vr.id);
        if (memory && memory.type === type && memory.status === 'active') return memory;
      }
    }
    return null;
  }

  logAction(action: string, repo: string, options: any = {}) {
    this.db.prepare(`INSERT INTO action_log (action, query, memory_id, repo, result_count, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
      action, options.query || null, options.memoryId || null, repo, options.resultCount || 0, new Date().toISOString()
    );
  }

  getRecentActions(repo?: string, limit = 20): any[] {
    let sql = `SELECT a.*, m.title as memory_title, m.type as memory_type FROM action_log a LEFT JOIN memories m ON a.memory_id = m.id`;
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
    try {
      if (row.tags) tags = JSON.parse(row.tags);
    } catch (e) {}

    return {
      id: row.id, type: row.type, title: row.title || "Untitled", content: row.content, importance: row.importance,
      scope: { repo: row.repo, folder: row.folder || undefined, language: row.language || undefined },
      created_at: row.created_at, updated_at: row.updated_at, hit_count: row.hit_count ?? 0, recall_count: row.recall_count ?? 0,
      last_used_at: row.last_used_at ?? null, expires_at: row.expires_at ?? null, supersedes: row.supersedes ?? null, status: row.status || "active",
      is_global: row.is_global === 1, tags
    };
  }

  close(): void { this.db.close(); }
}
