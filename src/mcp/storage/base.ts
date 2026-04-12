import Database from "better-sqlite3";
import { MemoryEntry, Task } from "../types.js";
import { tokenize } from "../utils/normalize.js";

/**
 * Base class for all database entities.
 * Provdes shared access to the database instance and mapping helpers.
 */
export abstract class BaseEntity {
  constructor(protected db: Database.Database) {}

  /**
   * Safe JSON parsing helper to avoid crashes on corrupt data
   */
  protected safeJSONParse<T>(json: string | null | undefined, defaultValue: T): T {
    if (!json) return defaultValue;
    try {
      return JSON.parse(json);
    } catch (e) {
      return defaultValue;
    }
  }

  /**
   * Mapping helper for MemoryEntry
   */
  protected rowToMemoryEntry(row: any): MemoryEntry {
    return {
      id: row.id,
      type: row.type,
      title: row.title || "Untitled",
      content: row.content,
      importance: row.importance,
      agent: row.agent || 'unknown',
      role: row.role || 'unknown',
      model: row.model || 'unknown',
      scope: {
        repo: row.repo,
        folder: row.folder || undefined,
        language: row.language || undefined
      },
      created_at: row.created_at,
      updated_at: row.updated_at,
      completed_at: row.completed_at || null,
      hit_count: row.hit_count ?? 0,
      recall_count: row.recall_count ?? 0,
      last_used_at: row.last_used_at ?? null,
      expires_at: row.expires_at ?? null,
      supersedes: row.supersedes ?? null,
      status: row.status || "active",
      is_global: row.is_global === 1,
      tags: this.safeJSONParse(row.tags, []),
      metadata: this.safeJSONParse(row.metadata, {})
    };
  }

  /**
   * Mapping helper for Task
   */
  protected rowToTask(row: any): Task {
    return {
      id: row.id,
      repo: row.repo,
      task_code: row.task_code,
      phase: row.phase || "",
      title: row.title,
      description: row.description || null,
      status: row.status || "backlog",
      priority: row.priority || 3,
      agent: row.agent || 'unknown',
      role: row.role || 'unknown',
      doc_path: row.doc_path || null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      in_progress_at: row.in_progress_at || null,
      finished_at: row.finished_at || null,
      canceled_at: row.canceled_at || null,
      est_tokens: row.est_tokens || 0,
      tags: this.safeJSONParse(row.tags, []),
      metadata: this.safeJSONParse(row.metadata, {}),
      parent_id: row.parent_id || null,
      depends_on: row.depends_on || null
    };
  }

  /**
   * Vector math utilities (simple bag-of-words implementation)
   */
  protected computeVector(text: string): number[] {
    const tokens = tokenize(text);
    const vector: number[] = new Array(128).fill(0);
    tokens.forEach(token => {
      let hash = 0;
      for (let i = 0; i < token.length; i++) {
        hash = (hash << 5) - hash + token.charCodeAt(i);
        hash |= 0;
      }
      const index = Math.abs(hash) % 128;
      vector[index]++;
    });
    return vector;
  }

  protected cosineSimilarity(v1: number[], v2: number[]): number {
    let dotProduct = 0;
    let mag1 = 0;
    let mag2 = 0;
    for (let i = 0; i < v1.length; i++) {
      dotProduct += v1[i] * v2[i];
      mag1 += v1[i] * v1[i];
      mag2 += v2[i] * v2[i];
    }
    const mag = Math.sqrt(mag1) * Math.sqrt(mag2);
    return mag === 0 ? 0 : dotProduct / mag;
  }
}
