import { BaseEntity } from "../../storage/base";
import { logger } from "../../utils/logger";
import { KG_MAX_CONTEXT_ENTITIES, KG_MAX_GRAPH_EDGES } from "../../utils/constants";
import * as queries from "./queries";
import type { KgQueryRunner, KgEntityRow, KgRelationRow, KgObservationRow } from "./queries";

/**
 * Single encapsulation point for ALL raw SQL against the knowledge-graph
 * tables. Read/query SQL lives in `./queries` (TASK-176); writes and
 * cascade deletes stay here and run inside `db.transaction`.
 */
export class KnowledgeGraphEntity extends BaseEntity {
	/** Read accessor exposing protected BaseEntity helpers to `./queries` (TASK-176). */
	private get runner(): KgQueryRunner {
		return {
			all: <T>(sql: string, params: unknown[] = []) => this.all<T>(sql, params),
			get: <T>(sql: string, params: unknown[] = []) => this.get<T>(sql, params)
		};
	}

	// -----------------------------------------------------------------------
	// Writes
	// -----------------------------------------------------------------------

	/** Insert an entity, ignoring duplicates (entities.name is the primary key). */
	upsertEntity(params: {
		name: string;
		type: string;
		description: string | null;
		repo: string;
		owner: string;
		created_at: string;
		updated_at: string;
	}): void {
		this.run(
			`INSERT OR IGNORE INTO entities (name, type, description, repo, owner, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[params.name, params.type, params.description, params.repo, params.owner, params.created_at, params.updated_at]
		);
	}

	/** Insert a relation, ignoring duplicates (composite PK on from_entity, to_entity, relation_type). */
	upsertRelation(params: {
		from_entity: string;
		to_entity: string;
		relation_type: string;
		repo: string;
		owner: string;
		created_at: string;
	}): void {
		this.run(
			`INSERT OR IGNORE INTO relations (from_entity, to_entity, relation_type, repo, owner, created_at)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			[params.from_entity, params.to_entity, params.relation_type, params.repo, params.owner, params.created_at]
		);
	}

	/**
	 * Resolve-or-upsert BOTH endpoints (global PK) then insert the relation —
	 * idempotent against orphan-swept endpoints (TASK-065 / MEM-473). ATOMIC
	 * (TASK-067 fix #2 / TASK-072): both upserts + insert run in one BEGIN
	 * IMMEDIATE (base.ts immediate, TASK-064 / MEM-475).
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
				created_at: params.created_at
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
	insertObservation(params: {
		id: string;
		entity_name: string;
		observation: string;
		repo: string;
		owner: string;
		created_at: string;
	}): void {
		this.run(
			`INSERT OR IGNORE INTO observations (id, entity_name, observation, repo, owner, created_at)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			[params.id, params.entity_name, params.observation, params.repo, params.owner, params.created_at]
		);
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
							created_at
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
	createEntity(params: {
		name: string;
		type: string;
		description: string | null;
		repo: string;
		owner: string;
		created_at: string;
		updated_at: string;
	}): void {
		this.run(
			`INSERT INTO entities (name, type, description, repo, owner, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[params.name, params.type, params.description, params.repo, params.owner, params.created_at, params.updated_at]
		);
	}

	/** Dashboard/admin create: plain INSERT (throws on duplicate relation → 409). */
	createRelation(params: {
		from_entity: string;
		to_entity: string;
		relation_type: string;
		repo: string;
		owner: string;
		created_at: string;
	}): void {
		this.run(
			`INSERT INTO relations (from_entity, to_entity, relation_type, repo, owner, created_at)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			[params.from_entity, params.to_entity, params.relation_type, params.repo, params.owner, params.created_at]
		);
	}

	// -----------------------------------------------------------------------
	// Reads (delegated to ./queries — TASK-176)
	// -----------------------------------------------------------------------

	/** Fetch entity name/type rows for the given names, scoped to a repo. */
	getEntitiesFor(entityNames: string[], repo: string): Array<{ name: string; type: string }> {
		return queries.getEntitiesFor(this.runner, entityNames, repo);
	}

	/** Fetch relations touching any of the given entity names, scoped to a repo. */
	getRelationsFor(entityNames: string[], repo: string): Array<{ from: string; to: string; type: string }> {
		return queries.getRelationsFor(this.runner, entityNames, repo);
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

	/** Graph edges capped to the top-N by endpoint degree (TASK-068/S2, TASK-070); probe detects truncation (TASK-148). */
	listGraphEdges(
		repo: string,
		limit = KG_MAX_GRAPH_EDGES,
		probe = false
	): Array<{ source: string; target: string; relation_type: string }> {
		return queries.listGraphEdges(this.runner, repo, limit, probe);
	}

	/** Graph edges restricted to a node subset (both endpoints in `nodeNames`), degree-ranked via the kg_degrees cache (TASK-268); probe detects truncation (TASK-148). */
	listGraphEdgesForSubset(
		repo: string,
		nodeNames: string[],
		limit = KG_MAX_GRAPH_EDGES,
		probe = false
	): Array<{ source: string; target: string; relation_type: string }> {
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

	/** Delete observations created before the cutoff (soul-maintenance prune; no orphan sweep). */
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
