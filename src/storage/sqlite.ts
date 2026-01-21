import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { MemoryEntry, MemoryScope } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "../../storage/memory.db");

export class SQLiteStore {
  private db: Database.Database;

  constructor() {
    this.db = new Database(DB_PATH);
    this.migrate();
  }

  private migrate() {
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
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_memories_repo ON memories(repo);
      CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
      CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance);

      CREATE TABLE IF NOT EXISTS memory_summary (
        repo TEXT PRIMARY KEY,
        summary TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  insert(entry: MemoryEntry): void {
    const stmt = this.db.prepare(`
      INSERT INTO memories (
        id, repo, type, content, importance, folder, language, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      entry.updated_at
    );
  }

  update(id: string, updates: { content?: string; importance?: number }): void {
    const fields: string[] = [];
    const values: any[] = [];

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

  searchByRepo(
    repo: string,
    options: {
      types?: string[];
      minImportance?: number;
      limit?: number;
    } = {}
  ): MemoryEntry[] {
    let query = "SELECT * FROM memories WHERE repo = ?";
    const params: any[] = [repo];

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

    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      content: row.content,
      importance: row.importance,
      scope: {
        repo: row.repo,
        folder: row.folder || undefined,
        language: row.language || undefined
      },
      created_at: row.created_at,
      updated_at: row.updated_at
    }));
  }

  getById(id: string): MemoryEntry | null {
    const stmt = this.db.prepare("SELECT * FROM memories WHERE id = ?");
    const row = stmt.get(id) as any;

    if (!row) return null;

    return {
      id: row.id,
      type: row.type,
      content: row.content,
      importance: row.importance,
      scope: {
        repo: row.repo,
        folder: row.folder || undefined,
        language: row.language || undefined
      },
      created_at: row.created_at,
      updated_at: row.updated_at
    };
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

  listAllRepos(): string[] {
    const stmt = this.db.prepare("SELECT DISTINCT repo FROM memories ORDER BY repo");
    const rows = stmt.all() as any[];
    return rows.map(row => row.repo);
  }

  getStats(repo?: string): {
    total: number;
    byType: Record<string, number>;
    unused: number;
  } {
    let query = "SELECT type, COUNT(*) as count FROM memories";
    const params: any[] = [];
    
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
    
    // Count unused (memories with no hit_count - we'll need to add this field)
    // For now, return 0
    const unused = 0;
    
    return { total, byType, unused };
  }

  close(): void {
    this.db.close();
  }
}
