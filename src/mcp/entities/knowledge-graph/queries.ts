import { logger } from "../../utils/logger";
import { KG_MAX_CONTEXT_ENTITIES, KG_CONTEXT_TEXT_TOKENS, KG_MAX_GRAPH_EDGES } from "../../utils/constants";

// ---------------------------------------------------------------------------
// Query runner (TASK-176)
// ---------------------------------------------------------------------------

/**
 * Minimal read-only SQL accessor implemented by KnowledgeGraphEntity so the
 * standalone query functions in this module can execute through the shared
 * prepared-statement cache without widening BaseEntity's protected surface.
 */
export interface KgQueryRunner {
	all<T = unknown>(sql: string, params?: unknown[]): T[];
	get<T = unknown>(sql: string, params?: unknown[]): T | undefined;
}

// ---------------------------------------------------------------------------
// Tokenizer for entity-name resolution (OPT-PERF-04)
// ---------------------------------------------------------------------------

/**
 * Split arbitrary text into lowercase alphanumeric tokens, mirroring FTS5's
 * unicode61 tokenizer for ASCII input (case-fold, split on any
 * non-alphanumeric). Used to turn task title/description text into the
 * `entity_names_fts` MATCH query terms. Entity names are code identifiers
 * (ASCII), so the approximation is exact for realistic corpora.
 */
function tokenizeKgText(text: string): string[] {
	return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 0);
}

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
// Reads
// ---------------------------------------------------------------------------

/**
 * Fetch entity name/type rows for the given names, scoped to a repo.
 */
export function getEntitiesFor(
	runner: KgQueryRunner,
	entityNames: string[],
	repo: string
): Array<{ name: string; type: string }> {
	if (entityNames.length === 0) return [];
	const placeholders = entityNames.map(() => "?").join(",");
	return runner.all<{ name: string; type: string }>(
		`SELECT name, type FROM entities WHERE name IN (${placeholders}) AND repo = ?`,
		[...entityNames, repo]
	);
}

/**
 * Fetch relations touching any of the given entity names, scoped to a repo.
 */
export function getRelationsFor(
	runner: KgQueryRunner,
	entityNames: string[],
	repo: string
): Array<{ from: string; to: string; type: string }> {
	if (entityNames.length === 0) return [];
	const placeholders = entityNames.map(() => "?").join(",");
	return runner.all<{ from: string; to: string; type: string }>(
		`SELECT from_entity AS "from", to_entity AS "to", relation_type AS type
		 FROM relations WHERE (from_entity IN (${placeholders}) OR to_entity IN (${placeholders})) AND repo = ?`,
		[...entityNames, ...entityNames, repo]
	);
}

/**
 * Entity names referenced by a single exact observation text.
 */
export function getEntityNamesByObservation(runner: KgQueryRunner, observation: string, repo: string): string[] {
	const rows = runner.all<{ entity_name: string }>(
		"SELECT DISTINCT entity_name FROM observations WHERE observation = ? AND repo = ?",
		[observation, repo]
	);
	return rows.map((r) => r.entity_name);
}

/**
 * Entity names referenced by any of the given exact observation texts.
 */
export function getEntityNamesByObservations(runner: KgQueryRunner, observations: string[], repo: string): string[] {
	if (observations.length === 0) return [];
	const placeholders = observations.map(() => "?").join(",");
	const rows = runner.all<{ entity_name: string }>(
		`SELECT DISTINCT entity_name FROM observations WHERE observation IN (${placeholders}) AND repo = ?`,
		[...observations, repo]
	);
	return rows.map((r) => r.entity_name);
}

/**
 * Entity names related to the given search text.
 *
 * OPT-PERF-04: the old `INSTR(?, name) > 0` scan walked EVERY entity row
 * with no LIMIT on every task-read (the hottest read path). This now
 * resolves names through the `entity_names_fts` token index (migration
 * v15): the search text is split into unicode61-style tokens, OR'd into a
 * single MATCH query, and looked up index-scoped with a LIMIT.
 *
 * Matching semantics: FTS5 token-boundary, case-insensitive matching (any
 * name token present in the search text) replaces the old case-sensitive
 * contiguous-substring (INSTR) rule. A single-token entity name matches
 * when the name appears as a standalone token in the search text; mid-word
 * (~substring) and case-variant behavior differs from the old INSTR rule.
 * Multi-token names are matched by ANY token overlap (more permissive).
 * Rows are ORDER BY rank (FTS5 bm25 + repo filter), so the LIMIT keeps the
 * highest-relevance names; both are bounded by `limit`
 * (KG_MAX_CONTEXT_ENTITIES), so enrichment cost is capped regardless of
 * match breadth.
 *
 * Degraded fallback (index absent, e.g. pre-v15 DB or rollback): the
 * INSTR scan still runs, but LIMIT-bounded — bounded output, scan cost
 * bounded by the entities table only in that fallback path.
 */
export function getEntityNamesByText(
	runner: KgQueryRunner,
	repo: string,
	text: string,
	limit = KG_MAX_CONTEXT_ENTITIES
): string[] {
	const tokens = [...new Set(tokenizeKgText(text))];
	if (tokens.length === 0) return [];

	const queryTokens = tokens.slice(0, KG_CONTEXT_TEXT_TOKENS);
	const matchQuery = queryTokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(" OR ");

	try {
		const rows = runner.all<{ name: string }>(
			"SELECT name, rank FROM entity_names_fts WHERE repo = ? AND entity_names_fts MATCH ? ORDER BY rank LIMIT ?",
			[repo, matchQuery, limit]
		);
		return rows.map((r) => r.name);
	} catch (error) {
		logger.warn("[KG] FTS entity-name lookup failed, falling back to bounded INSTR", {
			error: String(error)
		});
		const rows = runner.all<{ name: string }>(
			"SELECT name FROM entities WHERE repo = ? AND INSTR(?, name) > 0 LIMIT ?",
			[repo, text, limit]
		);
		return rows.map((r) => r.name);
	}
}

/**
 * Whether an entity with the given name exists.
 */
export function entityExists(runner: KgQueryRunner, name: string): boolean {
	return runner.get<{ present: number }>("SELECT 1 AS present FROM entities WHERE name = ?", [name]) !== undefined;
}

/**
 * Full entity row by name (dashboard detail).
 */
export function getEntityByName(runner: KgQueryRunner, name: string): KgEntityRow | undefined {
	return runner.get<KgEntityRow>("SELECT * FROM entities WHERE name = ?", [name]);
}

/**
 * Full relation rows touching the given entity (dashboard detail).
 */
export function getRelationsByName(runner: KgQueryRunner, name: string): KgRelationRow[] {
	return runner.all<KgRelationRow>(
		"SELECT * FROM relations WHERE from_entity = ? OR to_entity = ? ORDER BY relation_type",
		[name, name]
	);
}

/**
 * Full observation rows for the given entity (dashboard detail).
 */
export function getObservationsByName(runner: KgQueryRunner, name: string): KgObservationRow[] {
	return runner.all<KgObservationRow>("SELECT * FROM observations WHERE entity_name = ? ORDER BY created_at DESC", [
		name
	]);
}

/**
 * Entities scoped to a repo with optional type/search filters (dashboard).
 * Supports limit/offset pagination; when omitted returns all matching rows.
 */
export function listEntities(
	runner: KgQueryRunner,
	repo: string,
	options?: { type?: string; search?: string; limit?: number; offset?: number }
): KgEntityRow[] {
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
	if (options?.limit !== undefined) {
		sql += " LIMIT ?";
		params.push(options.limit);
	}
	if (options?.offset !== undefined) {
		sql += " OFFSET ?";
		params.push(options.offset);
	}
	return runner.all<KgEntityRow>(sql, params);
}

/**
 * Count entities matching the given filters (for pagination total).
 */
export function countEntities(
	runner: KgQueryRunner,
	repo: string,
	options?: { type?: string; search?: string }
): number {
	let sql = "SELECT COUNT(*) AS cnt FROM entities WHERE repo = ?";
	const params: unknown[] = [repo];
	if (options?.type) {
		sql += " AND type = ?";
		params.push(options.type);
	}
	if (options?.search) {
		sql += " AND name LIKE ?";
		params.push(`%${options.search}%`);
	}
	return runner.get<{ cnt: number }>(sql, params)?.cnt ?? 0;
}

/**
 * All relations scoped to a repo (dashboard).
 * Supports limit/offset pagination; when omitted returns all matching rows.
 */
export function listRelations(
	runner: KgQueryRunner,
	repo: string,
	options?: { limit?: number; offset?: number }
): KgRelationRow[] {
	let sql = "SELECT * FROM relations WHERE repo = ? ORDER BY from_entity, to_entity";
	const params: unknown[] = [repo];
	if (options?.limit !== undefined) {
		sql += " LIMIT ?";
		params.push(options.limit);
	}
	if (options?.offset !== undefined) {
		sql += " OFFSET ?";
		params.push(options.offset);
	}
	return runner.all<KgRelationRow>(sql, params);
}

/**
 * Count relations scoped to a repo (for pagination total).
 */
export function countRelations(runner: KgQueryRunner, repo: string): number {
	return runner.get<{ cnt: number }>("SELECT COUNT(*) AS cnt FROM relations WHERE repo = ?", [repo])?.cnt ?? 0;
}

/**
 * Graph nodes for a repo (dashboard): entity name + type.
 *
 * Ordered by edge degree (highest first) so that each paginated page is a
 * coherent window of the highest-connectivity nodes that the top-K edges
 * actually connect — alphabetical ordering scattered degree-high nodes
 * across pages, causing near-zero edge coverage per page (TASK-145).
 * Falls back to name ordering for nodes with identical degree.
 * Supports limit/offset pagination; when omitted returns all matching rows.
 */
export function listGraphNodes(
	runner: KgQueryRunner,
	repo: string,
	options?: { limit?: number; offset?: number }
): Array<{ name: string; type: string }> {
	let sql = `WITH degrees AS (
		   SELECT node, COUNT(*) AS degree
		   FROM (
		     SELECT from_entity AS node FROM relations WHERE repo = ?
		     UNION ALL
		     SELECT to_entity AS node FROM relations WHERE repo = ?
		   )
		   GROUP BY node
		 )
		 SELECT e.name, e.type
		 FROM entities e
		 LEFT JOIN degrees d ON d.node = e.name
		 WHERE e.repo = ?
		 ORDER BY COALESCE(d.degree, 0) DESC, e.name`;
	const params: unknown[] = [repo, repo, repo];
	if (options?.limit !== undefined) {
		sql += " LIMIT ?";
		params.push(options.limit);
	}
	if (options?.offset !== undefined) {
		sql += " OFFSET ?";
		params.push(options.offset);
	}
	return runner.all<{ name: string; type: string }>(sql, params);
}

/**
 * Count graph nodes for a repo (for pagination total).
 */
export function countGraphNodes(runner: KgQueryRunner, repo: string): number {
	return runner.get<{ cnt: number }>("SELECT COUNT(*) AS cnt FROM entities e WHERE e.repo = ?", [repo])?.cnt ?? 0;
}

/**
 * Graph edges for a repo (dashboard): relations joined against entities on
 * both ends so dangling references never surface.
 *
 * Server-side cap (TASK-068 S2 / TASK-070): returns the top-N highest-value
 * edges ranked by endpoint degree (degree(from) + degree(to), computed once
 * per node in a CTE) instead of serializing the whole relations table. The
 * client culls to 2,000 edges anyway (TASK-063), so shipping only the
 * highest-degree edges keeps the payload at a few hundred KB and avoids the
 * per-request 3-way join + sort over ALL relations.
 *
 * @param runner - Query accessor
 * @param repo - Repository scope
 * @param limit - Maximum edges to return (default: KG_MAX_GRAPH_EDGES)
 * @param probe - When true, queries `limit + 1` rows to detect truncation.
 *   Callers can check `result.length > limit` to determine if the graph
 *   was truncated (TASK-148). The extra probe row is never consumed by
 *   the caller — they slice to `limit` before returning to the client.
 * @returns Array of edges (may be `limit + 1` when probe=true)
 */
export function listGraphEdges(
	runner: KgQueryRunner,
	repo: string,
	limit = KG_MAX_GRAPH_EDGES,
	probe = false
): Array<{ source: string; target: string; relation_type: string }> {
	const effectiveLimit = probe ? limit + 1 : limit;
	return runner.all<{ source: string; target: string; relation_type: string }>(
		`WITH degrees AS (
		   SELECT node, COUNT(*) AS degree
		   FROM (
		     SELECT from_entity AS node FROM relations WHERE repo = ?
		     UNION ALL
		     SELECT to_entity AS node FROM relations WHERE repo = ?
		   )
		   GROUP BY node
		 )
		 SELECT r.from_entity as source, r.to_entity as target, r.relation_type
		 FROM relations r
		 INNER JOIN entities e1 ON r.from_entity = e1.name AND r.repo = e1.repo
		 INNER JOIN entities e2 ON r.to_entity = e2.name AND r.repo = e2.repo
		 LEFT JOIN degrees d1 ON d1.node = r.from_entity
		 LEFT JOIN degrees d2 ON d2.node = r.to_entity
		 WHERE r.repo = ?
		 ORDER BY (COALESCE(d1.degree, 0) + COALESCE(d2.degree, 0)) DESC, r.from_entity, r.to_entity
		 LIMIT ?`,
		[repo, repo, repo, effectiveLimit]
	);
}

/**
 * Entities for the unified graph — optionally scoped to a repo.
 */
export function listEntitiesForGraph(runner: KgQueryRunner, repo: string | undefined, limit: number): KgEntityRow[] {
	if (repo) {
		return runner.all<KgEntityRow>("SELECT * FROM entities WHERE repo = ? ORDER BY name LIMIT ?", [repo, limit]);
	}
	return runner.all<KgEntityRow>("SELECT * FROM entities ORDER BY name LIMIT ?", [limit]);
}

/**
 * Relations for the unified graph — optionally scoped to a repo.
 *
 * When `entityNames` is provided, ONLY edges whose BOTH endpoints are in
 * that node subset are returned (TASK-068 S2 / TASK-070): the unified
 * graph caps nodes at `limit` and previously fetched ALL relations, so the
 * payload scaled with the total edge count (~22k) instead of the node cap.
 * Bounded by `limit` (KG_MAX_GRAPH_EDGES) and served by the composite
 * index (repo, from_entity, to_entity) (migration v12).
 */
export function listRelationsForGraph(
	runner: KgQueryRunner,
	repo: string | undefined,
	entityNames?: string[],
	limit = KG_MAX_GRAPH_EDGES
): KgRelationRow[] {
	if (entityNames) {
		// Explicit (possibly empty) subset: empty → no edges, so a graph
		// with zero entity nodes never ships dangling `ent-` edges.
		if (entityNames.length === 0) return [];
		const placeholders = entityNames.map(() => "?").join(",");
		if (repo) {
			return runner.all<KgRelationRow>(
				`SELECT * FROM relations
				 WHERE repo = ? AND from_entity IN (${placeholders}) AND to_entity IN (${placeholders})
				 ORDER BY from_entity, to_entity
				 LIMIT ?`,
				[repo, ...entityNames, ...entityNames, limit]
			);
		}
		return runner.all<KgRelationRow>(
			`SELECT * FROM relations
			 WHERE from_entity IN (${placeholders}) AND to_entity IN (${placeholders})
			 ORDER BY from_entity, to_entity
			 LIMIT ?`,
			[...entityNames, ...entityNames, limit]
		);
	}
	// Legacy behavior (no subset): bounded by the same cap.
	if (repo) {
		return runner.all<KgRelationRow>("SELECT * FROM relations WHERE repo = ? ORDER BY from_entity, to_entity LIMIT ?", [
			repo,
			limit
		]);
	}
	return runner.all<KgRelationRow>("SELECT * FROM relations ORDER BY from_entity, to_entity LIMIT ?", [limit]);
}
