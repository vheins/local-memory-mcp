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
		const now = new Date().toISOString();
		if (!force) {
			const activeCount = this.get<{ count: number }>(`SELECT COUNT(*) as count FROM memories WHERE status = 'active'`)?.count ?? 0;
			if (activeCount < 100) return 0;
		}

		return this.transaction(() => {
			const result = this.run(
				`UPDATE memories SET status = 'archived', updated_at = ? WHERE expires_at IS NOT NULL AND expires_at <= ? AND status = 'active'`,
				[now, now]
			);
			return result.changes;
		});
	}

	archiveLowScoreMemories(force: boolean = false): number {
		if (!force) {
			const activeCount = this.get<{ count: number }>(`SELECT COUNT(*) as count FROM memories WHERE status = 'active'`)?.count ?? 0;
			if (activeCount < 100) return 0;
		}

		const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

		return this.transaction(() => {
			const result = this.run(
				`UPDATE memories SET status = 'archived', updated_at = ? WHERE status = 'active' AND (
					(importance <= 2 AND hit_count = 0 AND created_at < ?)
				)`,
				[new Date().toISOString(), threeDaysAgo]
			);
			return result.changes;
		});
	}
}
