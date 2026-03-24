import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { MemoryEntry, MemoryScope } from "../types.js";
import { tokenize } from "../utils/normalize.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "../../storage/memory.db");

export class SQLiteStore {
  private db: Database.Database;

  constructor(dbPath?: string) {
    this.db = new Database(dbPath ?? DB_PATH);
    this.migrate();
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
    `);

    // Sub-task 2.1: Use PRAGMA table_info to safely add columns
    const existingColumns = (
      this.db.prepare("PRAGMA table_info(memories)").all() as Array<{ name: string }>
    ).map((col) => col.name);

    const columnsToAdd: Array<{ name: string; definition: string }> = [
      { name: "hit_count", definition: "ALTER TABLE memories ADD COLUMN hit_count INTEGER NOT NULL DEFAULT 0" },
      { name: "recall_count", definition: "ALTER TABLE memories ADD COLUMN recall_count INTEGER NOT NULL DEFAULT 0" },
      { name: "last_used_at", definition: "ALTER TABLE memories ADD COLUMN last_used_at TEXT" },
      { name: "expires_at", definition: "ALTER TABLE memories ADD COLUMN expires_at TEXT" },
    ];

    for (const col of columnsToAdd) {
      if (!existingColumns.includes(col.name)) {
        this.db.exec(col.definition);
      }
    }
  }

  insert(entry: MemoryEntry): void {
    const stmt = this.db.prepare(`
      INSERT INTO memories (
        id, repo, type, content, importance, folder, language,
        created_at, updated_at, hit_count, recall_count, last_used_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, ?)
    `);

    stmt.run(
      entry.id,
      entry.scope.repo,
      entry.type,
      entry.content,
      entry.importance,
      entry.scope.folder || null,
      entry.scope.language || null,
      entry.created_at,
      entry.updated_at,
      entry.expires_at ?? null
    );
  }

  update(id: string, updates: { content?: string; importance?: number }): void {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.content !== undefined) {
      fields.push("content = ?");
      values.push(updates.content);
    }

    if (updates.importance !== undefined) {
      fields.push("importance = ?");
      values.push(updates.importance);
    }

    fields.push("updated_at = ?");
    values.push(new Date().toISOString());

    values.push(id);

    const stmt = this.db.prepare(`
      UPDATE memories
      SET ${fields.join(", ")}
      WHERE id = ?
    `);

    stmt.run(...values);
  }

  // Sub-task 2.4: Exclude expired memories from searchByRepo
  searchByRepo(
    repo: string,
    options: {
      types?: string[];
      minImportance?: number;
      limit?: number;
    } = {}
  ): MemoryEntry[] {
    let query = `SELECT * FROM memories WHERE repo = ?
      AND (expires_at IS NULL OR expires_at > datetime('now'))`;
    const params: unknown[] = [repo];

    if (options.types && options.types.length > 0) {
      const placeholders = options.types.map(() => "?").join(", ");
      query += ` AND type IN (${placeholders})`;
      params.push(...options.types);
    }

    if (options.minImportance !== undefined) {
      query += " AND importance >= ?";
      params.push(options.minImportance);
    }

    query += " ORDER BY importance DESC, created_at DESC";

    if (options.limit !== undefined) {
      query += " LIMIT ?";
      params.push(options.limit);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];

    return rows.map((row) => this.rowToMemoryEntry(row));
  }

  getById(id: string): MemoryEntry | null {
    const stmt = this.db.prepare("SELECT * FROM memories WHERE id = ?");
    const row = stmt.get(id) as any;
    if (!row) return null;
    return this.rowToMemoryEntry(row);
  }

  listRecent(limit: number = 10): Array<{ id: string; type: string; repo: string }> {
    const stmt = this.db.prepare(`
      SELECT id, type, repo
      FROM memories
      ORDER BY created_at DESC
      LIMIT ?
    `);
    return stmt.all(limit) as any[];
  }

  getSummary(repo: string): { summary: string; updated_at: string } | null {
    const stmt = this.db.prepare("SELECT summary, updated_at FROM memory_summary WHERE repo = ?");
    return stmt.get(repo) as any;
  }

  upsertSummary(repo: string, summary: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO memory_summary (repo, summary, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(repo) DO UPDATE SET
        summary = excluded.summary,
        updated_at = excluded.updated_at
    `);
    stmt.run(repo, summary, new Date().toISOString());
  }

  delete(id: string): void {
    const stmt = this.db.prepare("DELETE FROM memories WHERE id = ?");
    stmt.run(id);
  }

  // Sub-task 2.5: Renamed from listAllRepos to listRepos
  listRepos(): string[] {
    const stmt = this.db.prepare("SELECT DISTINCT repo FROM memories ORDER BY repo");
    const rows = stmt.all() as any[];
    return rows.map((row) => row.repo);
  }

  incrementHitCount(id: string): void {
    const stmt = this.db.prepare(`
      UPDATE memories
      SET hit_count = hit_count + 1,
          last_used_at = ?
      WHERE id = ?
    `);
    stmt.run(new Date().toISOString(), id);
  }

  incrementRecallCount(id: string): void {
    const stmt = this.db.prepare(`
      UPDATE memories
      SET recall_count = recall_count + 1,
          last_used_at = ?
      WHERE id = ?
    `);
    stmt.run(new Date().toISOString(), id);
  }

  getStats(repo?: string): {
    total: number;
    byType: Record<string, number>;
    unused: number;
  } {
    let query = "SELECT type, COUNT(*) as count FROM memories";
    const params: unknown[] = [];

    if (repo) {
      query += " WHERE repo = ?";
      params.push(repo);
    }

    query += " GROUP BY type";

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];

    const byType: Record<string, number> = {};
    let total = 0;

    for (const row of rows) {
      byType[row.type] = row.count;
      total += row.count;
    }

    let unusedQuery = "SELECT COUNT(*) as count FROM memories WHERE hit_count = 0";
    if (repo) {
      unusedQuery += " AND repo = ?";
    }
    const unusedStmt = this.db.prepare(unusedQuery);
    const unusedRow = (repo ? unusedStmt.get(repo) : unusedStmt.get()) as any;
    const unused = unusedRow?.count || 0;

    return { total, byType, unused };
  }

  // Sub-task 2.2: Public method for Memory_Recap
  getRecentMemories(repo: string, limit: number, offset: number = 0): MemoryEntry[] {
    const stmt = this.db.prepare(`
      SELECT * FROM memories
      WHERE repo = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `);
    const rows = stmt.all(repo, limit, offset) as any[];
    return rows.map((row) => this.rowToMemoryEntry(row));
  }

  // Sub-task 2.2: Public method for total count
  getTotalCount(repo: string): number {
    const stmt = this.db.prepare("SELECT COUNT(*) as count FROM memories WHERE repo = ?");
    const row = stmt.get(repo) as any;
    return row?.count ?? 0;
  }

  // Sub-task 2.3: searchBySimilarity with pre-filter SQL + exclude expired
  searchBySimilarity(
    query: string,
    repo: string,
    limit: number = 10
  ): Array<MemoryEntry & { similarity: number }> {
    const queryVector = this.computeVector(query);
    const now = new Date().toISOString();

    // Pre-filter: fetch at most limit*10 candidates, exclude expired
    const stmt = this.db.prepare(`
      SELECT * FROM memories
      WHERE repo = ?
        AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY importance DESC, created_at DESC
      LIMIT ?
    `);
    const candidates = stmt.all(repo, now, limit * 10) as any[];

    const withSimilarity = candidates.map((row) => {
      const memory = this.rowToMemoryEntry(row);
      const memoryVector = this.computeVector(memory.content);
      const similarity = this.cosineSimilarity(queryVector, memoryVector);
      return { ...memory, similarity };
    });

    return withSimilarity
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  // Sub-task 2.5: Archive expired memories
  archiveExpiredMemories(): number {
    const now = new Date().toISOString();

    const insertArchive = this.db.prepare(`
      INSERT OR IGNORE INTO memories_archive
        (id, repo, type, content, importance, folder, language,
         created_at, updated_at, hit_count, recall_count, last_used_at, expires_at, archived_at)
      SELECT id, repo, type, content, importance, folder, language,
             created_at, updated_at, hit_count, recall_count, last_used_at, expires_at, ?
      FROM memories
      WHERE expires_at IS NOT NULL AND expires_at <= ?
    `);

    const deleteExpired = this.db.prepare(`
      DELETE FROM memories
      WHERE expires_at IS NOT NULL AND expires_at <= ?
    `);

    const archive = this.db.transaction(() => {
      insertArchive.run(now, now);
      const result = deleteExpired.run(now);
      return result.changes;
    });

    return archive() as number;
  }

  // Get all memories with stats (for dashboard)
  getAllMemoriesWithStats(repo?: string): Array<
    MemoryEntry & {
      hit_count: number;
      recall_count: number;
      recall_rate: number;
      last_used_at: string | null;
    }
  > {
    let query = "SELECT * FROM memories";
    const params: unknown[] = [];

    if (repo) {
      query += " WHERE repo = ?";
      params.push(repo);
    }

    query += " ORDER BY hit_count DESC, importance DESC, created_at DESC";

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];

    return rows.map((row) => ({
      ...this.rowToMemoryEntry(row),
      hit_count: row.hit_count || 0,
      recall_count: row.recall_count || 0,
      recall_rate: row.hit_count > 0 ? row.recall_count / row.hit_count : 0,
      last_used_at: row.last_used_at ?? null,
    }));
  }

  upsertVectorEmbedding(memoryId: string, vector: number[] | string[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO memory_vectors (memory_id, vector, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(memory_id) DO UPDATE SET
        vector = excluded.vector,
        updated_at = excluded.updated_at
    `);
    stmt.run(memoryId, JSON.stringify(vector), new Date().toISOString());
  }

  getVectorEmbedding(memoryId: string): number[] | string[] | null {
    const stmt = this.db.prepare("SELECT vector FROM memory_vectors WHERE memory_id = ?");
    const row = stmt.get(memoryId) as any;
    if (!row) return null;
    try {
      return JSON.parse(row.vector);
    } catch {
      return null;
    }
  }

  close(): void {
    this.db.close();
  }

  // Sub-task 2.3: Use tokenize() from normalize.ts (single source of truth)
  private computeVector(text: string): Record<string, number> {
    const tokens = tokenize(text);
    const vector: Record<string, number> = {};
    for (const token of tokens) {
      vector[token] = (vector[token] || 0) + 1;
    }
    return vector;
  }

  private cosineSimilarity(
    v1: Record<string, number>,
    v2: Record<string, number>
  ): number {
    const keys1 = Object.keys(v1);
    const keys2 = Object.keys(v2);

    if (keys1.length === 0 || keys2.length === 0) return 0;

    let dotProduct = 0;
    for (const key of keys1) {
      if (v2[key]) {
        dotProduct += v1[key] * v2[key];
      }
    }

    const mag1 = Math.sqrt(keys1.reduce((sum, key) => sum + v1[key] * v1[key], 0));
    const mag2 = Math.sqrt(keys2.reduce((sum, key) => sum + v2[key] * v2[key], 0));

    if (mag1 === 0 || mag2 === 0) return 0;

    return dotProduct / (mag1 * mag2);
  }

  private rowToMemoryEntry(row: any): MemoryEntry {
    return {
      id: row.id,
      type: row.type,
      content: row.content,
      importance: row.importance,
      scope: {
        repo: row.repo,
        folder: row.folder || undefined,
        language: row.language || undefined,
      },
      created_at: row.created_at,
      updated_at: row.updated_at,
      hit_count: row.hit_count ?? 0,
      recall_count: row.recall_count ?? 0,
      last_used_at: row.last_used_at ?? null,
      expires_at: row.expires_at ?? null,
    };
  }
}
