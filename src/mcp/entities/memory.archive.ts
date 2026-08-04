import { BaseEntity } from "../storage/base";
import { BULK_UPDATE_CHUNK_SIZE, TABLE_MEMORIES } from "../utils/constants";
import { chunksOf } from "../utils/chunk";
import { MEMORY_STATUS_ACTIVE, MEMORY_STATUS_ARCHIVED } from "../types";

export class MemoryArchiveEntity extends BaseEntity {
	bulkDeleteMemories(ids: string[]): number {
		if (ids.length === 0) return 0;

		return this.transaction(() => {
			let count = 0;
			for (const chunk of chunksOf(ids, BULK_UPDATE_CHUNK_SIZE)) {
				const result = this.run(`DELETE FROM ${TABLE_MEMORIES} WHERE id IN (${chunk.map(() => "?").join(",")})`, chunk);
				count += result.changes;
			}
			return count;
		});
	}

	archiveExpiredMemories(force: boolean = false): number {
		if (process.env.ENABLE_AUTO_ARCHIVE !== "true" && !force) return 0;
		const now = new Date().toISOString();
		const result = this.run(
			`UPDATE ${TABLE_MEMORIES} SET status = '${MEMORY_STATUS_ARCHIVED}', updated_at = ? WHERE expires_at IS NOT NULL AND expires_at <= ? AND status = '${MEMORY_STATUS_ACTIVE}'`,
			[now, now]
		);
		return result.changes;
	}

	archiveLowScoreMemories(force: boolean = false): number {
		if (process.env.ENABLE_AUTO_ARCHIVE !== "true" && !force) return 0;
		const result = this.run(
			`UPDATE ${TABLE_MEMORIES} SET status = '${MEMORY_STATUS_ARCHIVED}', updated_at = ? WHERE status = '${MEMORY_STATUS_ACTIVE}' AND (
				(julianday('now') - julianday(COALESCE(last_used_at, created_at)) > 90 AND importance < 3)
				OR (hit_count > 10 AND recall_count = 0)
			)`,
			[new Date().toISOString()]
		);
		return result.changes;
	}
}
