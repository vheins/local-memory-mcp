import { SQLiteStore } from "../../storage/sqlite";
import { logger } from "../../utils/logger";

/**
 * Backward-compatible facade over KnowledgeGraphEntity cascade operations.
 * All SQL lives in the entity (entities/knowledge-graph.ts); these helpers
 * preserve the previous function signatures and best-effort (never-throw)
 * semantics used by callers.
 */

/**
 * Delete all entities and relations associated with a given repo.
 * Returns the number of entities deleted.
 */
export function deleteRepoEntities(repo: string, db: SQLiteStore): number {
	try {
		const changes = db.knowledgeGraph.deleteRepoEntities(repo);
		logger.info("[KG-Archivist] Deleted entities for repo", { repo, changes });
		return changes;
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
		const changes = db.knowledgeGraph.deleteOrphanEntities();
		logger.info("[KG-Archivist] Deleted orphan entities", { changes });
		return changes;
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
		return db.knowledgeGraph.deleteEntityWithObservations(entityName, repo);
	} catch (error) {
		logger.warn("[KG-Archivist] Failed to delete entity with observations", {
			error: String(error),
			entityName,
			repo
		});
		return false;
	}
}
