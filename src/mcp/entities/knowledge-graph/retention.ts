import { BaseEntity } from "../../storage/base";

/** Retention-only SQL kept separate from KG CRUD/query orchestration. */
export class KnowledgeGraphRetentionEntity extends BaseEntity {
	/**
	 * Delete observations created before the cutoff whose PARENT DOCUMENT no
	 * longer exists (audit F1). No orphan sweep — that is a separate pass.
	 *
	 * **Why the parent check is not optional.** The observation text is the ONLY
	 * path from a document to its graph: every read resolves entity names via
	 * `getEntityNamesByObservation(observationText(domain, title), repo)`. So an
	 * age-only prune does not "clean up stale annotations" — it severs live
	 * documents from their own graph, permanently, because nothing re-creates
	 * the row: `queue_jobs` is already `done` for that entity and the startup
	 * backfill skips it (its vector is fresh). Measured on a real database
	 * running the age-only prune: 287/710 memories, 611/691 tasks and 297/297
	 * standards had been severed and returned `kg:{entities:[],relations:[]}`
	 * forever, while their edges stayed on disk.
	 *
	 * Two things ARE genuinely collectable and both are covered here:
	 *
	 *   1. **Contract-format rows whose parent row is gone** — `Mentioned in
	 *      {domain}: {title}` with no matching memory / task / standard /
	 *      codebase_file. The delete tools already remove these
	 *      (`deleteObservationsAndOrphans`), so this clause is the safety net
	 *      for rows missed by a crash, a pre-contract write, or a rename.
	 *   2. **Inline-format rows for entities with no contract anchor** — the
	 *      relation writers emit free-form texts (`"call relation: A → B"`,
	 *      `"depends_on relation: X → Y"`) that do NOT go through
	 *      `observationText()`, so no deleter can ever match them. On the same
	 *      database 18,275 such rows (41% of the table) were unreachable by
	 *      every cleanup path; 938 entity/repo pairs existed ONLY through them,
	 *      which is what kept their entities alive against the orphan sweep.
	 *
	 * Standards are matched by title WITHOUT a repo filter, mirroring
	 * `fetchKgContext`'s `repo ?? ""` call for the standard domain (standards
	 * may be global).
	 *
	 * @param cutoff - ISO timestamp; only rows older than this are considered.
	 * @returns Number of rows deleted.
	 */
	deleteStaleObservations(cutoff: string): number {
		const result = this.run(
			`DELETE FROM observations WHERE rowid IN (
			   SELECT o.rowid FROM observations o
			   WHERE o.created_at < ?
			     AND (
			       -- 1. contract-format, parent document gone
			       (
			         o.observation LIKE 'Mentioned in %'
			         AND NOT (
			              (o.observation LIKE 'Mentioned in memory: %'
			                AND EXISTS (SELECT 1 FROM memories m
			                             WHERE m.repo = o.repo
			                               AND 'Mentioned in memory: ' || m.title = o.observation))
			           OR (o.observation LIKE 'Mentioned in task: %'
			                AND EXISTS (SELECT 1 FROM tasks t
			                             WHERE t.repo = o.repo
			                               AND 'Mentioned in task: ' || t.title = o.observation))
			           OR (o.observation LIKE 'Mentioned in standard: %'
			                AND EXISTS (SELECT 1 FROM coding_standards s
			                             WHERE 'Mentioned in standard: ' || s.title = o.observation))
			           OR (o.observation LIKE 'Mentioned in codebase: %'
			                AND EXISTS (SELECT 1 FROM codebase_files f
			                             WHERE f.repo = o.repo
			                               AND 'Mentioned in codebase: ' || f.file_path = o.observation))
			         )
			       )
			       -- 2. inline-format row for an entity with no contract anchor
			       OR (
			         o.observation NOT LIKE 'Mentioned in %'
			         AND NOT EXISTS (SELECT 1 FROM observations anchor
			                          WHERE anchor.entity_name = o.entity_name
			                            AND anchor.repo = o.repo
			                            AND anchor.observation LIKE 'Mentioned in %')
			       )
			     )
			 )`,
			[cutoff]
		);
		return result.changes;
	}

	/**
	 * Count relation rows eligible for pruning: older than `cutoff` and with
	 * NEITHER endpoint referenced by any observation (audit F1). Used for
	 * observability — the prune itself selects and deletes in bounded chunks.
	 */
	countPrunableRelations(cutoff: string): number {
		return (
			this.get<{ cnt: number }>(
				`SELECT COUNT(*) AS cnt FROM relations r
				 WHERE r.created_at < ?
				   AND NOT EXISTS (SELECT 1 FROM observations o WHERE o.entity_name = r.from_entity)
				   AND NOT EXISTS (SELECT 1 FROM observations o2 WHERE o2.entity_name = r.to_entity)`,
				[cutoff]
			)?.cnt ?? 0
		);
	}

	/**
	 * Delete relations that no read path can ever reach again (audit F1).
	 *
	 * Eligibility — BOTH must hold:
	 *   - `created_at < cutoff` (age guard, so a freshly written edge is never
	 *     racing the sweep), and
	 *   - NEITHER endpoint appears in `observations` **in any repo**. Entity
	 *     names are resolved exclusively through observations, so such an edge
	 *     is unreachable from every entry point (`fetchKgContext`,
	 *     `fetchAggregatedKgContext`, `fetchTaskKgContext` and the dashboard's
	 *     entity detail all start from a name that came out of `observations`
	 *     or `entity_names_fts`, and the latter only holds names that have an
	 *     `entities` row — which the orphan sweep keeps only while an
	 *     observation or relation references it).
	 *
	 * The endpoint check is deliberately repo-AGNOSTIC (`NOT EXISTS ... WHERE
	 * entity_name = ?` with no `repo` predicate), matching
	 * `deleteOrphanEntities`'s global UNION: a name observed in ANOTHER repo is
	 * still a live name, and `entities.name` is a GLOBAL primary key, so a
	 * repo-scoped check would delete edges whose endpoint is legitimately owned
	 * by a different repo. Measured difference on a real database: repo-scoped
	 * would have taken 576,674 edges, repo-agnostic takes 395,215 — the 181,459
	 * difference is exactly the cross-repo-reachable set that must be kept.
	 *
	 * **Bounded by construction.** Every `DELETE` fires the v22 `kg_degrees`
	 * triggers (2 UPDATEs + 1 conditional DELETE per row), so throughput is
	 * ~18k rows/s. Measured on a 392,445-row backlog: an unbounded sweep took
	 * 189s with multi-second write-lock bursts. This implementation therefore:
	 *   - deletes at most `maxRows` per call (default 50,000 ≈ 2.7s), converging
	 *     over successive maintenance runs rather than in one startup, and
	 *   - commits every `chunkSize` rows (default 2,000) in its own
	 *     `BEGIN IMMEDIATE`, capping worst-case lock hold at ~250ms so a
	 *     sibling writer is never starved past `busy_timeout`.
	 *
	 * End-to-end verified on a copy of a real 536 MB database: 392,445 edges +
	 * 4,937 now-orphaned entities removed, `VACUUM` reclaimed 536 MB → 368 MB
	 * (31%), `PRAGMA integrity_check` = ok, `PRAGMA foreign_key_check` = 0
	 * violations.
	 *
	 * @param cutoff - ISO timestamp; only edges older than this are eligible.
	 * @param maxRows - Hard cap on rows deleted this call. `0` = no-op.
	 * @param chunkSize - Rows per transaction (write-lock hold bound).
	 * @returns Number of relation rows deleted.
	 */
	deleteUnreachableRelations(cutoff: string, maxRows: number, chunkSize: number): number {
		if (maxRows <= 0) return 0;

		// Cheap terminal gate: if NO edge is even age-eligible, skip the sweep
		// entirely. `idx_relations_created_at` (migration v29) makes this a
		// single index probe (<1ms) instead of paying the correlated NOT EXISTS
		// scan just to learn there is nothing to do.
		if (this.get<{ present: number }>("SELECT 1 AS present FROM relations WHERE created_at < ? LIMIT 1", [cutoff]) === undefined) {
			return 0;
		}

		const batch = Math.max(1, Math.min(chunkSize, maxRows));

		// Single cached statement (no dynamic placeholder list): the bounded
		// sub-SELECT picks the next `batch` eligible rowids and the DELETE
		// consumes them in the same statement, so one `BEGIN IMMEDIATE` covers
		// exactly one chunk. `idx_relations_created_at` turns the outer scan
		// into an index range seek, so a run with nothing left to prune costs
		// ~0ms instead of a full-table scan (measured 2844ms → 0ms on a
		// 895k-row table).
		const deleteChunkSql = `DELETE FROM relations WHERE rowid IN (
			   SELECT r.rowid FROM relations r
			   WHERE r.created_at < ?
			     AND NOT EXISTS (SELECT 1 FROM observations o WHERE o.entity_name = r.from_entity)
			     AND NOT EXISTS (SELECT 1 FROM observations o2 WHERE o2.entity_name = r.to_entity)
			   LIMIT ?
			 )`;

		let deleted = 0;
		while (deleted < maxRows) {
			const want = Math.min(batch, maxRows - deleted);
			const removed = this.transaction(() => this.run(deleteChunkSql, [cutoff, want]).changes);
			if (removed === 0) break;
			deleted += removed;
		}
		return deleted;
	}
}
