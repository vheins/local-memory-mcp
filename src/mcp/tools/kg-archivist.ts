import { randomUUID } from "crypto";
import nlp from "compromise";
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
	"time"
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
export function extractEntities(content: string): ExtractedEntity[] {
	if (!content || content.trim().length === 0) return [];

	const text = content.length > MAX_CONTENT_LENGTH ? content.slice(0, MAX_CONTENT_LENGTH) : content;
	const doc = nlp(text);
	const seen = new Set<string>();
	const entities: ExtractedEntity[] = [];

	function add(name: string, type: ExtractedEntity["type"]): void {
		const trimmed = name.trim();
		if (!trimmed || trimmed.length < 2) return;
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
export function saveExtractions(content: string, title: string, owner: string, repo: string, db: SQLiteStore): void {
	if (!content || content.trim().length === 0) return;

	let entities: ExtractedEntity[];
	try {
		entities = extractEntities(content);
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
}
