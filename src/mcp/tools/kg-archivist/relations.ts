import { randomUUID } from "crypto";
import { SQLiteStore } from "../../storage/sqlite";
import { logger } from "../../utils/logger";
import { extractEntities, ExtractedEntity } from "./extract";
import { observationText } from "./observation-text";

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
								created_at: now
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
						created_at: now
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

// ---------------------------------------------------------------------------
// Standard-specific semantic relations
// ---------------------------------------------------------------------------

/**
 * Extracts entities from standard supplementary fields (title, context, stack)
 * and creates semantic KG relations for coding standards:
 *
 * - **parent_id → `extends`**: Links entities from the current standard to
 *   entities extracted from the parent standard's title/content.
 * - **similarity → `related_to`**: Links entities from the current standard
 *   to entities from semantically similar standards (using vector search).
 *
 * Entity extraction from the standard's main `content` field is handled
 * separately by `saveExtractions()`. This function handles the supplementary
 * fields that are specific to standards (context, stack, title).
 *
 * Observations: Each entity also generates an observation record.
 * Failures are logged at `warn` level but never thrown.
 */
export async function saveStandardRelations(
	standard: {
		id: string;
		title: string;
		content: string;
		context: string;
		stack: string[];
		parent_id: string | null;
		owner: string;
		repo: string | null;
	},
	db: SQLiteStore
): Promise<void> {
	// ── 1. Extract entities from supplementary fields (title + context + stack) ──
	const supplementaryText = [standard.title, standard.context, ...(standard.stack ?? [])].filter(Boolean).join("\n");

	if (!supplementaryText.trim()) return;

	let entities: ExtractedEntity[];
	try {
		entities = await extractEntities(supplementaryText);
	} catch (err) {
		logger.warn("[KG-Archivist] Entity extraction failed for standard relations, skipping", {
			error: String(err)
		});
		return;
	}

	if (entities.length === 0) return;

	const now = new Date().toISOString();
	const repo = standard.repo ?? "";
	const owner = standard.owner ?? "";
	const entityNames = entities.map((e) => e.name);
	const entityTypeByName = new Map(entities.map((e) => [e.name, e.type]));

	const observationTextValue = observationText("standard", standard.title);
	for (const entity of entities) {
		try {
			// ensureObservation upserts the entity AND inserts the observation
			// in one BEGIN IMMEDIATE transaction, so a concurrent
			// orphan-sweep (deleteOrphanEntities) cannot delete the fresh
			// entity between the upsert and the observation insert — the
			// observations.entity_name → entities(name) FK can never fail
			// (TASK-073 / MEM-482).
			db.knowledgeGraph.ensureObservation({
				id: randomUUID(),
				name: entity.name,
				type: entity.type,
				description: null,
				observation: observationTextValue,
				repo,
				owner,
				created_at: now
			});
		} catch (err) {
			logger.warn("[KG-Archivist] Failed to save standard entity", {
				error: String(err),
				entity: entity.name
			});
		}
	}

	// ── 2. parent_id → extends relations ──
	if (standard.parent_id) {
		const parentStandard = db.standards.getById(standard.parent_id);
		if (parentStandard) {
			let parentEntities: ExtractedEntity[];
			try {
				const parentText = `${parentStandard.title}\n${parentStandard.content}`;
				parentEntities = await extractEntities(parentText);
			} catch (err) {
				logger.warn("[KG-Archivist] Entity extraction failed for parent standard, skipping extends relations", {
					error: String(err)
				});
				parentEntities = [];
			}

			if (parentEntities.length > 0) {
				for (const entityName of entityNames) {
					for (const parentEntity of parentEntities) {
						try {
							// Upsert both endpoints first (parent entities come from
							// another document and may have been swept) so the FK
							// on relations.from_entity/to_entity cannot fail
							// (TASK-065 / MEM-473).
							db.knowledgeGraph.ensureRelation({
								from_entity: entityName,
								from_type: entityTypeByName.get(entityName) ?? "concept",
								to_entity: parentEntity.name,
								to_type: parentEntity.type,
								relation_type: "extends",
								repo,
								owner,
								created_at: now
							});
							db.knowledgeGraph.insertObservation({
								id: randomUUID(),
								entity_name: entityName,
								observation: `extends relation: ${standard.title} → ${parentStandard.title}`,
								repo,
								owner,
								created_at: now
							});
						} catch (err) {
							logger.warn("[KG-Archivist] Failed to save extends relation", {
								error: String(err),
								from: entityName,
								to: parentEntity.name
							});
						}
					}
				}
			}
		}
	}

	// ── 3. similarity → related_to relations ──
	try {
		const similarStandards = db.standards.searchBySimilarity(standard.content, {
			owner: standard.owner || undefined,
			repo: standard.repo || undefined,
			limit: 5,
			minScore: 0.6
		});

		const relatedStandards = similarStandards.filter((s) => s.id !== standard.id);

		for (const similar of relatedStandards) {
			// Skip if already linked via parent_id→extends
			if (similar.id === standard.parent_id) continue;

			let similarEntities: ExtractedEntity[];
			try {
				const similarText = `${similar.title}\n${similar.content}`;
				similarEntities = await extractEntities(similarText);
			} catch (err) {
				logger.warn("[KG-Archivist] Entity extraction failed for similar standard, skipping related_to", {
					error: String(err),
					standardId: similar.id
				});
				continue;
			}

			if (similarEntities.length === 0) continue;

			for (const entityName of entityNames) {
				for (const similarEntity of similarEntities) {
					try {
						// Upsert both endpoints first (similar-standard entities come
						// from another document and may have been swept) so the FK
						// on relations.from_entity/to_entity cannot fail
						// (TASK-065 / MEM-473).
						db.knowledgeGraph.ensureRelation({
							from_entity: entityName,
							from_type: entityTypeByName.get(entityName) ?? "concept",
							to_entity: similarEntity.name,
							to_type: similarEntity.type,
							relation_type: "related_to",
							repo,
							owner,
							created_at: now
						});
						db.knowledgeGraph.insertObservation({
							id: randomUUID(),
							entity_name: entityName,
							observation: `related_to relation: ${standard.title} ∼ ${similar.title}`,
							repo,
							owner,
							created_at: now
						});
					} catch {
						// Silent: relation may already exist
					}
				}
			}
		}
	} catch (err) {
		logger.warn("[KG-Archivist] Failed to search similar standards for related_to relations", {
			error: String(err)
		});
	}
}
