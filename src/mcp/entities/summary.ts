import { BaseEntity } from "../storage/base";

export class SummaryEntity extends BaseEntity {
	getSummary(owner: string, repo: string): { summary: string; updated_at: string } | null {
		const row = this.get<{ summary: string; updated_at: string }>(
			"SELECT summary, updated_at FROM memory_summary WHERE owner = ? AND repo = ?",
			[owner, repo]
		);
		return row || null;
	}

	upsertSummary(owner: string, repo: string, summary: string): void {
		const existing = this.get<{ summary: string }>("SELECT summary FROM memory_summary WHERE owner = ? AND repo = ?", [
			owner,
			repo
		]);
		if (existing) {
			this.run("UPDATE memory_summary SET summary = ?, updated_at = ? WHERE owner = ? AND repo = ?", [
				summary,
				new Date().toISOString(),
				owner,
				repo
			]);
		} else {
			this.run("INSERT INTO memory_summary (owner, repo, summary, updated_at) VALUES (?, ?, ?, ?)", [
				owner,
				repo,
				summary,
				new Date().toISOString()
			]);
		}
	}
}
