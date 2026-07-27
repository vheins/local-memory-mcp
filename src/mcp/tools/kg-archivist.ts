import { randomUUID } from "crypto";
import { SQLiteStore } from "../storage/sqlite";
import { logger } from "../utils/logger";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CONTENT_LENGTH = 5000;

const PRONOUNS = new Set([
	"i",
	"me",
	"my",
	"myself",
	"we",
	"us",
	"our",
	"ours",
	"ourselves",
	"you",
	"your",
	"yours",
	"yourself",
	"yourselves",
	"he",
	"him",
	"his",
	"himself",
	"she",
	"her",
	"hers",
	"herself",
	"it",
	"its",
	"itself",
	"they",
	"them",
	"their",
	"theirs",
	"themselves",
	"this",
	"that",
	"these",
	"those",
	"someone",
	"somebody",
	"something",
	"anyone",
	"anybody",
	"anything",
	"everyone",
	"everybody",
	"everything",
	"nobody",
	"nothing"
]);

/** Common English stopwords unlikely to be meaningful "concept" entities. */
const STOPWORDS = new Set([
	"a",
	"an",
	"the",
	"and",
	"but",
	"or",
	"if",
	"because",
	"as",
	"until",
	"while",
	"of",
	"at",
	"by",
	"for",
	"with",
	"about",
	"against",
	"between",
	"into",
	"through",
	"during",
	"before",
	"after",
	"above",
	"below",
	"to",
	"from",
	"up",
	"down",
	"in",
	"out",
	"on",
	"off",
	"over",
	"under",
	"again",
	"further",
	"then",
	"once",
	"here",
	"there",
	"when",
	"where",
	"why",
	"how",
	"all",
	"each",
	"every",
	"both",
	"few",
	"more",
	"most",
	"other",
	"some",
	"such",
	"no",
	"nor",
	"not",
	"only",
	"own",
	"same",
	"so",
	"than",
	"too",
	"very",
	"just",
	"also",
	"any",
	"thing",
	"things",
	"way",
	"ways",
	"person",
	"people",
	"man",
	"woman",
	"child",
	"time",
	"year",
	"day",
	"number",
	"world",
	"life",
	"hand",
	"part",
	"place",
	"case",
	"week",
	"company",
	"system",
	"program",
	"work",
	"group",
	"problem",
	"fact",
	"example",
	"member",
	"car",
	"city",
	"state",
	"country",
	"area",
	"water",
	"air",
	"money",
	"data",
	"information",
	"software",
	"code",
	"file",
	"server",
	"database",
	"application",
	"user",
	"users",
	"project",
	"task",
	"memory",
	"value",
	"name",
	"type",
	"list",
	"set",
	"number",
	"id",
	"key",
	"text",
	"content",
	"title",
	"description",
	"status",
	"time",
	"dan",
	"yang",
	"di",
	"ke",
	"dari",
	"dengan",
	"ini",
	"itu",
	"ada",
	"akan",
	"bisa",
	"telah",
	"sudah",
	"juga",
	"atau",
	"karena",
	"untuk",
	"pada",
	"sebagai",
	"oleh",
	"saat",
	"setelah",
	"antara",
	"tentang"
]);

const DETERMINERS = /^(a|an|the)\s+/i;

const TRAILING_PUNCTUATION = /[.,!?;:()"'[\]]+$/g;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtractedEntity {
	name: string;
	type: "person" | "place" | "organization" | "concept";
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Clean trailing punctuation from extracted entity text.
 */
function cleanText(raw: string): string {
	return raw.replace(TRAILING_PUNCTUATION, "").trim();
}

/**
 * Remove leading determiners ("a ", "an ", "the ") from a noun phrase.
 */
function stripLeadingDeterminer(phrase: string): string {
	return phrase.replace(DETERMINERS, "").trim();
}

/**
 * Check whether a noun-phrase candidate should be excluded from concept
 * extraction (pronouns, stopwords, too short, etc.).
 */
function isExcludedNoun(candidate: string): boolean {
	const lower = candidate.toLowerCase();
	if (lower.length < 2) return true;
	if (PRONOUNS.has(lower)) return true;
	if (STOPWORDS.has(lower)) return true;
	if (/^\d+$/.test(candidate)) return true;
	return false;
}

const ENTITY_NAME_BAD_PATTERN = /^(~|[-→·•])|["'`[\]{}()]|→|=>|->|`|~[\d]/;
const ENTITY_NAME_ONLY_SYMBOLS = /^[^a-zA-Z0-9]+$/;

/**
 * Reject entity names that are clearly garbage: code fragments, size
 * references, quote/bracket pollution, or pure-symbol strings.
 */
function isValidEntityName(name: string): boolean {
	if (name.length < 2) return false;
	if (ENTITY_NAME_ONLY_SYMBOLS.test(name)) return false;
	if (ENTITY_NAME_BAD_PATTERN.test(name)) return false;
	return true;
}

/**
 * NLP-based entity extraction using the `compromise` library.
 *
 * Extracts four entity types from textual content:
 * - **person**   – identified via `doc.people()`
 * - **place**    – identified via `doc.places()`
 * - **organization** – identified via `doc.organizations()`
 * - **concept**  – noun phrases (`doc.nouns()`) after filtering common
 *                  stopwords, pronouns, and determiners
 *
 * Deduplication is case-insensitive (first occurrence wins).
 * Very long content (>5000 chars) is truncated for performance.
 */
export async function extractEntities(content: string): Promise<ExtractedEntity[]> {
	if (!content || content.trim().length === 0) return [];

	const { default: nlp } = await import("compromise");
	const text = content.length > MAX_CONTENT_LENGTH ? content.slice(0, MAX_CONTENT_LENGTH) : content;
	const doc = nlp(text);
	const seen = new Set<string>();
	const entities: ExtractedEntity[] = [];

	function add(name: string, type: ExtractedEntity["type"]): void {
		const trimmed = name.trim();
		if (!trimmed || trimmed.length < 2) return;
		if (!isValidEntityName(trimmed)) return;
		const key = trimmed.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		entities.push({ name: trimmed, type });
	}

	// People
	for (const match of doc.people().json() as Array<{ text: string }>) {
		add(cleanText(match.text), "person");
	}

	// Places
	for (const match of doc.places().json() as Array<{ text: string }>) {
		add(cleanText(match.text), "place");
	}

	// Organizations
	for (const match of doc.organizations().json() as Array<{ text: string }>) {
		add(cleanText(match.text), "organization");
	}

	// Nouns → concepts (after filtering)
	for (const match of doc.nouns().json() as Array<{ text: string }>) {
		const raw = cleanText(match.text);
		const candidate = stripLeadingDeterminer(raw);
		if (!isExcludedNoun(candidate)) {
			add(candidate, "concept");
		}
	}

	return entities;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Extract entities from `content` and persist them into the knowledge-graph
 * tables (`entities`, `observations`).
 *
 * - Entities are inserted with `INSERT OR IGNORE` so duplicate names do not
 *   cause errors.
 * - Each extraction produces an observation record linking the entity to the
 *   memory that mentioned it.
 * - Failures are logged at `warn` level but never thrown — the caller's
 *   memory-store operation is never blocked.
 */
export async function saveExtractions(
	content: string,
	title: string,
	owner: string,
	repo: string,
	db: SQLiteStore
): Promise<void> {
	if (!content || content.trim().length === 0) return;

	let entities: ExtractedEntity[];
	try {
		entities = await extractEntities(content);
	} catch (err) {
		logger.warn("[KG-Archivist] Entity extraction failed, skipping", {
			error: String(err)
		});
		return;
	}

	if (entities.length === 0) return;

	const now = new Date().toISOString();
	const observationText = `Mentioned in memory: ${title}`;

	const insertEntity = db.db.prepare(
		`INSERT OR IGNORE INTO entities (name, type, description, repo, owner, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`
	);

	const insertObservation = db.db.prepare(
		`INSERT INTO observations (id, entity_name, observation, repo, owner, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`
	);

	for (const entity of entities) {
		try {
			insertEntity.run(entity.name, entity.type, null, repo, owner ?? "", now, now);
			insertObservation.run(randomUUID(), entity.name, observationText, repo, owner ?? "", now);
		} catch (err) {
			logger.warn("[KG-Archivist] Failed to save extraction for entity", {
				error: String(err),
				entity: entity.name
			});
		}
	}

	// Create co-occurrence relations between entities extracted from the same content
	if (entities.length > 1) {
		const insertRelation = db.db.prepare(
			`INSERT OR IGNORE INTO relations (from_entity, to_entity, relation_type, repo, owner, created_at)
			 VALUES (?, ?, ?, ?, ?, ?)`
		);
		for (let i = 0; i < entities.length; i++) {
			for (let j = i + 1; j < entities.length; j++) {
				try {
					insertRelation.run(entities[i].name, entities[j].name, "co_mentioned", repo, owner ?? "", now);
				} catch (err) {
					// Silent: relation might already exist
				}
			}
		}
	}
}

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
