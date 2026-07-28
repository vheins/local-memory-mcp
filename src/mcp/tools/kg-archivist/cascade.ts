import { SQLiteStore } from "../../storage/sqlite";
import { logger } from "../../utils/logger";

/**
 * Delete all entities and relations associated with a given repo.
 * Returns the number of entities deleted.
 */
export function deleteRepoEntities(repo: string, db: SQLiteStore): number {
	try {
		// Observations cascade from entities via FK if configured, else delete explicitly
		db.db.prepare("DELETE FROM observations WHERE repo = ?").run(repo);
		db.db.prepare("DELETE FROM relations WHERE repo = ?").run(repo);
		const result = db.db.prepare("DELETE FROM entities WHERE repo = ?").run(repo);
		logger.info("[KG-Archivist] Deleted entities for repo", { repo, changes: result.changes });
		return result.changes;
	} catch (error) {
		logger.warn("[KG-Archivist] Failed to delete repo entities", { error: String(error), repo });
		return 0;
	}
}

/**
 * Delete orphan entities (entities not referenced by any observation or relation).
 * Useful cleanup after removing memories, tasks, or standards.
 */
export function deleteOrphanEntities(db: SQLiteStore): number {
	try {
		const result = db.db
			.prepare(
				`DELETE FROM entities WHERE name NOT IN (
					SELECT DISTINCT entity_name FROM observations
					UNION
					SELECT DISTINCT from_entity FROM relations
					UNION
					SELECT DISTINCT to_entity FROM relations
				)`
			)
			.run();
		logger.info("[KG-Archivist] Deleted orphan entities", { changes: result.changes });
		return result.changes;
	} catch (error) {
		logger.warn("[KG-Archivist] Failed to delete orphan entities", { error: String(error) });
		return 0;
	}
}

/**
 * Delete all observations referencing a given entity name, then optionally
 * clean up the entity itself.
 */
export function deleteEntityWithObservations(entityName: string, repo: string, db: SQLiteStore): boolean {
	try {
		db.db.prepare("DELETE FROM observations WHERE entity_name = ? AND repo = ?").run(entityName, repo);
		db.db
			.prepare("DELETE FROM relations WHERE (from_entity = ? OR to_entity = ?) AND repo = ?")
			.run(entityName, entityName, repo);
		db.db.prepare("DELETE FROM entities WHERE name = ? AND repo = ?").run(entityName, repo);
		return true;
	} catch (error) {
		logger.warn("[KG-Archivist] Failed to delete entity with observations", {
			error: String(error),
			entityName,
			repo
		});
		return false;
	}
}
