import { BaseEntity } from "../../storage/base";
import { logger } from "../../utils/logger";
import { KG_MAX_CONTEXT_ENTITIES, KG_MAX_CONTEXT_RELATIONS, KG_MAX_GRAPH_EDGES } from "../../utils/constants";
import * as queries from "./queries";
import type { KgQueryRunner, KgEntityRow, KgRelationRow, KgObservationRow } from "./queries";
import {
	upsertEntity as writeUpsertEntity,
	upsertRelation as writeUpsertRelation,
	insertObservation as writeInsertObservation,
	createEntity as writeCreateEntity,
	createRelation as writeCreateRelation,
	type KgWriteRunner,
	type UpsertEntityParams,
	type UpsertRelationParams,
	type InsertObservationParams,
	type CreateEntityParams,
	type CreateRelationParams
} from "./writers";

/**
 * Single encapsulation point for ALL raw SQL against the knowledge-graph
 * tables. Read/query SQL lives in `./queries` (TASK-176); leaf INSERT
 * writers live in `./writers` (TASK-432) — both execute through the shared
 * prepared-statement cache. Orchestration and cascade deletes stay here and
 * run inside `db.transaction`.
 */
export class KnowledgeGraphEntity extends BaseEntity {
	/** Read accessor exposing protected BaseEntity helpers to `./queries` (TASK-176). */
	private get runner(): KgQueryRunner {
		return {
			all: <T>(sql: string, params: unknown[] = []) => this.all<T>(sql, params),
			get: <T>(sql: string, params: unknown[] = []) => this.get<T>(sql, params)
		};
	}

	/** Write accessor exposing BaseEntity's `run`/`transaction` to `./writers` (TASK-432). */
	private get writerRunner(): KgWriteRunner {
		return {
			run: (sql: string, params?: unknown[]) => this.run(sql, params),
			transaction: <T>(fn: () => T): T => this.transaction(fn)
		};
	}

	// -----------------------------------------------------------------------
	// Writes
	// -----------------------------------------------------------------------

	/** Insert an entity, ignoring duplicates (entities.name is the primary key). */
	upsertEntity(params: UpsertEntityParams): void {
		writeUpsertEntity(this.writerRunner, params);
	}

	/**
	 * Insert a relation, ignoring duplicates (composite PK on from_entity, to_entity, relation_type).
	 */
	upsertRelation(params: UpsertRelationParams): void {
		writeUpsertRelation(this.writerRunner, params);
	}

	/**
	 * Resolve-or-upsert BOTH endpoints (global PK) then insert the relation —
	 * idempotent against orphan-swept endpoints (TASK-065 / MEM-473). ATOMIC
	 * (TASK-067 fix #2 / TASK-072): both upserts + insert run in one BEGIN
	 * IMMEDIATE (base.ts immediate, TASK-064 / MEM-475).
	 *
	 * `confidence` (optional, migration v24 / TASK-325) is passed through to
	 * the relation insert; when omitted it defaults to 1.0 (explicit-grade).
	 * INSERT OR IGNORE keeps the FIRST writer's confidence for an already
	 * existing edge (first-write-wins — documented in the v24 migration).
	 */
	ensureRelation(params: {
		from_entity: string;
		from_type: string;
		to_entity: string;
		to_type: string;
		relation_type: string;
		repo: string;
		owner: string;
		created_at: string;
		confidence?: number;
	}): void {
		this.transaction(() => {
			this.upsertEntity({
				name: params.from_entity,
				type: params.from_type,
				description: null,
				repo: params.repo,
				owner: params.owner,
				created_at: params.created_at,
				updated_at: params.created_at
			});
			this.upsertEntity({
				name: params.to_entity,
				type: params.to_type,
				description: null,
				repo: params.repo,
				owner: params.owner,
				created_at: params.created_at,
				updated_at: params.created_at
			});
			this.upsertRelation({
				from_entity: params.from_entity,
				to_entity: params.to_entity,
				relation_type: params.relation_type,
				repo: params.repo,
				owner: params.owner,
				created_at: params.created_at,
				confidence: params.confidence
			});
		});
	}

	/**
	 * Resolve-or-upsert the entity then insert the observation — atomically
	 * (single BEGIN IMMEDIATE); a plain insert could hit FOREIGN KEY on a
	 * concurrent orphan-sweep (TASK-073 / MEM-482).
	 */
	ensureObservation(params: {
		id: string;
		name: string;
		type: string;
		description: string | null;
		observation: string;
		repo: string;
		owner: string;
		created_at: string;
	}): void {
		this.transaction(() => {
			this.upsertEntity({
				name: params.name,
				type: params.type,
				description: params.description,
				repo: params.repo,
				owner: params.owner,
				created_at: params.created_at,
				updated_at: params.created_at
			});
			this.insertObservation({
				id: params.id,
				entity_name: params.name,
				observation: params.observation,
				repo: params.repo,
				owner: params.owner,
				created_at: params.created_at
			});
		});
	}

	/**
	 * INSERT OR IGNORE against the unique (entity_name, observation) index (v9)
	 * so lease-recovery reprocessing never duplicates (TASK-013).
	 */
	insertObservation(params: InsertObservationParams): void {
		writeInsertObservation(this.writerRunner, params);
	}

	// -----------------------------------------------------------------------
	// Batch extraction writes (OPT-PERF-01)
	// -----------------------------------------------------------------------

	/**
	 * Persist observations + co-occurrence relations in one BEGIN IMMEDIATE
	 * (OPT-PERF-01, O(N²)→1 per doc) — no nested savepoints — so pair atomicity
	 * (TASK-073 / MEM-482) holds. Per-pair try/catch keeps the "never throw,
	 * log warn" contract (TASK-013); relation failures are silent. Boundary
	 * guard (TASK-175): only the transaction call is try/catch-wrapped so a
	 * cross-process SQLITE_BUSY can't bubble into saveExtractions.
	 *
	 * Composes the leaf writers via `this.upsertEntity` / `this.insertObservation`
	 * / `this.upsertRelation` (NOT the `./writers` functions directly) so the
	 * write path stays observable on the instance.
	 */
	saveExtractionBatch(params: {
		observations: Array<{
			id: string;
			name: string;
			type: string;
			description: string | null;
			observation: string;
		}>;
		relations: Array<{
			from_entity: string;
			from_type: string;
			to_entity: string;
			to_type: string;
			relation_type: string;
			confidence?: number;
		}>;
		repo: string;
		owner: string;
		created_at: string;
	}): void {
		try {
			this.transaction(() => {
				const { observations, relations, repo, owner, created_at } = params;

				for (const obs of observations) {
					try {
						this.upsertEntity({
							name: obs.name,
							type: obs.type,
							description: obs.description,
							repo,
							owner,
							created_at,
							updated_at: created_at
						});
						this.insertObservation({
							id: obs.id,
							entity_name: obs.name,
							observation: obs.observation,
							repo,
							owner,
							created_at
						});
					} catch (err) {
						logger.warn("[KG-Archivist] Failed to save extraction for entity", {
							error: String(err),
							entity: obs.name
						});
					}
				}

				for (const rel of relations) {
					try {
						this.upsertEntity({
							name: rel.from_entity,
							type: rel.from_type,
							description: null,
							repo,
							owner,
							created_at,
							updated_at: created_at
						});
						this.upsertEntity({
							name: rel.to_entity,
							type: rel.to_type,
							description: null,
							repo,
							owner,
							created_at,
							updated_at: created_at
						});
						this.upsertRelation({
							from_entity: rel.from_entity,
							to_entity: rel.to_entity,
							relation_type: rel.relation_type,
							repo,
							owner,
							created_at,
							confidence: rel.confidence
						});
					} catch {
						// Silent: relation may already exist
					}
				}
			});
		} catch (err) {
			// Boundary guard (TASK-175): an abort mid-batch throws here — outside
			// the per-pair catches — so SQLITE_BUSY can't bubble into saveExtractions.
			logger.warn("[KG-Archivist] Failed to save extraction batch", {
				error: String(err),
				repo: params.repo,
				count: params.observations.length + params.relations.length
			});
		}
	}

	/** Dashboard/admin create: plain INSERT (throws on duplicate name → PK conflict). */
	createEntity(params: CreateEntityParams): void {
		writeCreateEntity(this.writerRunner, params);
	}

	/** Dashboard/admin create: plain INSERT (throws on duplicate relation → 409). */
	createRelation(params: CreateRelationParams): void {
		writeCreateRelation(this.writerRunner, params);
	}

	// -----------------------------------------------------------------------
	// Reads (delegated to ./queries — TASK-176)
	// -----------------------------------------------------------------------

	/**
	 * Fetch entity name/type rows for the given names. NOT repo-filtered —
	 * `entities.name` is a global PK, so a repo predicate here filtered on
	 * first-writer-wins rather than ownership and silently dropped entities
	 * whose edges the response still shipped (audit F6 — see ./queries).
	 */
	getEntitiesFor(entityNames: string[]): Array<{ name: string; type: string }> {
		return queries.getEntitiesFor(this.runner, entityNames);
	}

	/**
	 * Fetch relations touching any of the given entity names, scoped to a repo.
	 * Bounded UNION of two index-served branches, ranked by confidence
	 * (audit F2 — see ./queries `getRelationsFor` for the plan analysis and
	 * the measured A/B). `limit = 0` restores unbounded output.
	 */
	getRelationsFor(
		entityNames: string[],
		repo: string,
		limit = KG_MAX_CONTEXT_RELATIONS
	): Array<{ from: string; to: string; type: string }> {
		return queries.getRelationsFor(this.runner, entityNames, repo, limit);
	}

	/** Entity names referenced by a single exact observation text. */
	getEntityNamesByObservation(observation: string, repo: string): string[] {
		return queries.getEntityNamesByObservation(this.runner, observation, repo);
	}

	/** Entity names referenced by any of the given exact observation texts. */
	getEntityNamesByObservations(observations: string[], repo: string): string[] {
		return queries.getEntityNamesByObservations(this.runner, observations, repo);
	}

	/** Entity names related to the given search text (FTS5 token index, bounded INSTR fallback — see ./queries, OPT-PERF-04). */
	getEntityNamesByText(repo: string, text: string, limit = KG_MAX_CONTEXT_ENTITIES): string[] {
		return queries.getEntityNamesByText(this.runner, repo, text, limit);
	}

	/** Whether an entity with the given name exists. */
	entityExists(name: string): boolean {
		return queries.entityExists(this.runner, name);
	}

	/** Full entity row by name (dashboard detail). */
	getEntityByName(name: string): KgEntityRow | undefined {
		return queries.getEntityByName(this.runner, name);
	}

	/** Full relation rows touching the given entity (dashboard detail). */
	getRelationsByName(name: string): KgRelationRow[] {
		return queries.getRelationsByName(this.runner, name);
	}

	/** Full observation rows for the given entity (dashboard detail). */
	getObservationsByName(name: string): KgObservationRow[] {
		return queries.getObservationsByName(this.runner, name);
	}

	/** Entities scoped to a repo with optional type/search filters (dashboard); supports pagination. */
	listEntities(
		repo: string,
		options?: { type?: string; search?: string; limit?: number; offset?: number }
	): KgEntityRow[] {
		return queries.listEntities(this.runner, repo, options);
	}

	/** Count entities matching the given filters (for pagination total). */
	countEntities(repo: string, options?: { type?: string; search?: string }): number {
		return queries.countEntities(this.runner, repo, options);
	}

	/** All relations scoped to a repo (dashboard); supports pagination. */
	listRelations(repo: string, options?: { limit?: number; offset?: number }): KgRelationRow[] {
		return queries.listRelations(this.runner, repo, options);
	}

	/** Count relations scoped to a repo (for pagination total). */
	countRelations(repo: string): number {
		return queries.countRelations(this.runner, repo);
	}

	/** Graph nodes for a repo, ordered by edge degree (TASK-145); supports pagination. */
	listGraphNodes(repo: string, options?: { limit?: number; offset?: number }): Array<{ name: string; type: string }> {
		return queries.listGraphNodes(this.runner, repo, options);
	}

	/** Count graph nodes for a repo (for pagination total). */
	countGraphNodes(repo: string): number {
		return queries.countGraphNodes(this.runner, repo);
	}

	/** Graph edges capped to the top-N by endpoint degree (TASK-068/S2, TASK-070); probe detects truncation (TASK-148). Edge payload includes the confidence label (migration v24 / TASK-325). */
	listGraphEdges(
		repo: string,
		limit = KG_MAX_GRAPH_EDGES,
		probe = false
	): Array<{ source: string; target: string; relation_type: string; confidence: number }> {
		return queries.listGraphEdges(this.runner, repo, limit, probe);
	}

	/** Graph edges restricted to a node subset (both endpoints in `nodeNames`), degree-ranked via the kg_degrees cache (TASK-268); probe detects truncation (TASK-148). Edge payload includes the confidence label (migration v24 / TASK-325). */
	listGraphEdgesForSubset(
		repo: string,
		nodeNames: string[],
		limit = KG_MAX_GRAPH_EDGES,
		probe = false
	): Array<{ source: string; target: string; relation_type: string; confidence: number }> {
		return queries.listGraphEdgesForSubset(this.runner, repo, nodeNames, limit, probe);
	}

	/** Entities for the unified graph — optionally scoped to a repo. */
	listEntitiesForGraph(repo: string | undefined, limit: number): KgEntityRow[] {
		return queries.listEntitiesForGraph(this.runner, repo, limit);
	}

	/** Relations for the unified graph; when `entityNames` given only edges with BOTH endpoints in the subset (TASK-068/S2, TASK-070). */
	listRelationsForGraph(repo: string | undefined, entityNames?: string[], limit = KG_MAX_GRAPH_EDGES): KgRelationRow[] {
		return queries.listRelationsForGraph(this.runner, repo, entityNames, limit);
	}

	// -----------------------------------------------------------------------
	// Deletes
	// -----------------------------------------------------------------------

	/** Delete all observations, relations and entities for a repo — atomic. Returns entities deleted. */
	deleteRepoEntities(repo: string): number {
		return this.transaction(() => {
			this.run("DELETE FROM observations WHERE repo = ?", [repo]);
			this.run("DELETE FROM relations WHERE repo = ?", [repo]);
			const result = this.run("DELETE FROM entities WHERE repo = ?", [repo]);
			return result.changes;
		});
	}

	/** Delete all observations + relations referencing an entity, then the entity — atomic. */
	deleteEntityWithObservations(entityName: string, repo: string): boolean {
		return this.transaction(() => {
			this.run("DELETE FROM observations WHERE entity_name = ? AND repo = ?", [entityName, repo]);
			this.run("DELETE FROM relations WHERE (from_entity = ? OR to_entity = ?) AND repo = ?", [
				entityName,
				entityName,
				repo
			]);
			this.run("DELETE FROM entities WHERE name = ? AND repo = ?", [entityName, repo]);
			return true;
		});
	}

	/**
	 * Delete orphan entities GLOBALLY (repo-agnostic) — not referenced by ANY
	 * observation or relation in ANY repo. TASK-043: safe ONLY from a
	 * repo-agnostic maintenance pass (soul-maintenance).
	 */
	deleteOrphanEntities(): number {
		const result = this.run(`DELETE FROM entities WHERE name NOT IN (
			SELECT DISTINCT entity_name FROM observations
			UNION
			SELECT DISTINCT from_entity FROM relations
			UNION
			SELECT DISTINCT to_entity FROM relations
		)`);
		return result.changes;
	}

	/**
	 * Remove observations matching (text, repo) pairs — REPO-SCOPED — then
	 * sweep orphan entities once — atomic. Cross-repo safety (TASK-043):
	 * observation delete is repo-scoped, entity DELETE scoped to touched repos,
	 * and the reference UNION is deliberately GLOBAL so a delete cannot
	 * cascade across repos. `deleteOrphanEntities()` remains for maintenance.
	 */
	deleteObservationsAndOrphans(items: Array<{ text: string; repo: string }>): number {
		return this.transaction(() => {
			const deleteObservation = this.db.prepare("DELETE FROM observations WHERE observation = ? AND repo = ?");
			for (const item of items) {
				deleteObservation.run(item.text, item.repo);
			}

			const repos = [...new Set(items.map((i) => i.repo))];
			let orphanCount = 0;
			if (repos.length > 0) {
				const sweep = this.db.prepare(`DELETE FROM entities WHERE repo = ? AND name NOT IN (
					SELECT DISTINCT entity_name FROM observations
					UNION
					SELECT DISTINCT from_entity FROM relations
					UNION
					SELECT DISTINCT to_entity FROM relations
				)`);
				for (const repo of repos) {
					orphanCount += sweep.run(repo).changes;
				}
			}
			return orphanCount;
		});
	}

	/** Delete an observation by id (dashboard). Returns rows changed. */
	deleteObservation(id: string): { changes: number } {
		return this.run("DELETE FROM observations WHERE id = ?", [id]);
	}

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

	/** Delete observations created before the cutoff (legacy age-only prune; no orphan sweep). */
	deleteObservationsOlderThan(cutoff: string): number {
		const result = this.run("DELETE FROM observations WHERE created_at < ?", [cutoff]);
		return result.changes;
	}

	/** Delete a relation by its composite key (dashboard). Returns rows changed. */
	deleteRelation(from_entity: string, to_entity: string, relation_type: string): { changes: number } {
		return this.run("DELETE FROM relations WHERE from_entity = ? AND to_entity = ? AND relation_type = ?", [
			from_entity,
			to_entity,
			relation_type
		]);
	}

	/** Delete an entity by name (dashboard). Observations/relations removed via FK ON DELETE CASCADE. */
	deleteEntity(name: string): { changes: number } {
		return this.run("DELETE FROM entities WHERE name = ?", [name]);
	}
}
