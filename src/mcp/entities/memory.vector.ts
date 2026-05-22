import { BaseEntity } from "../storage/base";
import { MemoryEntry, MemoryRow, VectorStore } from "../types/index";
import { MemoryIdVector } from "../types/common";

export class MemoryVectorEntity extends BaseEntity {
	getVectorCandidates(repo?: string, limit = 100): { memory_id: string; vector: string }[] {
		let sql = `SELECT mv.memory_id, mv.vector FROM memory_vectors mv JOIN memories m ON mv.memory_id = m.id`;
		const params: (string | number)[] = [];
		if (repo) {
			sql += " WHERE m.repo = ?";
			params.push(repo);
		}
		sql += " LIMIT ?";
		params.push(limit);
		return this.all<MemoryIdVector>(sql, params);
	}

	upsertVectorEmbedding(memoryId: string, vector: number[]): void {
		this.run(
			`INSERT INTO memory_vectors (memory_id, vector, updated_at) VALUES (?, ?, ?)
			ON CONFLICT(memory_id) DO UPDATE SET vector = excluded.vector, updated_at = excluded.updated_at`,
			[memoryId, JSON.stringify(vector), new Date().toISOString()]
		);
	}

	searchBySimilarity(
		query: string,
		repo: string,
		limit: number = 10,
		includeArchived: boolean = false,
		currentTags: string[] = []
	): (MemoryEntry & { similarity: number })[] {
		const queryVector = this.computeVector(query);
		const now = new Date();

		const where = ["(repo = ? OR is_global = 1)"];
		const params: (string | number)[] = [repo];

		if (currentTags.length > 0) {
			const tagConditions = currentTags.map(() => "tags LIKE ?").join(" OR ");
			where.push(`(${tagConditions})`);
			currentTags.forEach((tag) => params.push(`%${tag}%`));
		}

		let sql = `SELECT * FROM memories WHERE (${where.join(" AND ")}) AND (expires_at IS NULL OR expires_at > ?)`;
		if (!includeArchived) sql += " AND status = 'active'";
		sql += ` ORDER BY CASE WHEN repo = ? THEN 0 ELSE 1 END, importance DESC, created_at DESC LIMIT 100`;

		const candidates = this.all<MemoryRow>(sql, [...params, now.toISOString(), repo]);

		if (candidates.length < 5) {
			const recentSql = `SELECT * FROM memories WHERE (${where.join(" OR ")}) AND status = 'active' AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC LIMIT 10`;
			const recent = this.all<MemoryRow>(recentSql, [...params, now.toISOString()]);
			const candidateIds = new Set(candidates.map((c) => c.id));
			for (const r of recent) {
				if (!candidateIds.has(r.id)) {
					candidateIds.add(r.id);
					candidates.push(r);
				}
			}
		}

		return candidates
			.map((row) => {
				const memory = this.rowToMemoryEntry(row);

				const isExpired = row.expires_at && new Date(row.expires_at) <= now;
				const isArchived = row.status === "archived" && !includeArchived;

				if (isExpired || isArchived) {
					return { ...memory, similarity: 0 };
				}

				const similarity = this.cosineSimilarity(queryVector, this.computeVector(memory.content)) || 0;
				let score = similarity;
				if (!score) {
					score = 0.16;
				}

				if (row.repo === repo) score += 0.1;



				return { ...memory, similarity: score };
			})
			.filter((r) => r.similarity > 0)
			.sort((a, b) => b.similarity - a.similarity)
			.slice(0, limit);
	}

	async checkConflicts(
		content: string,
		repo: string,
		_type: string,
		_vectors: VectorStore,
		threshold: number = 0.55
	): Promise<(MemoryEntry & { similarity: number }) | null> {
		const results = await this.searchBySimilarity(content, repo, 1, false);
		if (results.length > 0 && results[0].similarity >= threshold) {
			return results[0];
		}
		return null;
	}
}
