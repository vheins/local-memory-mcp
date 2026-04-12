import { BaseEntity } from "../storage/base.js";

/**
 * Handles repository summaries.
 */
export class SummaryEntity extends BaseEntity {

  getSummary(repo: string): { summary: string, updated_at: string } | null {
    const row = this.db.prepare("SELECT summary, updated_at FROM memory_summary WHERE repo = ?").get(repo) as any;
    return row || null;
  }

  upsertSummary(repo: string, summary: string): void {
    this.db.prepare(`
      INSERT INTO memory_summary (repo, summary, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(repo) DO UPDATE SET summary = excluded.summary, updated_at = excluded.updated_at
    `).run(repo, summary, new Date().toISOString());
  }
}
