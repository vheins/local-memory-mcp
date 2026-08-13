import { randomUUID } from "crypto";
import type { SQLiteStore } from "../../storage/sqlite";
import { logger } from "../../utils/logger";
import { KG_RELATION_CONFIDENCE_SEMANTIC } from "./relations-conf";
import { extractEntities, type ExtractedEntity } from "./extract";

// ---------------------------------------------------------------------------
// Task-specific semantic relations
// ---------------------------------------------------------------------------

/**
 * Extracts entities from task content and creates semantic KG relations
 * based on task metadata:
 *
 * - **parent_id → `depends_on`**: Links entities from the current task to
 *   entities extracted from the parent task's title/description.
 * - **decision_refs → `inspired_by`**: Ensures an entity exists for each
 *   decision reference (e.g. "ADR-006") and links task entities to it.
 *
 * Observations: Each relation also generates an observation record to make
 * the linkage queryable via the KG query engine.
 * Failures are logged at `warn` level but never thrown.
 */
export async function saveTaskRelations(
	content: string,
	title: string,
	owner: string,
	repo: string,
	db: SQLiteStore,
	options?: {
		parentId?: string | null;
		decisionRefs?: string[];
	}
): Promise<void> {
	if (!content || content.trim().length === 0) return;

	// Extract entities from current task content
	let entities: ExtractedEntity[];
	try {
		entities = await extractEntities(content);
	} catch (err) {
		logger.warn("[KG-Archivist] Entity extraction failed for task relations, skipping", {
			error: String(err)
		});
		return;
	}

	if (entities.length === 0) return;

	const now = new Date().toISOString();
	const entityNames = entities.map((e) => e.name);
	const entityTypeByName = new Map(entities.map((e) => [e.name, e.type]));

	// ── 1. parent_id → depends_on relations ──
	if (options?.parentId) {
		const parentTask = db.tasks.getTaskById(options.parentId);
		// Skip canceled parents (mirror worker.ts:241-242): a canceled parent's
		// entities were already orphan-swept, so extracting from it would only
		// re-create dangling relation targets (TASK-065 / MEM-473).
		if (parentTask && parentTask.status !== "canceled") {
			const parentContent = `${parentTask.title}\n${parentTask.description ?? ""}`;
			let parentEntities: ExtractedEntity[];
			try {
				parentEntities = await extractEntities(parentContent);
			} catch (err) {
				logger.warn("[KG-Archivist] Entity extraction failed for parent task, skipping parent relations", {
					error: String(err)
				});
				parentEntities = [];
			}

			if (parentEntities.length > 0) {
				for (const taskEntityName of entityNames) {
					for (const parentEntity of parentEntities) {
						try {
							// Upsert BOTH endpoints before the insert: the parent
							// entities were extracted from ANOTHER document and may
							// have been orphan-swept, so a raw relation insert would
							// fail the FK on a missing endpoint (TASK-065 / MEM-473).
							db.knowledgeGraph.ensureRelation({
								from_entity: taskEntityName,
								from_type: entityTypeByName.get(taskEntityName) ?? "concept",
								to_entity: parentEntity.name,
								to_type: parentEntity.type,
								relation_type: "depends_on",
								repo,
								owner: owner ?? "",
								created_at: now,
								confidence: KG_RELATION_CONFIDENCE_SEMANTIC
							});
							db.knowledgeGraph.insertObservation({
								id: randomUUID(),
								entity_name: taskEntityName,
								observation: `depends_on relation: ${title} → ${parentTask.title}`,
								repo,
								owner: owner ?? "",
								created_at: now
							});
						} catch (err) {
							logger.warn("[KG-Archivist] Failed to save depends_on relation", {
								error: String(err),
								from: taskEntityName,
								to: parentEntity.name
							});
						}
					}
				}
			}
		}
	}

	// ── 2. decision_refs → inspired_by relations ──
	if (options?.decisionRefs && options.decisionRefs.length > 0) {
		for (const ref of options.decisionRefs) {
			const decisionName = ref.trim();
			if (!decisionName) continue;

			// Create inspired_by relations from task entities to this decision
			for (const taskEntityName of entityNames) {
				try {
					// ensureRelation upserts BOTH endpoints — the task entity
					// AND the decision entity (type "decision") — then inserts
					// the edge, all in one BEGIN IMMEDIATE transaction. The
					// decision entity lives in the same repo and is referenced
					// by the edge once committed, so a concurrent
					// orphan-sweep can neither delete it between the upsert
					// and the insert nor sweep it afterwards (TASK-073 /
					// MEM-482). Previously a separate upsertEntity +
					// upsertRelation pair autocommitted each statement, so the
					// sweep could delete the decision endpoint mid-pair and
					// fail the relations FK.
					db.knowledgeGraph.ensureRelation({
						from_entity: taskEntityName,
						from_type: entityTypeByName.get(taskEntityName) ?? "concept",
						to_entity: decisionName,
						to_type: "decision",
						relation_type: "inspired_by",
						repo,
						owner: owner ?? "",
						created_at: now,
						confidence: KG_RELATION_CONFIDENCE_SEMANTIC
					});
					db.knowledgeGraph.insertObservation({
						id: randomUUID(),
						entity_name: taskEntityName,
						observation: `inspired_by relation: ${title} → ${decisionName}`,
						repo,
						owner: owner ?? "",
						created_at: now
					});
				} catch (err) {
					logger.warn("[KG-Archivist] Failed to save inspired_by relation", {
						error: String(err),
						from: taskEntityName,
						to: decisionName
					});
				}
			}
		}
	}
}
