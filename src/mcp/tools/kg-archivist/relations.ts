import { randomUUID } from "crypto";
import { SQLiteStore } from "../../storage/sqlite";
import { logger } from "../../utils/logger";
import { extractEntities, ExtractedEntity } from "./extract";

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

	// Observation for current task
	const observationText = `Mentioned in task: ${title}`;

	// ── 1. parent_id → depends_on relations ──
	if (options?.parentId) {
		const parentTask = db.tasks.getTaskById(options.parentId);
		if (parentTask) {
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
				const insertRelation = db.db.prepare(
					`INSERT OR IGNORE INTO relations (from_entity, to_entity, relation_type, repo, owner, created_at)
					 VALUES (?, ?, ?, ?, ?, ?)`
				);
				const insertObservation = db.db.prepare(
					`INSERT INTO observations (id, entity_name, observation, repo, owner, created_at)
					 VALUES (?, ?, ?, ?, ?, ?)`
				);

				for (const taskEntityName of entityNames) {
					for (const parentEntity of parentEntities) {
						try {
							insertRelation.run(taskEntityName, parentEntity.name, "depends_on", repo, owner ?? "", now);
							insertObservation.run(
								randomUUID(),
								taskEntityName,
								`depends_on relation: ${title} → ${parentTask.title}`,
								repo,
								owner ?? "",
								now
							);
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
		const insertEntity = db.db.prepare(
			`INSERT OR IGNORE INTO entities (name, type, description, repo, owner, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
		);
		const insertRelation = db.db.prepare(
			`INSERT OR IGNORE INTO relations (from_entity, to_entity, relation_type, repo, owner, created_at)
			 VALUES (?, ?, ?, ?, ?, ?)`
		);
		const insertObservation = db.db.prepare(
			`INSERT INTO observations (id, entity_name, observation, repo, owner, created_at)
			 VALUES (?, ?, ?, ?, ?, ?)`
		);

		for (const ref of options.decisionRefs) {
			const decisionName = ref.trim();
			if (!decisionName) continue;

			// Ensure the decision entity exists
			insertEntity.run(
				decisionName,
				"decision",
				`Decision/ADR reference: ${decisionName}`,
				repo,
				owner ?? "",
				now,
				now
			);

			// Create inspired_by relations from task entities to this decision
			for (const taskEntityName of entityNames) {
				try {
					insertRelation.run(taskEntityName, decisionName, "inspired_by", repo, owner ?? "", now);
					insertObservation.run(
						randomUUID(),
						taskEntityName,
						`inspired_by relation: ${title} → ${decisionName}`,
						repo,
						owner ?? "",
						now
					);
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

	// Persist entities + observations
	const insertEntity = db.db.prepare(
		`INSERT OR IGNORE INTO entities (name, type, description, repo, owner, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`
	);

	const insertObservation = db.db.prepare(
		`INSERT INTO observations (id, entity_name, observation, repo, owner, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`
	);

	const observationText = `Mentioned in standard: ${standard.title}`;
	for (const entity of entities) {
		try {
			insertEntity.run(entity.name, entity.type, null, repo, owner, now, now);
			insertObservation.run(randomUUID(), entity.name, observationText, repo, owner, now);
		} catch (err) {
			logger.warn("[KG-Archivist] Failed to save standard entity", {
				error: String(err),
				entity: entity.name
			});
		}
	}

	// Helper to prepare relation statements
	const insertRelation = db.db.prepare(
		`INSERT OR IGNORE INTO relations (from_entity, to_entity, relation_type, repo, owner, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`
	);

	const insertRelObservation = db.db.prepare(
		`INSERT INTO observations (id, entity_name, observation, repo, owner, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`
	);

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
							insertRelation.run(entityName, parentEntity.name, "extends", repo, owner, now);
							insertRelObservation.run(
								randomUUID(),
								entityName,
								`extends relation: ${standard.title} → ${parentStandard.title}`,
								repo,
								owner,
								now
							);
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
						insertRelation.run(entityName, similarEntity.name, "related_to", repo, owner, now);
						insertRelObservation.run(
							randomUUID(),
							entityName,
							`related_to relation: ${standard.title} ∼ ${similar.title}`,
							repo,
							owner,
							now
						);
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
