import { BaseEntity } from "../storage/base";

export class SummaryEntity extends BaseEntity {
	getSummary(repo: string): { summary: string; updated_at: string } | null {
		const row = this.get<{ summary: string; updated_at: string }>(
			"SELECT summary, updated_at FROM memory_summary WHERE repo = ?",
			[repo]
		);
		return row || null;
	}

	upsertSummary(repo: string, summary: string): void {
		this.run(
			`INSERT INTO memory_summary (repo, summary, updated_at) VALUES (?, ?, ?)
			ON CONFLICT(repo) DO UPDATE SET summary = excluded.summary, updated_at = excluded.updated_at`,
			[repo, summary, new Date().toISOString()]
		);
	}
}
