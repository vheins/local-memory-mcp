import { BaseEntity } from "../storage/base.js";
import { MemoryEntry } from "../types.js";
import { tokenize } from "../utils/normalize.js";

/**
 * Handles all memory-related database operations.
 */
export class MemoryEntity extends BaseEntity {
  
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
      entry.agent || "unknown",
      entry.role || "unknown",
      entry.model || "unknown",
      entry.completed_at || null
    );
  }

  update(id: string, updates: Partial<MemoryEntry>): void {
    const fields: string[] = [];
    const values: unknown[] = [];

    Object.keys(updates).forEach(key => {
      // @ts-ignore
      const val = updates[key];
      if (val !== undefined) {
        if (key === 'scope') {
          if (updates.scope?.repo) { fields.push("repo = ?"); values.push(updates.scope.repo); }
          if (updates.scope?.folder !== undefined) { fields.push("folder = ?"); values.push(updates.scope.folder); }
          if (updates.scope?.language !== undefined) { fields.push("language = ?"); values.push(updates.scope.language); }
        } else if (key === 'tags' || key === 'metadata') {
          fields.push(`${key} = ?`);
          values.push(JSON.stringify(val));
        } else if (key === 'is_global') {
          fields.push(`${key} = ?`);
          values.push(val ? 1 : 0);
        } else {
          fields.push(`${key} = ?`);
          values.push(val);
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

  delete(id: string): void {
    this.db.prepare("DELETE FROM memories WHERE id = ?").run(id);
  }

  getById(id: string): MemoryEntry | null {
    const row = this.db.prepare("SELECT * FROM memories WHERE id = ?").get(id);
    return row ? this.rowToMemoryEntry(row) : null;
  }

  getByIdWithStats(id: string): any | null {
    const row = this.db.prepare(`
      SELECT *, CASE WHEN hit_count > 0 THEN CAST(recall_count AS REAL) / hit_count ELSE 0 END AS recall_rate
      FROM memories WHERE id = ?
    `).get(id) as any;
    if (!row) return null;
    return {
      ...this.rowToMemoryEntry(row),
      recall_rate: row.recall_rate ?? 0
    };
  }

  getByIds(ids: string[], options: { type?: string; status?: string } = {}): MemoryEntry[] {
    if (ids.length === 0) return [];
    let sql = `SELECT * FROM memories WHERE id IN (${ids.map(() => "?").join(",")})`;
    const params: any[] = [...ids];

    if (options.type) {
      sql += " AND type = ?";
      params.push(options.type);
    }
    if (options.status) {
      sql += " AND status = ?";
      params.push(options.status);
    }

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(row => this.rowToMemoryEntry(row));
  }

  getStats(repo?: string): { total: number, byType: Record<string, number> } {
    let sql = "SELECT type, COUNT(*) as count FROM memories";
    const params: any[] = [];
    if (repo) {
      sql += " WHERE repo = ?";
      params.push(repo);
    }
    sql += " GROUP BY type";
    
    const rows = this.db.prepare(sql).all(...params) as any[];
    const byType: Record<string, number> = {};
    let total = 0;
    rows.forEach(row => {
      byType[row.type] = row.count;
      total += row.count;
    });
    
    return { total, byType };
  }

  searchByRepo(repo: string, query: string = "", type?: string, limit = 5): MemoryEntry[] {
    const now = new Date().toISOString();
    let sql = "SELECT * FROM memories WHERE repo = ? AND (content LIKE ? OR title LIKE ? OR tags LIKE ?) AND status = 'active' AND (expires_at IS NULL OR expires_at > ?)";
    const params: any[] = [repo, `%${query}%`, `%${query}%`, `%${query}%`, now];

    if (type) {
      sql += " AND type = ?";
      params.push(type);
    }

    sql += " ORDER BY importance DESC, created_at DESC LIMIT ?";
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(row => this.rowToMemoryEntry(row));
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
          entry.agent || "unknown",
          entry.role || "unknown",
          entry.model || "unknown",
          entry.completed_at || null
        );
        count++;
      }
      return count;
    });

    return insertMany(entries);
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
    
    const rows = this.db.prepare(query).all(...params) as any[];
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

  getSummary(repo: string): any {
    return this.db.prepare("SELECT summary, updated_at FROM memory_summary WHERE repo = ?").get(repo);
  }

  upsertSummary(repo: string, summary: string): void {
    this.db.prepare(`
      INSERT INTO memory_summary (repo, summary, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(repo) DO UPDATE SET summary = excluded.summary, updated_at = excluded.updated_at
    `).run(repo, summary, new Date().toISOString());
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

  async checkConflicts(content: string, repo: string, type: string, vectors: any, threshold: number = 0.55): Promise<any | null> {
    const results = await this.searchBySimilarity(content, repo, 1, false);
    if (results.length > 0 && results[0].similarity >= threshold) {
      return results[0];
    }
    return null;
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
  }
}
