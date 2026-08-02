import { BaseEntity } from "../storage/base";
import { MemoryEntry, MemoryRow, VectorStore } from "../types/index";
import { MemoryIdVector } from "../types/common";
import { TABLE_MEMORIES } from "../utils/constants";
import { MEMORY_STATUS_ACTIVE, MEMORY_STATUS_ARCHIVED } from "../types";
import { computeVector, cosineSimilarity, createTfVectorCache } from "../utils/vector";
import {
	VECTOR_CANDIDATE_CAP,
	MIN_CANDIDATES,
	COLD_START_RECENT_LIMIT,
	SIMILARITY_ZERO_FALLBACK,
	REPO_MATCH_BOOST,
	MEMORY_CHECK_CONFLICTS_THRESHOLD
} from "../utils/constants";

export class MemoryVectorEntity extends BaseEntity {
	// In-memory TF vector cache keyed by memory id and validated against
	// memories.updated_at — self-invalidates on writes without write-path hooks.
	private readonly tfCache = createTfVectorCache();
	getVectorCandidates(
		owner?: string,
		repo?: string,
		limit = VECTOR_CANDIDATE_CAP
	): {
		memory_id: string;
		vector: string;
	}[] {
		let sql = `SELECT mv.memory_id, mv.vector FROM memory_vectors mv JOIN ${TABLE_MEMORIES} m ON mv.memory_id = m.id`;
		const params: (string | number)[] = [];
		if (repo) {
			sql += " WHERE m.owner = ? AND m.repo = ?";
			params.push(owner!, repo);
		} else if (owner) {
			sql += " WHERE m.owner = ?";
			params.push(owner);
		}
		sql += " LIMIT ?";
		params.push(limit);
		return this.all<MemoryIdVector>(sql, params);
	}

	upsertVectorEmbedding(memoryId: string, vector: unknown): void {
		this.run(
			`INSERT INTO memory_vectors (memory_id, vector, updated_at) VALUES (?, ?, ?)
			ON CONFLICT(memory_id) DO UPDATE SET vector = excluded.vector, updated_at = excluded.updated_at`,
			[memoryId, JSON.stringify(vector), new Date().toISOString()]
		);
	}

	/**
	 * Build the shared scope+tags predicate list used by the primary candidate
	 * query, where predicates join with AND consistently (TASK-009): a memory
	 * must be in-repo/global AND tag-matched. Returns the predicate list plus
	 * bound params in order.
	 */
	private buildSearchPredicates(
		owner: string,
		repo: string,
		currentTags: string[]
	): { predicates: string[]; params: (string | number)[] } {
		const predicates = ["(owner = ? AND repo = ? OR is_global = 1)"];
		const params: (string | number)[] = [owner, repo];

		if (currentTags.length > 0) {
			const tagConditions = currentTags.map(() => "tags LIKE ?").join(" OR ");
			predicates.push(`(${tagConditions})`);
			currentTags.forEach((tag) => params.push(`%${tag}%`));
		}

		return { predicates, params };
	}

	/**
	 * Build the cold-start fallback predicate list (FIX-13 / MEM-426): the repo
	 * scope is OR'ed with the tag conditions OUTSIDE the scope —
	 * `(scope) OR (tags)` — so tag-matched memories from OTHER repos re-enter
	 * the candidate pool for the memory.read tag-affinity boost (tech-stack
	 * affinity), while non-tag out-of-scope rows stay excluded. The primary
	 * query keeps the strict AND-join (TASK-009); only the fallback broadens.
	 */
	private buildFallbackPredicates(
		owner: string,
		repo: string,
		currentTags: string[]
	): { predicates: string[]; params: (string | number)[] } {
		const scopePredicate = "(owner = ? AND repo = ? OR is_global = 1)";
		const params: (string | number)[] = [owner, repo];
		const predicates: string[] = [];

		if (currentTags.length > 0) {
			const tagConditions = currentTags.map(() => "tags LIKE ?").join(" OR ");
			predicates.push(`(${scopePredicate} OR (${tagConditions}))`);
			currentTags.forEach((tag) => params.push(`%${tag}%`));
		} else {
			predicates.push(scopePredicate);
		}

		return { predicates, params };
	}

	searchBySimilarity(
		query: string,
		owner: string,
		repo: string,
		limit: number = 10,
		includeArchived: boolean = false,
		currentTags: string[] = []
	): (MemoryEntry & { similarity: number })[] {
		const queryVector = computeVector(query);
		const now = new Date();

		const { predicates, params } = this.buildSearchPredicates(owner, repo, currentTags);
		predicates.push("(expires_at IS NULL OR expires_at > ?)");
		params.push(now.toISOString());
		if (!includeArchived) predicates.push(`status = '${MEMORY_STATUS_ACTIVE}'`);

		// Honor the caller's fetch limit (was a hardcoded LIMIT 100) while
		// keeping a floor so small fetches/conflict checks stay responsive.
		const candidateLimit = Math.max(limit, MIN_CANDIDATES);

		const sql = `SELECT * FROM ${TABLE_MEMORIES} WHERE ${predicates.join(" AND ")}
			ORDER BY CASE WHEN owner = ? AND repo = ? THEN 0 ELSE 1 END, importance DESC, created_at DESC LIMIT ?`;
		const candidates = this.all<MemoryRow>(sql, [...params, owner, repo, candidateLimit]);

		if (candidates.length < 5) {
			// Cold-start fallback: broaden the scope for tag-affinity recall —
			// the repo scope is OR'ed with tag matches so cross-repo tag-matched
			// memories can re-enter candidates (MEM-426), while non-tag
			// out-of-scope rows stay excluded. The primary path keeps the
			// strict AND-join (TASK-009).
			const { predicates: recentPredicates, params: recentParams } = this.buildFallbackPredicates(
				owner,
				repo,
				currentTags
			);
			recentPredicates.push(`status = '${MEMORY_STATUS_ACTIVE}'`, "(expires_at IS NULL OR expires_at > ?)");
			const recentSql = `SELECT * FROM ${TABLE_MEMORIES} WHERE ${recentPredicates.join(" AND ")} ORDER BY created_at DESC LIMIT ${COLD_START_RECENT_LIMIT}`;
			const recent = this.all<MemoryRow>(recentSql, [...recentParams, now.toISOString()]);
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
				const isArchived = row.status === MEMORY_STATUS_ARCHIVED && !includeArchived;

				if (isExpired || isArchived) {
					return { ...memory, similarity: 0 };
				}

				const similarity = cosineSimilarity(queryVector, this.tfCache.get(row.id, row.content, row.updated_at)) || 0;
				let score = similarity;
				if (!score) {
					score = SIMILARITY_ZERO_FALLBACK;
				}

				if (row.repo === repo) score += REPO_MATCH_BOOST;

				return { ...memory, similarity: score };
			})
			.filter((r) => r.similarity > 0)
			.sort((a, b) => b.similarity - a.similarity)
			.slice(0, limit);
	}

	async checkConflicts(
		content: string,
		owner: string,
		repo: string,
		_type: string,
		_vectors: VectorStore,
		threshold: number = MEMORY_CHECK_CONFLICTS_THRESHOLD
	): Promise<(MemoryEntry & { similarity: number }) | null> {
		const results = await this.searchBySimilarity(content, owner, repo, 1, false);
		if (results.length > 0 && results[0].similarity >= threshold) {
			return results[0];
		}
		return null;
	}
}
