import { BaseEntity } from "../storage/base";

// ---------------------------------------------------------------------------
// Row shapes for the KG tables (entities / relations / observations)
// ---------------------------------------------------------------------------

export interface KgEntityRow {
	name: string;
	type: string;
	description: string | null;
	repo: string;
	owner: string;
	created_at: string;
	updated_at: string;
}

export interface KgRelationRow {
	from_entity: string;
	to_entity: string;
	relation_type: string;
	repo: string;
	owner: string;
	created_at: string;
}

export interface KgObservationRow {
	id: string;
	entity_name: string;
	observation: string;
	repo: string;
	owner: string;
	created_at: string;
}

// ---------------------------------------------------------------------------
// KnowledgeGraphEntity
// ---------------------------------------------------------------------------

/**
 * Single encapsulation point for ALL raw SQL against the knowledge-graph
 * tables (`entities`, `relations`, `observations`).
 *
 * Consumers (kg-archivist tools, memory/task/standard delete tools, dashboard
 * KG controllers) must go through this entity — no `db.db.prepare(...)` on KG
 * tables outside of this file.
 *
 * Cascade deletes (`deleteRepoEntities`, `deleteEntityWithObservations`,
 * `deleteObservationsAndOrphans`) run inside `db.transaction` so a mid-cascade
 * failure rolls back the whole operation.
 */
export class KnowledgeGraphEntity extends BaseEntity {
	// -----------------------------------------------------------------------
	// Writes
	// -----------------------------------------------------------------------

	/**
	 * Insert an entity, ignoring duplicates (entities.name is the primary key).
	 */
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

	/**
	 * Insert a relation, ignoring duplicates (composite PK on
	 * from_entity, to_entity, relation_type).
	 */
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
	 * Insert an observation record.
	 *
	 * Uses INSERT OR IGNORE against the unique (entity_name, observation)
	 * index (migration v9) so the embedding/KG worker's lease-recovery
	 * reprocessing is idempotent — a crash window never duplicates an
	 * observation (TASK-013 acceptance: zero duplicate observations).
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

	/**
	 * Dashboard/admin create: plain INSERT (throws on duplicate name so the
	 * caller can surface a PK conflict).
	 */
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

	/**
	 * Dashboard/admin create: plain INSERT (throws on duplicate relation so
	 * the caller can surface a 409).
	 */
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
	// Reads
	// -----------------------------------------------------------------------

	/**
	 * Fetch entity name/type rows for the given names, scoped to a repo.
	 */
	getEntitiesFor(entityNames: string[], repo: string): Array<{ name: string; type: string }> {
		if (entityNames.length === 0) return [];
		const placeholders = entityNames.map(() => "?").join(",");
		return this.all<{ name: string; type: string }>(
			`SELECT name, type FROM entities WHERE name IN (${placeholders}) AND repo = ?`,
			[...entityNames, repo]
		);
	}

	/**
	 * Fetch relations touching any of the given entity names, scoped to a repo.
	 */
	getRelationsFor(entityNames: string[], repo: string): Array<{ from: string; to: string; type: string }> {
		if (entityNames.length === 0) return [];
		const placeholders = entityNames.map(() => "?").join(",");
		return this.all<{ from: string; to: string; type: string }>(
			`SELECT from_entity AS "from", to_entity AS "to", relation_type AS type
			 FROM relations WHERE (from_entity IN (${placeholders}) OR to_entity IN (${placeholders})) AND repo = ?`,
			[...entityNames, ...entityNames, repo]
		);
	}

	/**
	 * Entity names referenced by a single exact observation text.
	 */
	getEntityNamesByObservation(observation: string, repo: string): string[] {
		const rows = this.all<{ entity_name: string }>(
			"SELECT DISTINCT entity_name FROM observations WHERE observation = ? AND repo = ?",
			[observation, repo]
		);
		return rows.map((r) => r.entity_name);
	}

	/**
	 * Entity names referenced by any of the given exact observation texts.
	 */
	getEntityNamesByObservations(observations: string[], repo: string): string[] {
		if (observations.length === 0) return [];
		const placeholders = observations.map(() => "?").join(",");
		const rows = this.all<{ entity_name: string }>(
			`SELECT DISTINCT entity_name FROM observations WHERE observation IN (${placeholders}) AND repo = ?`,
			[...observations, repo]
		);
		return rows.map((r) => r.entity_name);
	}

	/**
	 * Entity names whose name is a substring of the given search text
	 * (used to match task title/description text against known entities).
	 */
	getEntityNamesByText(repo: string, text: string, distinct = false): string[] {
		const rows = this.all<{ name: string }>(
			`SELECT ${distinct ? "DISTINCT " : ""}name FROM entities WHERE repo = ? AND INSTR(?, name) > 0`,
			[repo, text]
		);
		return rows.map((r) => r.name);
	}

	/**
	 * Whether an entity with the given name exists.
	 */
	entityExists(name: string): boolean {
		return this.get<{ present: number }>("SELECT 1 AS present FROM entities WHERE name = ?", [name]) !== undefined;
	}

	/**
	 * Full entity row by name (dashboard detail).
	 */
	getEntityByName(name: string): KgEntityRow | undefined {
		return this.get<KgEntityRow>("SELECT * FROM entities WHERE name = ?", [name]);
	}

	/**
	 * Full relation rows touching the given entity (dashboard detail).
	 */
	getRelationsByName(name: string): KgRelationRow[] {
		return this.all<KgRelationRow>(
			"SELECT * FROM relations WHERE from_entity = ? OR to_entity = ? ORDER BY relation_type",
			[name, name]
		);
	}

	/**
	 * Full observation rows for the given entity (dashboard detail).
	 */
	getObservationsByName(name: string): KgObservationRow[] {
		return this.all<KgObservationRow>("SELECT * FROM observations WHERE entity_name = ? ORDER BY created_at DESC", [
			name
		]);
	}

	/**
	 * Entities scoped to a repo with optional type/search filters (dashboard).
	 */
	listEntities(repo: string, options?: { type?: string; search?: string }): KgEntityRow[] {
		let sql = "SELECT * FROM entities WHERE repo = ?";
		const params: unknown[] = [repo];
		if (options?.type) {
			sql += " AND type = ?";
			params.push(options.type);
		}
		if (options?.search) {
			sql += " AND name LIKE ?";
			params.push(`%${options.search}%`);
		}
		sql += " ORDER BY name";
		return this.all<KgEntityRow>(sql, params);
	}

	/**
	 * All relations scoped to a repo (dashboard).
	 */
	listRelations(repo: string): KgRelationRow[] {
		return this.all<KgRelationRow>("SELECT * FROM relations WHERE repo = ? ORDER BY from_entity, to_entity", [repo]);
	}

	/**
	 * Graph nodes for a repo (dashboard): entity name + type.
	 */
	listGraphNodes(repo: string): Array<{ name: string; type: string }> {
		return this.all<{ name: string; type: string }>(
			`SELECT e.name, e.type
			 FROM entities e
			 WHERE e.repo = ?
			 ORDER BY e.name`,
			[repo]
		);
	}

	/**
	 * Graph edges for a repo (dashboard): relations joined against entities on
	 * both ends so dangling references never surface.
	 */
	listGraphEdges(repo: string): Array<{ source: string; target: string; relation_type: string }> {
		return this.all<{ source: string; target: string; relation_type: string }>(
			`SELECT r.from_entity as source, r.to_entity as target, r.relation_type
			 FROM relations r
			 INNER JOIN entities e1 ON r.from_entity = e1.name AND r.repo = e1.repo
			 INNER JOIN entities e2 ON r.to_entity = e2.name AND r.repo = e2.repo
			 WHERE r.repo = ?
			 ORDER BY r.from_entity, r.to_entity`,
			[repo]
		);
	}

	/**
	 * Entities for the unified graph — optionally scoped to a repo.
	 */
	listEntitiesForGraph(repo: string | undefined, limit: number): KgEntityRow[] {
		if (repo) {
			return this.all<KgEntityRow>("SELECT * FROM entities WHERE repo = ? ORDER BY name LIMIT ?", [repo, limit]);
		}
		return this.all<KgEntityRow>("SELECT * FROM entities ORDER BY name LIMIT ?", [limit]);
	}

	/**
	 * Relations for the unified graph — optionally scoped to a repo.
	 */
	listRelationsForGraph(repo: string | undefined): KgRelationRow[] {
		if (repo) {
			return this.all<KgRelationRow>("SELECT * FROM relations WHERE repo = ? ORDER BY from_entity, to_entity", [repo]);
		}
		return this.all<KgRelationRow>("SELECT * FROM relations ORDER BY from_entity, to_entity");
	}

	// -----------------------------------------------------------------------
	// Deletes
	// -----------------------------------------------------------------------

	/**
	 * Delete all observations, relations and entities for a repo — atomic.
	 * Returns the number of entities deleted.
	 */
	deleteRepoEntities(repo: string): number {
		return this.transaction(() => {
			this.run("DELETE FROM observations WHERE repo = ?", [repo]);
			this.run("DELETE FROM relations WHERE repo = ?", [repo]);
			const result = this.run("DELETE FROM entities WHERE repo = ?", [repo]);
			return result.changes;
		});
	}

	/**
	 * Delete all observations + relations referencing an entity, then the
	 * entity itself — atomic. Returns true on success, false on failure.
	 */
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
	 * Delete orphan entities GLOBALLY (repo-agnostic) — entities not
	 * referenced by ANY observation OR relation in ANY repo (UNION of
	 * observations.entity_name, relations.from_entity and relations.to_entity).
	 * An entity still referenced by a relation is KEPT.
	 *
	 * TASK-043: this is the deliberate cross-repo sweep, safe ONLY when run
	 * from a repo-agnostic maintenance pass (soul-maintenance). The
	 * repo-scoped delete tools must use `deleteObservationsAndOrphans`
	 * instead, which scopes the DELETE to the touched repos while keeping the
	 * reference check global.
	 * Returns the number of entities deleted.
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
	 * Remove observation records whose exact text matches any of the given
	 * (text, repo) pairs — REPO-SCOPED — then sweep orphan entities once —
	 * atomic (single transaction).
	 *
	 * Used by memory/task/standard delete tools: observations for deleted
	 * items are removed in one batch (scoped to each item's own repo, so
	 * identical titles in different repos never cross-delete each other's
	 * observations), then the orphan sweep runs ONCE with the correct
	 * observations UNION relations check (never per-item).
	 *
	 * Cross-repo safety (TASK-043): `entities.name` is a GLOBAL primary key
	 * while `observations`/`relations` carry `repo`, so deleting an entity
	 * FK-cascades its observations/relations in EVERY repo. To guarantee a
	 * repo-A delete never removes repo-B rows:
	 *   1. The observation delete is scoped by repo (`AND repo = ?`).
	 *   2. The entity DELETE is scoped to the touched repos (`WHERE repo = ?`).
	 *   3. The reference UNION is deliberately GLOBAL — an entity is only
	 *      deleted when NO observation/relation in ANY repo references it,
	 *      so deleting it cannot cascade anything (foreign rows are
	 *      provably absent). The repo-agnostic global sweep remains
	 *      available as `deleteOrphanEntities()` for soul-maintenance.
	 * Returns the number of orphan entities deleted.
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

	/**
	 * Delete an observation by id (dashboard). Returns rows changed.
	 */
	deleteObservation(id: string): { changes: number } {
		return this.run("DELETE FROM observations WHERE id = ?", [id]);
	}

	/**
	 * Delete observations created before the given ISO cutoff timestamp.
	 * Used by soul-maintenance to prune stale observations (no orphan sweep —
	 * entities may legitimately outlive a single observation).
	 * Returns the number of rows deleted.
	 */
	deleteObservationsOlderThan(cutoff: string): number {
		const result = this.run("DELETE FROM observations WHERE created_at < ?", [cutoff]);
		return result.changes;
	}

	/**
	 * Delete a relation by its composite key (dashboard). Returns rows changed.
	 */
	deleteRelation(from_entity: string, to_entity: string, relation_type: string): { changes: number } {
		return this.run("DELETE FROM relations WHERE from_entity = ? AND to_entity = ? AND relation_type = ?", [
			from_entity,
			to_entity,
			relation_type
		]);
	}

	/**
	 * Delete an entity by name (dashboard). Observations and relations are
	 * removed via FK ON DELETE CASCADE. Returns rows changed.
	 */
	deleteEntity(name: string): { changes: number } {
		return this.run("DELETE FROM entities WHERE name = ?", [name]);
	}
}
