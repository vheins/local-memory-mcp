import { BaseEntity } from "../storage/base";

export class MemoryArchiveEntity extends BaseEntity {
	bulkDeleteMemories(ids: string[]): number {
		if (ids.length === 0) return 0;

		return this.transaction(() => {
			let count = 0;
			const chunkSize = 500;
			for (let i = 0; i < ids.length; i += chunkSize) {
				const chunk = ids.slice(i, i + chunkSize);
				const result = this.run(`DELETE FROM memories WHERE id IN (${chunk.map(() => "?").join(",")})`, chunk);
				count += result.changes;
			}
			return count;
		});
	}

	archiveExpiredMemories(force: boolean = false): number {
		if (process.env.ENABLE_AUTO_ARCHIVE !== "true" && !force) return 0;
		const now = new Date().toISOString();
		const result = this.run(
			`UPDATE memories SET status = 'archived', updated_at = ? WHERE expires_at IS NOT NULL AND expires_at <= ? AND status = 'active'`,
			[now, now]
		);
		return result.changes;
	}

	archiveLowScoreMemories(force: boolean = false): number {
		if (process.env.ENABLE_AUTO_ARCHIVE !== "true" && !force) return 0;
		const result = this.run(
			`UPDATE memories SET status = 'archived', updated_at = ? WHERE status = 'active' AND (
				(julianday('now') - julianday(COALESCE(last_used_at, created_at)) > 90 AND importance < 3)
				OR (hit_count > 10 AND recall_count = 0)
			)`,
			[new Date().toISOString()]
		);
		return result.changes;
	}
}
