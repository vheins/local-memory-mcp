import { SQLiteStore } from "../../storage/sqlite";
import { logger } from "../../utils/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KgEntityResult {
	name: string;
	type: string;
	source_domain: string;
}

export interface KgRelationResult {
	from: string;
	to: string;
	type: string;
}

export interface KgResult {
	entities: KgEntityResult[];
	relations: KgRelationResult[];
}

// ---------------------------------------------------------------------------
// Shared KG query
// ---------------------------------------------------------------------------

/**
 * Query entities + relations for a given set of entity names.
 * Best-effort — never throws.
 */
export function kgQuery(db: SQLiteStore, repo: string, entityNames: string[], sourceDomain: string): KgResult | null {
	try {
		if (entityNames.length === 0) return { entities: [], relations: [] };

		const uniqueNames = [...new Set(entityNames)];
		const placeholders = uniqueNames.map(() => "?").join(",");

		const entities = db.db
			.prepare<unknown[], KgEntityResult>(
				`SELECT name, type, ? AS source_domain FROM entities WHERE name IN (${placeholders}) AND repo = ?`
			)
			.all(sourceDomain, ...uniqueNames, repo) as KgEntityResult[];

		const relations = db.db
			.prepare<unknown[], KgRelationResult>(
				`SELECT from_entity AS "from", to_entity AS "to", relation_type AS type
				 FROM relations WHERE (from_entity IN (${placeholders}) OR to_entity IN (${placeholders})) AND repo = ?`
			)
			.all(...uniqueNames, ...uniqueNames, repo) as KgRelationResult[];

		return { entities, relations };
	} catch (error) {
		logger.warn("[KG-Archivist] KG query failed", { error: String(error), repo });
		return null;
	}
}

/**
 * Fetch KG entities + relations related to a memory or standard by matching
 * observation text `"Mentioned in {domain}: {title}"`.
 */
export function fetchKgContext(
	db: SQLiteStore,
	repo: string,
	title: string,
	domain: "memory" | "standard"
): KgResult | null {
	try {
		const entityRows = db.db
			.prepare<unknown[], { entity_name: string }>(
				`SELECT DISTINCT entity_name FROM observations WHERE observation = ? AND repo = ?`
			)
			.all(`Mentioned in ${domain}: ${title}`, repo) as { entity_name: string }[];

		if (entityRows.length === 0) return { entities: [], relations: [] };

		return kgQuery(
			db,
			repo,
			entityRows.map((r) => r.entity_name),
			domain
		);
	} catch (error) {
		logger.warn(`[KG-Archivist] KG context fetch failed for ${domain}`, {
			error: String(error),
			title
		});
		return null;
	}
}

/**
 * Aggregate KG context across multiple memory or standard titles.
 */
export function fetchAggregatedKgContext(
	db: SQLiteStore,
	repo: string,
	titles: string[],
	domain: "memory" | "standard"
): KgResult | null {
	try {
		if (titles.length === 0) return { entities: [], relations: [] };

		const patterns = titles.map((t) => `Mentioned in ${domain}: ${t}`);
		const patternPlaceholders = patterns.map(() => "?").join(",");

		const entityRows = db.db
			.prepare<unknown[], { entity_name: string }>(
				`SELECT DISTINCT entity_name FROM observations WHERE observation IN (${patternPlaceholders}) AND repo = ?`
			)
			.all(...patterns, repo) as { entity_name: string }[];

		if (entityRows.length === 0) return { entities: [], relations: [] };

		return kgQuery(db, repo, [...new Set(entityRows.map((r) => r.entity_name))], domain);
	} catch (error) {
		logger.warn(`[KG-Archivist] Aggregated KG context fetch failed for ${domain}`, {
			error: String(error),
			count: titles.length
		});
		return null;
	}
}

/**
 * Fetch KG entities + relations related to a task by matching title/description
 * text against entity names using INSTR. Best-effort — never throws.
 */
export function fetchTaskKgContext(
	db: SQLiteStore,
	repo: string,
	taskTitle: string,
	taskDescription: string
): KgResult | null {
	try {
		const searchText = [taskTitle, taskDescription].filter(Boolean).join(" ");
		if (!searchText.trim()) return { entities: [], relations: [] };

		const entityRows = db.db
			.prepare<unknown[], { name: string }>(`SELECT name FROM entities WHERE repo = ? AND INSTR(?, name) > 0`)
			.all(repo, searchText) as { name: string }[];

		if (entityRows.length === 0) return { entities: [], relations: [] };

		return kgQuery(
			db,
			repo,
			entityRows.map((r) => r.name),
			"task"
		);
	} catch (error) {
		logger.warn("[KG-Archivist] Task KG context fetch failed", {
			error: String(error),
			title: taskTitle
		});
		return null;
	}
}

/**
 * Aggregate KG context across multiple task titles + descriptions.
 */
export function fetchAggregatedTaskKgContext(
	db: SQLiteStore,
	repo: string,
	tasks: Array<{ title: string; description?: string | null }>
): KgResult | null {
	try {
		if (tasks.length === 0) return { entities: [], relations: [] };

		const searchText = tasks
			.map((t) => [t.title, t.description ?? ""].filter(Boolean).join(" "))
			.filter(Boolean)
			.join(" ");
		if (!searchText.trim()) return { entities: [], relations: [] };

		const entityRows = db.db
			.prepare<unknown[], { name: string }>(`SELECT DISTINCT name FROM entities WHERE repo = ? AND INSTR(?, name) > 0`)
			.all(repo, searchText) as { name: string }[];

		if (entityRows.length === 0) return { entities: [], relations: [] };

		return kgQuery(
			db,
			repo,
			entityRows.map((r) => r.name),
			"task"
		);
	} catch (error) {
		logger.warn("[KG-Archivist] Aggregated task KG context fetch failed", {
			error: String(error),
			count: tasks.length
		});
		return null;
	}
}
