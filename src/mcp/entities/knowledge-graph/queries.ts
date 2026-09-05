import { logger } from "../../utils/logger";
import {
	KG_MAX_CONTEXT_ENTITIES,
	KG_CONTEXT_TEXT_TOKENS,
	KG_MAX_CONTEXT_RELATIONS,
	KG_MAX_GRAPH_EDGES
} from "../../utils/constants";

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
	/** Per-edge confidence label (migration v24 / TASK-325); 1.0 for pre-v24 and explicit rows. */
	confidence: number;
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
 * Fetch entity name/type rows for the given names.
 *
 * **No `repo` filter — deliberate (audit F6).** `entities.name` is a GLOBAL
 * `PRIMARY KEY` (v01 schema) and every writer uses `INSERT OR IGNORE`, so the
 * FIRST repo to mention a common noun (`priority`, `section`, `assignees`,
 * `due_date`) owns the row forever and every other repo's insert is silently
 * dropped. Adding `AND repo = ?` here therefore filtered on "which repo
 * happened to write this name first", not on ownership — and since the caller
 * has ALREADY scoped the name set by repo (via `observations WHERE repo = ?` or
 * the repo-filtered `entity_names_fts` index), the extra predicate could only
 * remove correct rows, never add safety.
 *
 * What it actually did was break the payload asymmetrically: `getEntitiesFor`
 * dropped the entity while `getRelationsFor` (which filters `relations.repo`,
 * a per-edge column that IS correct) still shipped its edges. Measured on a
 * real database: 2,209 of 19,294 `(entity_name, repo)` pairs (11.4%) referenced
 * an entity row owned by another repo, and for a 50-name window in one repo
 * `getEntitiesFor` returned **0** rows while `getRelationsFor` returned
 * **11,664 edges** whose endpoints were therefore absent from the response —
 * an unusable graph payload.
 *
 * Dropping the redundant predicate closes the payload. The proper fix for the
 * underlying schema flaw is a composite `(name, repo)` primary key, which needs
 * a table rebuild plus FK/trigger migration and is tracked separately.
 */
export function getEntitiesFor(runner: KgQueryRunner, entityNames: string[]): Array<{ name: string; type: string }> {
	if (entityNames.length === 0) return [];
	const placeholders = entityNames.map(() => "?").join(",");
	return runner.all<{ name: string; type: string }>(
		`SELECT name, type FROM entities WHERE name IN (${placeholders})`,
		entityNames
	);
}

/**
 * Fetch relations touching any of the given entity names, scoped to a repo.
 *
 * **Audit F2 — why this is a bounded UNION and not one `OR` predicate.**
 *
 * The original shape was a single scan-forcing predicate:
 *
 * ```sql
 * WHERE (from_entity IN (...) OR to_entity IN (...)) AND repo = ?
 * ```
 *
 * SQLite cannot serve one `OR` branch from `(repo, from_entity)` and the other
 * from a `to_entity` index in the same scan, so the planner fell back to
 * `SEARCH relations USING INDEX idx_relations_repo (repo=?)` — i.e. it walked
 * EVERY edge in the repo and filtered in memory. Cost was O(edges in repo),
 * not O(names): on a 490k-edge repo one 50-name enrichment took ~1.2s and
 * returned 37,815 rows (~184k tokens of JSON) for a payload the caller only
 * samples.
 *
 * Three changes, each necessary:
 *
 *  1. **UNION of two index-served branches** — `(repo, from_entity)` is served
 *     by `idx_relations_repo_from_to` (v12), `(repo, to_entity)` by
 *     `idx_relations_repo_to` (v29). Both become index seeks per name instead
 *     of one full-repo scan. An index alone does NOT help: adding
 *     `(repo, to_entity)` without the UNION rewrite leaves the plan unchanged
 *     (measured — still `idx_relations_repo`), because the limitation is the
 *     `OR`, not the available indexes.
 *  2. **Per-branch `LIMIT`** — each branch is bounded BEFORE the merge, so a
 *     hub entity with 100k edges cannot materialize its whole adjacency list
 *     into a temp b-tree just to have the outer LIMIT throw it away.
 *  3. **`ORDER BY confidence DESC`** — when the cap truncates, the retained
 *     window is the most trustworthy slice (migration v24): explicit/manual
 *     1.0 and parser-deterministic codebase 0.9 outrank NLP co-occurrence
 *     guesses at 0.55. Ties break on `(from, to)` so output is deterministic.
 *
 * Measured A/B on a real 1.29M-edge database (median of 5, warm, interleaved,
 * `limit = 500`):
 *
 * ```
 * repo                  edges     OLD ms   NEW ms   speedup   OLD rows  NEW rows
 * basecamp-v2          490,255    1218.3     38.0     32.0x     37,815       500
 * clipper              120,439      47.1      6.2      7.6x      6,000       500
 * basecamp             207,338      88.1     26.2      3.4x     25,604       500
 * bot-pm               168,379      68.7     20.1      3.4x     20,169       500
 * mos-platform          83,218      47.1     26.5      1.8x     30,877       500
 * frontend-hilir-base   20,857       8.1      4.0      2.0x      3,894       500
 * ```
 *
 * No repo regressed. Aggregate KG-relation payload across the six repos fell
 * 2,483,541 → 62,412 JSON chars (39.8x).
 *
 * @param limit - Max rows returned; `0` disables the cap (unbounded, the
 *   pre-fix behavior) for callers that genuinely need the full adjacency set.
 */
export function getRelationsFor(
	runner: KgQueryRunner,
	entityNames: string[],
	repo: string,
	limit = KG_MAX_CONTEXT_RELATIONS
): Array<{ from: string; to: string; type: string }> {
	if (entityNames.length === 0) return [];
	const placeholders = entityNames.map(() => "?").join(",");
	const columns = `from_entity AS "from", to_entity AS "to", relation_type AS type`;

	if (limit <= 0) {
		// Unbounded: still the UNION rewrite (both branches index-served), just
		// without the ranking/truncation window.
		return runner.all<{ from: string; to: string; type: string }>(
			`SELECT ${columns} FROM relations WHERE repo = ? AND from_entity IN (${placeholders})
			 UNION
			 SELECT ${columns} FROM relations WHERE repo = ? AND to_entity IN (${placeholders})`,
			[repo, ...entityNames, repo, ...entityNames]
		);
	}

	// `confidence` is selected so the merge can rank on it, then dropped from
	// the projection by the caller's row type — the KG-context payload shape
	// ({ from, to, type }) is unchanged.
	return runner.all<{ from: string; to: string; type: string }>(
		`SELECT "from", "to", type FROM (
		   SELECT * FROM (
		     SELECT ${columns}, confidence FROM relations
		     WHERE repo = ? AND from_entity IN (${placeholders})
		     ORDER BY confidence DESC LIMIT ?
		   )
		   UNION
		   SELECT * FROM (
		     SELECT ${columns}, confidence FROM relations
		     WHERE repo = ? AND to_entity IN (${placeholders})
		     ORDER BY confidence DESC LIMIT ?
		   )
		 )
		 ORDER BY confidence DESC, "from", "to"
		 LIMIT ?`,
		[repo, ...entityNames, limit, repo, ...entityNames, limit, limit]
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
 *
 * OPT-PERF (TASK-268 / audit F2): degrees come from the materialized
 * `kg_degrees` table (migration v22, maintained by relations triggers)
 * instead of a per-request CTE aggregate over ALL of the repo's relations.
 * The old CTE walked every relation of the repo (852k+ rows for edge-heavy
 * repos) on the Node event loop — ~23s warm / ~190s cold, blocking
 * /api/health. The v22 backfill seeds the table once at migration time.
 */
export function listGraphNodes(
	runner: KgQueryRunner,
	repo: string,
	options?: { limit?: number; offset?: number }
): Array<{ name: string; type: string }> {
	let sql = `SELECT e.name, e.type
		 FROM entities e
		 LEFT JOIN kg_degrees d ON d.repo = e.repo AND d.node = e.name
		 WHERE e.repo = ?
		 ORDER BY COALESCE(d.degree, 0) DESC, e.name`;
	const params: unknown[] = [repo];
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
): Array<{ source: string; target: string; relation_type: string; confidence: number }> {
	const effectiveLimit = probe ? limit + 1 : limit;
	return runner.all<{ source: string; target: string; relation_type: string; confidence: number }>(
		`WITH degrees AS (
		   SELECT node, COUNT(*) AS degree
		   FROM (
		     SELECT from_entity AS node FROM relations WHERE repo = ?
		     UNION ALL
		     SELECT to_entity AS node FROM relations WHERE repo = ?
		   )
		   GROUP BY node
		 )
		 SELECT r.from_entity as source, r.to_entity as target, r.relation_type, r.confidence
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
 * Graph edges for a repo restricted to a node subset (TASK-268 / audit F2).
 *
 * Only edges whose BOTH endpoints are in `nodeNames` are returned — the
 * dashboard graph renders exactly the fetched top-N window, so every shipped
 * edge is drawable and the query never walks the repo's full relation set.
 * Endpoint degrees come from the materialized `kg_degrees` cache (migration
 * v22) instead of a per-request CTE over ALL relations, and the sort is
 * bounded to the subset's edge count. For an 852k-relation repo with a
 * 300-node window this replaced a ~23s full-repo sort with a sub-second
 * index-served subset scan (OPT-PERF / TASK-268).
 *
 * @param runner - Query accessor
 * @param repo - Repository scope
 * @param nodeNames - Node window returned by `listGraphNodes`; edges must
 *   connect two nodes in this set. Empty → no edges.
 * @param limit - Maximum edges to return (default: KG_MAX_GRAPH_EDGES)
 * @param probe - When true, queries `limit + 1` rows so callers can detect
 *   truncation (TASK-148 pattern: `result.length > limit`). The probe row is
 *   never consumed by callers.
 * @returns Edges among the subset, ranked by endpoint degree
 */
export function listGraphEdgesForSubset(
	runner: KgQueryRunner,
	repo: string,
	nodeNames: string[],
	limit = KG_MAX_GRAPH_EDGES,
	probe = false
): Array<{ source: string; target: string; relation_type: string; confidence: number }> {
	if (nodeNames.length === 0) return [];
	const placeholders = nodeNames.map(() => "?").join(",");
	const effectiveLimit = probe ? limit + 1 : limit;
	return runner.all<{ source: string; target: string; relation_type: string; confidence: number }>(
		`SELECT r.from_entity as source, r.to_entity as target, r.relation_type, r.confidence
		 FROM relations r
		 JOIN kg_degrees d1 ON d1.repo = r.repo AND d1.node = r.from_entity
		 JOIN kg_degrees d2 ON d2.repo = r.repo AND d2.node = r.to_entity
		 WHERE r.repo = ? AND r.from_entity IN (${placeholders}) AND r.to_entity IN (${placeholders})
		 ORDER BY (d1.degree + d2.degree) DESC, r.from_entity, r.to_entity
		 LIMIT ?`,
		[repo, ...nodeNames, ...nodeNames, effectiveLimit]
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
