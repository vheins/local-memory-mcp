import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "crypto";
import { extractEntities, saveExtractions } from "../tools/kg-archivist";
import { handleMemoryWrite } from "../tools/memory.write";
import { handleMemoryRead } from "../tools/memory.read";
import { handleTaskRead } from "../tools/task.read";
import { handleStandardRead } from "../tools/standard.read";
import { EmbeddingWorker } from "../embedding-queue/worker";
import { RealVectorStore } from "../storage/vectors";
import { createTestStore, SQLiteStore } from "../storage/sqlite";
import { VectorStore } from "../types/vector";
import type { Task } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockVectorStore(): VectorStore {
	return {
		upsert: vi.fn().mockResolvedValue(undefined),
		remove: vi.fn().mockResolvedValue(undefined),
		search: vi.fn().mockResolvedValue([])
	};
}

/**
 * Drain the embedding outbox so enqueued memory jobs run their KG extraction.
 * memory-write enqueues (TASK-013) and the worker extracts asynchronously, so
 * tests asserting on entities/observations must run one worker cycle first.
 */
function makeWorkerVectors(): RealVectorStore {
	return { embed: vi.fn().mockResolvedValue([[0.1, 0.2]]) } as unknown as RealVectorStore;
}

async function drainOutbox(db: SQLiteStore): Promise<void> {
	await new EmbeddingWorker(db, makeWorkerVectors(), {
		batchSize: 32,
		leaseMs: 60_000,
		poisonThreshold: 3,
		backoffBaseMs: 1_000,
		backoffMaxMs: 60_000,
		pollIntervalMs: 3_600_000,
		purgeIntervalMs: 3_600_000,
		backfillCap: 0
	}).runOnce();
}

// ---------------------------------------------------------------------------
// extractEntities
// ---------------------------------------------------------------------------

describe("KG Archivist — extractEntities", () => {
	describe("people extraction", () => {
		it("extracts people from text with proper names", async () => {
			const result = await extractEntities("Alice and Bob worked on the project");
			const people = result.filter((e) => e.type === "person");
			// compromise should detect "Alice" and "Bob" as named people
			expect(people.length).toBeGreaterThanOrEqual(2);
			const names = people.map((p) => p.name);
			expect(names).toEqual(expect.arrayContaining(["Alice", "Bob"]));
		});

		it("deduplicates people regardless of case", async () => {
			const result = await extractEntities("Alice talked to alice about the design");
			const people = result.filter((e) => e.type === "person");
			const names = people.map((p) => p.name.toLowerCase());
			const unique = new Set(names);
			expect(unique.size).toBe(names.length);
		});
	});

	describe("places extraction", () => {
		it("extracts place names from text", async () => {
			const result = await extractEntities("The deployment was in Seattle");
			const places = result.filter((e) => e.type === "place");
			expect(places.length).toBeGreaterThanOrEqual(1);
			const names = places.map((p) => p.name);
			expect(names).toContain("Seattle");
		});

		it("extracts multiple places", async () => {
			const result = await extractEntities("The team traveled from London to Paris for the conference");
			const places = result.filter((e) => e.type === "place");
			const names = places.map((p) => p.name);
			expect(names).toContain("London");
			expect(names).toContain("Paris");
		});
	});

	describe("organizations extraction", () => {
		it("extracts organization names", async () => {
			const result = await extractEntities("Acme Corp acquired Startup Inc");
			const orgs = result.filter((e) => e.type === "organization");
			expect(orgs.length).toBeGreaterThanOrEqual(2);
			const names = orgs.map((o) => o.name);
			expect(names).toEqual(expect.arrayContaining(["Acme Corp", "Startup Inc"]));
		});

		it("extracts well-known organizations", async () => {
			const result = await extractEntities("Google and Microsoft announced a partnership");
			const orgs = result.filter((e) => e.type === "organization");
			const names = orgs.map((o) => o.name);
			expect(names).toContain("Google");
			expect(names).toContain("Microsoft");
		});
	});

	describe("concepts extraction", () => {
		it("extracts technical concepts from text", async () => {
			const result = await extractEntities("The microservices architecture improved scalability and maintainability");
			const concepts = result.filter((e) => e.type === "concept");
			expect(concepts.length).toBeGreaterThanOrEqual(1);
			const names = concepts.map((c) => c.name.toLowerCase());
			expect(names).toContain("microservices architecture");
		});

		it("filters out pronouns from concepts", async () => {
			const result = await extractEntities("He said she would handle it themselves");
			const concepts = result.filter((e) => e.type === "concept");
			const names = concepts.map((c) => c.name.toLowerCase());
			// Pronouns should be excluded
			expect(names).not.toContain("he");
			expect(names).not.toContain("she");
			expect(names).not.toContain("it");
			expect(names).not.toContain("themselves");
		});

		it("filters out common stopwords from concepts", async () => {
			const result = await extractEntities("The thing is a very complex problem");
			const concepts = result.filter((e) => e.type === "concept");
			const names = concepts.map((c) => c.name.toLowerCase());
			expect(names).not.toContain("the");
			expect(names).not.toContain("thing");
			expect(names).not.toContain("very");
			expect(names).not.toContain("problem");
		});

		it("removes leading determiners from concept noun phrases", async () => {
			const result = await extractEntities("The database schema needs a new index");
			const concepts = result.filter((e) => e.type === "concept");
			const names = concepts.map((c) => c.name.toLowerCase());
			// Leading "the" or "a" should be stripped
			expect(names).toContain("database schema");
			expect(names).toContain("new index");
			expect(names).not.toContain("the database schema");
			expect(names).not.toContain("a new index");
		});
	});

	describe("deduplication across types", () => {
		it("does not return the same name twice", async () => {
			const result = await extractEntities("Alice and Bob worked on the project with Alice again");
			const names = result.map((e) => e.name.toLowerCase());
			const unique = new Set(names);
			expect(unique.size).toBe(names.length);
		});
	});

	describe("edge cases", () => {
		it("returns empty array for empty string", async () => {
			await expect(extractEntities("")).resolves.toEqual([]);
		});

		it("returns empty array for whitespace-only string", async () => {
			await expect(extractEntities("   ")).resolves.toEqual([]);
		});

		it("returns empty array for string with only newlines", async () => {
			await expect(extractEntities("\n\n\r\n")).resolves.toEqual([]);
		});

		it("handles short content (fewer than 10 characters) gracefully", async () => {
			const result = await extractEntities("Hi");
			expect(Array.isArray(result)).toBe(true);
		});

		it("handles single-word content", async () => {
			const result = await extractEntities("Hello");
			expect(Array.isArray(result)).toBe(true);
		});

		it("handles content with only stopwords", async () => {
			const result = await extractEntities("the and of in to a an is");
			expect(Array.isArray(result)).toBe(true);
		});
	});
});

// ---------------------------------------------------------------------------
// saveExtractions
// ---------------------------------------------------------------------------

describe("KG Archivist — saveExtractions", () => {
	let db: SQLiteStore;

	beforeEach(async () => {
		db = await createTestStore();
	});

	afterEach(() => {
		db.close();
	});

	it("inserts extracted entities into the entities table", async () => {
		await saveExtractions("Alice and Bob worked on the project", "Test Memory", "test-owner", "test-repo", db);

		const rows = db.db.prepare("SELECT name, type, repo, owner FROM entities").all() as Array<{
			name: string;
			type: string;
			repo: string;
			owner: string;
		}>;

		expect(rows.length).toBeGreaterThan(0);

		// All rows should have the correct scope
		for (const row of rows) {
			expect(row.repo).toBe("test-repo");
			expect(row.owner).toBe("test-owner");
		}

		// Should include person entities
		const people = rows.filter((r) => r.type === "person");
		const personNames = people.map((p) => p.name);
		expect(personNames).toEqual(expect.arrayContaining(["Alice", "Bob"]));
	});

	it("inserts observation records linking entities to the memory title", async () => {
		await saveExtractions("Alice and Bob worked on the project", "Test Memory", "owner", "repo", db);

		const observations = db.db.prepare("SELECT entity_name, observation FROM observations").all() as Array<{
			entity_name: string;
			observation: string;
		}>;

		expect(observations.length).toBeGreaterThan(0);
		for (const obs of observations) {
			expect(obs.observation).toBe("Mentioned in memory: Test Memory");
		}
	});

	it("uses INSERT OR IGNORE for duplicate entity names", async () => {
		await saveExtractions("Alice and Bob worked on the project", "Memory 1", "owner", "repo", db);
		const count1 = (db.db.prepare("SELECT COUNT(*) as cnt FROM entities").get() as { cnt: number }).cnt;

		// Same content again — duplicate names should be ignored
		await saveExtractions("Alice and Bob worked on the project", "Memory 2", "owner", "repo", db);
		const count2 = (db.db.prepare("SELECT COUNT(*) as cnt FROM entities").get() as { cnt: number }).cnt;

		// Count should be the same — INSERT OR IGNORE prevents duplicates
		expect(count2).toBe(count1);
	});

	it("still creates observation records on duplicate entity insert", async () => {
		await saveExtractions("Alice worked on the project", "Memory 1", "owner", "repo", db);
		const obs1 = (db.db.prepare("SELECT COUNT(*) as cnt FROM observations").get() as { cnt: number }).cnt;

		await saveExtractions("Alice worked on the project again", "Memory 2", "owner", "repo", db);
		const obs2 = (db.db.prepare("SELECT COUNT(*) as cnt FROM observations").get() as { cnt: number }).cnt;

		// Observations are fresh INSERTs, so count should increase even if entity already exists
		expect(obs2).toBeGreaterThan(obs1);
	});

	it("does nothing when content is empty", async () => {
		await saveExtractions("", "Empty Memory", "owner", "repo", db);
		const entities = db.db.prepare("SELECT COUNT(*) as cnt FROM entities").get() as { cnt: number };
		expect(entities.cnt).toBe(0);
		const observations = db.db.prepare("SELECT COUNT(*) as cnt FROM observations").get() as { cnt: number };
		expect(observations.cnt).toBe(0);
	});

	it("does nothing when content is whitespace only", async () => {
		await saveExtractions("   ", "Whitespace Memory", "owner", "repo", db);
		const entities = db.db.prepare("SELECT COUNT(*) as cnt FROM entities").get() as { cnt: number };
		expect(entities.cnt).toBe(0);
	});

	it("processes content longer than 5000 characters by truncating", async () => {
		const longContent = "Alice and Bob " + "x".repeat(5000);
		await saveExtractions(longContent, "Long Memory", "owner", "repo", db);

		// Should not throw and should process the first part
		const entities = db.db.prepare("SELECT COUNT(*) as cnt FROM entities").get() as { cnt: number };
		expect(entities.cnt).toBeGreaterThan(0);
	});

	it("stores entity with correct columns (name, type, description, repo, owner)", async () => {
		await saveExtractions("Alice worked on the deployment in Seattle", "Test Memory", "owner", "repo", db);

		const entity = db.db
			.prepare("SELECT name, type, description, repo, owner FROM entities WHERE type = 'person' LIMIT 1")
			.get() as { name: string; type: string; description: unknown; repo: string; owner: string } | undefined;

		if (entity) {
			expect(entity.name).toBe("Alice");
			expect(entity.type).toBe("person");
			expect(entity.description).toBeNull(); // description is null per saveExtractions
			expect(entity.repo).toBe("repo");
			expect(entity.owner).toBe("owner");
		}
	});

	it("handles content with mixed entity types across multiple calls", async () => {
		await saveExtractions("Alice works at Acme Corp", "Memory 1", "owner", "repo", db);
		await saveExtractions("The deployment was in Seattle", "Memory 2", "owner", "repo", db);

		const entities = db.db.prepare("SELECT DISTINCT type FROM entities").all() as Array<{ type: string }>;
		const types = entities.map((e) => e.type);

		// Should have at least person and place types
		expect(types).toContain("person");
		expect(types).toContain("place");
	});

	it("does not throw when NLP extraction fails on malformed input", async () => {
		// saveExtractions catches extraction errors internally
		// Sending null-like content should be safe
		await expect(saveExtractions("", "No Content", "owner", "repo", db)).resolves.not.toThrow();
	});

	it("maintains referential integrity between entities and observations", async () => {
		await saveExtractions("Alice worked on the project", "Test Memory", "owner", "repo", db);

		const observations = db.db.prepare("SELECT entity_name FROM observations").all() as Array<{
			entity_name: string;
		}>;

		// Every observation should reference an entity that exists
		for (const obs of observations) {
			const entity = db.db.prepare("SELECT name FROM entities WHERE name = ?").get(obs.entity_name) as
				{ name: string } | undefined;
			expect(entity).toBeDefined();
		}
	});
});

// ---------------------------------------------------------------------------
// Integration: handleMemoryWrite → saveExtractions
// ---------------------------------------------------------------------------

describe("KG Archivist — integration with handleMemoryWrite", () => {
	let db: SQLiteStore;
	let vectors: VectorStore;

	beforeEach(async () => {
		db = await createTestStore();
		vectors = makeMockVectorStore();
	});

	afterEach(() => {
		db.close();
	});

	it("automatically extracts entities when storing a memory", async () => {
		await handleMemoryWrite(
			{
				type: "code_fact",
				title: "Team Update",
				content: "Alice and Bob deployed the system to Seattle",
				importance: 3,
				scope: { owner: "test", repo: "test-repo" },
				agent: "test",
				role: "tester",
				model: "test",
				memories: [
					{
						type: "code_fact",
						title: "Team Update",
						content: "Alice and Bob deployed the system to Seattle",
						importance: 3,
						scope: { owner: "test", repo: "test-repo" },
						agent: "test",
						role: "tester",
						model: "test"
					}
				],
				json: true
			},
			db,
			vectors
		);

		// KG extraction is async (outbox worker, TASK-013) — drain it first.
		await drainOutbox(db);

		// Entities should have been extracted from the content
		const entities = db.db.prepare("SELECT name, type FROM entities").all() as Array<{
			name: string;
			type: string;
		}>;

		expect(entities.length).toBeGreaterThan(0);
		const names = entities.map((e) => e.name);
		expect(names).toEqual(expect.arrayContaining(["Alice", "Bob", "Seattle"]));
	});

	it("creates observation records for each extracted entity", async () => {
		await handleMemoryWrite(
			{
				type: "code_fact",
				title: "Team Update",
				content: "Alice deployed the system to Seattle",
				importance: 3,
				scope: { owner: "test", repo: "test-repo" },
				agent: "test",
				role: "tester",
				model: "test",
				memories: [
					{
						type: "code_fact",
						title: "Team Update",
						content: "Alice deployed the system to Seattle",
						importance: 3,
						scope: { owner: "test", repo: "test-repo" },
						agent: "test",
						role: "tester",
						model: "test"
					}
				],
				json: true
			},
			db,
			vectors
		);

		// KG extraction is async (outbox worker, TASK-013) — drain it first.
		await drainOutbox(db);

		const observations = db.db.prepare("SELECT entity_name, observation FROM observations").all() as Array<{
			entity_name: string;
			observation: string;
		}>;

		expect(observations.length).toBeGreaterThan(0);
		for (const obs of observations) {
			expect(obs.observation).toBe("Mentioned in memory: Team Update");
		}
	});

	it("extracts entities from each memory in a bulk store", async () => {
		await handleMemoryWrite(
			{
				type: "code_fact",
				title: "Multiple Memories",
				content: "Bulk memory storage with entities", // top-level is optional in bulk, but must be >=10 if present
				importance: 3,
				scope: { owner: "test", repo: "test-repo" },
				agent: "test",
				role: "tester",
				model: "test",
				memories: [
					{
						type: "code_fact",
						title: "Personnel",
						content: "Alice and Bob joined the team",
						importance: 3,
						scope: { owner: "test", repo: "test-repo" },
						agent: "test",
						role: "tester",
						model: "test"
					},
					{
						type: "code_fact",
						title: "Location",
						content: "Seattle office is now open",
						importance: 3,
						scope: { owner: "test", repo: "test-repo" },
						agent: "test",
						role: "tester",
						model: "test"
					}
				],
				json: true
			},
			db,
			vectors
		);

		// KG extraction is async (outbox worker, TASK-013) — drain it first.
		await drainOutbox(db);

		const entities = db.db.prepare("SELECT name FROM entities").all() as Array<{ name: string }>;
		const names = entities.map((e) => e.name);

		expect(names).toEqual(expect.arrayContaining(["Alice", "Bob", "Seattle"]));
	});

	it("does not block the memory store operation when extraction produces no entities", async () => {
		const result = await handleMemoryWrite(
			{
				type: "code_fact",
				title: "Boring",
				content: "the and of in to a",
				importance: 3,
				scope: { owner: "test", repo: "test-repo" },
				agent: "test",
				role: "tester",
				model: "test",
				memories: [
					{
						type: "code_fact",
						title: "Boring",
						content: "the and of in to a",
						importance: 3,
						scope: { owner: "test", repo: "test-repo" },
						agent: "test",
						role: "tester",
						model: "test"
					}
				],
				json: true
			},
			db,
			vectors
		);

		// Memory store itself should succeed
		expect(result.isError).toBeFalsy();

		// Drain the outbox — stopword-only content still extracts nothing.
		await drainOutbox(db);

		// No entities should have been extracted
		const entities = db.db.prepare("SELECT COUNT(*) as cnt FROM entities").get() as { cnt: number };
		expect(entities.cnt).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Embedded KG context: memory-read responses
// ---------------------------------------------------------------------------

describe("KG Archivist — embedded KG context in memory-read", () => {
	let db: SQLiteStore;
	let vectors: VectorStore;

	const KG_REPO = "kg-context-memory-test";

	beforeEach(async () => {
		db = await createTestStore();
		vectors = makeMockVectorStore();
	});

	afterEach(() => {
		db.close();
	});

	it("includes kg when reading a memory by id", async () => {
		// Store a memory with entity-rich content (triggers auto-extraction)
		const writeResult = await handleMemoryWrite(
			{
				type: "code_fact",
				title: "Context Memory Alpha",
				content: "Alice deployed the system to Seattle for Acme Corp",
				importance: 3,
				scope: { owner: "test", repo: KG_REPO },
				agent: "test",
				role: "tester",
				model: "test",
				memories: [
					{
						type: "code_fact",
						title: "Context Memory Alpha",
						content: "Alice deployed the system to Seattle for Acme Corp",
						importance: 3,
						scope: { owner: "test", repo: KG_REPO },
						agent: "test",
						role: "tester",
						model: "test"
					}
				],
				json: true
			},
			db,
			vectors
		);

		const memoryId = (writeResult.structuredContent as { results: Array<{ id: string }> }).results[0].id;

		// KG extraction is async (outbox worker, TASK-013) — drain it first.
		await drainOutbox(db);

		// Read it back in detail mode
		const readResult = await handleMemoryRead({ id: memoryId, owner: "test", repo: KG_REPO, json: true }, db, vectors);

		const data = readResult.structuredContent as Record<string, unknown>;
		expect(data.kg).toBeDefined();
		const kgContext = data.kg as { entities: Array<unknown>; relations: Array<unknown> };
		expect(kgContext.entities.length).toBeGreaterThan(0);
		expect(kgContext.relations.length).toBeGreaterThan(0);
		// Entities should include extracted names
		const entityNames = kgContext.entities.map((e: { name: string }) => e.name);
		expect(entityNames).toEqual(expect.arrayContaining(["Alice", "Seattle", "Acme Corp"]));
	});

	it("includes kg when reading a memory by code", async () => {
		const writeResult = await handleMemoryWrite(
			{
				type: "code_fact",
				title: "Context By Code",
				content: "Bob and Charlie worked on the database schema",
				importance: 3,
				scope: { owner: "test", repo: KG_REPO },
				agent: "test",
				role: "tester",
				model: "test",
				memories: [
					{
						type: "code_fact",
						title: "Context By Code",
						content: "Bob and Charlie worked on the database schema",
						importance: 3,
						scope: { owner: "test", repo: KG_REPO },
						agent: "test",
						role: "tester",
						model: "test"
					}
				],
				json: true
			},
			db,
			vectors
		);

		const memoryCode = (writeResult.structuredContent as { results: Array<{ code: string }> }).results[0].code;

		// KG extraction is async (outbox worker, TASK-013) — drain it first.
		await drainOutbox(db);

		const readResult = await handleMemoryRead(
			{ code: memoryCode, owner: "test", repo: KG_REPO, json: true },
			db,
			vectors
		);

		const data = readResult.structuredContent as Record<string, unknown>;
		expect(data.kg).toBeDefined();
		const kgContext = data.kg as { entities: Array<{ name: string }> };
		const entityNames = kgContext.entities.map((e: { name: string }) => e.name);
		expect(entityNames).toEqual(expect.arrayContaining(["Bob", "Charlie"]));
	});

	it("includes aggregated kg in bulk detail by ids", async () => {
		const m1 = await handleMemoryWrite(
			{
				type: "code_fact",
				title: "Bulk KG A",
				content: "Alice deployed the system to Seattle for Acme Corp",
				importance: 3,
				scope: { owner: "test", repo: KG_REPO },
				agent: "test",
				role: "tester",
				model: "test",
				memories: [
					{
						type: "code_fact",
						title: "Bulk KG A",
						content: "Alice deployed the system to Seattle for Acme Corp",
						importance: 3,
						scope: { owner: "test", repo: KG_REPO },
						agent: "test",
						role: "tester",
						model: "test"
					}
				],
				json: true
			},
			db,
			vectors
		);
		const m2 = await handleMemoryWrite(
			{
				type: "code_fact",
				title: "Bulk KG B",
				content: "Bob and Charlie worked on the database schema",
				importance: 3,
				scope: { owner: "test", repo: KG_REPO },
				agent: "test",
				role: "tester",
				model: "test",
				memories: [
					{
						type: "code_fact",
						title: "Bulk KG B",
						content: "Bob and Charlie worked on the database schema",
						importance: 3,
						scope: { owner: "test", repo: KG_REPO },
						agent: "test",
						role: "tester",
						model: "test"
					}
				],
				json: true
			},
			db,
			vectors
		);

		const ids = [
			(m1.structuredContent as { results: Array<{ id: string }> }).results[0].id,
			(m2.structuredContent as { results: Array<{ id: string }> }).results[0].id
		];

		// KG extraction is async (outbox worker, TASK-013) — drain it first.
		await drainOutbox(db);

		const readResult = await handleMemoryRead({ ids, owner: "test", repo: KG_REPO, json: true }, db, vectors);

		const data = readResult.structuredContent as Record<string, unknown>;
		expect(data.kg).toBeDefined();
		const kgContext = data.kg as { entities: Array<{ name: string }> };
		const entityNames = kgContext.entities.map((e: { name: string }) => e.name);
		// Should include entities from both memories
		expect(entityNames).toEqual(expect.arrayContaining(["Alice", "Bob", "Seattle", "Acme Corp"]));
	});

	it("includes aggregated kg in bulk detail by codes", async () => {
		const m1 = await handleMemoryWrite(
			{
				type: "code_fact",
				title: "Bulk Code KG A",
				content: "Charlie deployed the system to London",
				importance: 3,
				scope: { owner: "test", repo: KG_REPO },
				agent: "test",
				role: "tester",
				model: "test",
				memories: [
					{
						type: "code_fact",
						title: "Bulk Code KG A",
						content: "Charlie deployed the system to London",
						importance: 3,
						scope: { owner: "test", repo: KG_REPO },
						agent: "test",
						role: "tester",
						model: "test"
					}
				],
				json: true
			},
			db,
			vectors
		);
		const m2 = await handleMemoryWrite(
			{
				type: "code_fact",
				title: "Bulk Code KG B",
				content: "Diana deployed the office in London",
				importance: 3,
				scope: { owner: "test", repo: KG_REPO },
				agent: "test",
				role: "tester",
				model: "test",
				memories: [
					{
						type: "code_fact",
						title: "Bulk Code KG B",
						content: "Diana deployed the office in London",
						importance: 3,
						scope: { owner: "test", repo: KG_REPO },
						agent: "test",
						role: "tester",
						model: "test"
					}
				],
				json: true
			},
			db,
			vectors
		);

		const codes = [
			(m1.structuredContent as { results: Array<{ code: string }> }).results[0].code,
			(m2.structuredContent as { results: Array<{ code: string }> }).results[0].code
		];

		// KG extraction is async (outbox worker, TASK-013) — drain it first.
		await drainOutbox(db);

		const readResult = await handleMemoryRead({ codes, owner: "test", repo: KG_REPO, json: true }, db, vectors);

		const data = readResult.structuredContent as Record<string, unknown>;
		expect(data.kg).toBeDefined();
		const kgContext = data.kg as { entities: Array<{ name: string }> };
		const entityNames = kgContext.entities.map((e: { name: string }) => e.name);
		expect(entityNames).toEqual(expect.arrayContaining(["Charlie", "Diana", "London"]));
	});

	it("returns empty kg when memory has no associated entities", async () => {
		// Store memory with stopword-only content that won't extract entities
		const writeResult = await handleMemoryWrite(
			{
				type: "code_fact",
				title: "Boring Contextless",
				content: "the and of in to a this is just stopwords here now",
				importance: 3,
				scope: { owner: "test", repo: KG_REPO },
				agent: "test",
				role: "tester",
				model: "test",
				memories: [
					{
						type: "code_fact",
						title: "Boring Contextless",
						content: "the and of in to a this is just stopwords here now",
						importance: 3,
						scope: { owner: "test", repo: KG_REPO },
						agent: "test",
						role: "tester",
						model: "test"
					}
				],
				json: true
			},
			db,
			vectors
		);

		const memoryId = (writeResult.structuredContent as { results: Array<{ id: string }> }).results[0].id;

		const readResult = await handleMemoryRead({ id: memoryId, owner: "test", repo: KG_REPO, json: true }, db, vectors);

		const data = readResult.structuredContent as Record<string, unknown>;
		// kg should either be absent or have empty arrays
		if (data.kg) {
			const kgContext = data.kg as { entities: Array<unknown>; relations: Array<unknown> };
			expect(kgContext.entities).toHaveLength(0);
			expect(kgContext.relations).toHaveLength(0);
		}
	});
});

// ---------------------------------------------------------------------------
// Embedded KG context: task-read responses
// ---------------------------------------------------------------------------

describe("KG Archivist — embedded KG context in task-read", () => {
	let db: SQLiteStore;
	let vectors: VectorStore;

	const TASK_REPO = "kg-context-task-test";

	beforeEach(async () => {
		db = await createTestStore();
		vectors = makeMockVectorStore();
	});

	afterEach(() => {
		db.close();
	});

	it("includes kg when task title/description references known entities", async () => {
		// Pre-populate entities that a task might reference
		const now = new Date().toISOString();
		db.db
			.prepare(
				`INSERT INTO entities (name, type, description, repo, owner, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
			)
			.run("AuthModule", "concept", "Authentication module", TASK_REPO, "test", now, now);

		db.db
			.prepare(
				`INSERT INTO entities (name, type, description, repo, owner, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
			)
			.run("PostgreSQL", "concept", "Database system", TASK_REPO, "test", now, now);

		// Create a task whose title contains entity names
		const taskId = randomUUID();
		db.tasks.insertTask({
			id: taskId,
			task_code: "KG-TASK-001",
			phase: "Testing",
			title: "Refactor AuthModule for PostgreSQL compatibility",
			description: "Update the AuthModule to use PostgreSQL",
			status: "pending",
			priority: 3,
			owner: "test",
			repo: TASK_REPO,
			est_tokens: 0,
			tags: [],
			metadata: {},
			doc_path: "",
			agent: "test",
			role: "tester",
			model: "test",
			created_at: now,
			updated_at: now,
			in_progress_at: null,
			finished_at: null,
			canceled_at: null,
			hit_count: 0,
			comments_count: 0,
			last_used_at: null,
			coordination: {
				active_claim_count: 0,
				active_claim_agent: null,
				active_claim_role: null,
				active_claim_claimed_at: null,
				pending_handoff_count: 0,
				pending_handoff_summary: null,
				pending_handoff_to_agent: null
			}
		} as Task & {
			coordination: Record<string, unknown>;
			task_code: string;
			comments_count: number;
			last_used_at: string | null;
			hit_count: number;
		});

		const readResult = await handleTaskRead(
			{ task_code: "KG-TASK-001", owner: "test", repo: TASK_REPO, json: true },
			db,
			vectors
		);

		const data = readResult.structuredContent as Record<string, unknown>;
		expect(data.kg).toBeDefined();
		const kgContext = data.kg as { entities: Array<{ name: string }> };
		const entityNames = kgContext.entities.map((e: { name: string }) => e.name);
		expect(entityNames).toEqual(expect.arrayContaining(["AuthModule", "PostgreSQL"]));
	});

	it("returns empty kg when no entities match task text", async () => {
		const now = new Date().toISOString();
		// Entity exists but its name is not referenced in the task
		db.db
			.prepare(
				`INSERT INTO entities (name, type, description, repo, owner, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
			)
			.run("UnrelatedEntity", "concept", null, TASK_REPO, "test", now, now);

		const taskId = randomUUID();
		db.tasks.insertTask({
			id: taskId,
			task_code: "KG-TASK-002",
			phase: "Testing",
			title: "Simple task with no entity references",
			description: "No entity names appear in this text",
			status: "pending",
			priority: 3,
			owner: "test",
			repo: TASK_REPO,
			est_tokens: 0,
			tags: [],
			metadata: {},
			doc_path: "",
			agent: "test",
			role: "tester",
			model: "test",
			created_at: now,
			updated_at: now,
			in_progress_at: null,
			finished_at: null,
			canceled_at: null,
			hit_count: 0,
			comments_count: 0,
			last_used_at: null,
			coordination: {
				active_claim_count: 0,
				active_claim_agent: null,
				active_claim_role: null,
				active_claim_claimed_at: null,
				pending_handoff_count: 0,
				pending_handoff_summary: null,
				pending_handoff_to_agent: null
			}
		} as Task & {
			coordination: Record<string, unknown>;
			task_code: string;
			comments_count: number;
			last_used_at: string | null;
			hit_count: number;
		});

		const readResult = await handleTaskRead(
			{ task_code: "KG-TASK-002", owner: "test", repo: TASK_REPO, json: true },
			db,
			vectors
		);

		const data = readResult.structuredContent as Record<string, unknown>;
		if (data.kg) {
			const kgContext = data.kg as { entities: Array<unknown>; relations: Array<unknown> };
			expect(kgContext.entities).toHaveLength(0);
			expect(kgContext.relations).toHaveLength(0);
		}
	});
});

// ---------------------------------------------------------------------------
// Embedded KG context: standard-read responses
// ---------------------------------------------------------------------------

describe("KG Archivist — embedded KG context in standard-read", () => {
	let db: SQLiteStore;
	let vectors: VectorStore;

	const STD_REPO = "kg-context-standard-test";

	beforeEach(async () => {
		db = await createTestStore();
		vectors = makeMockVectorStore();
	});

	afterEach(() => {
		db.close();
	});

	it("includes kg when standard has associated entities via observation", async () => {
		const now = new Date().toISOString();

		// Insert a coding standard
		db.standards.insert({
			id: randomUUID(),
			code: "TEST-STD-001",
			title: "API Authentication Standard",
			content: "All API endpoints must use JWT tokens.",
			parent_id: null,
			context: "security",
			version: "1.0",
			language: null,
			stack: ["laravel"],
			is_global: false,
			owner: "test",
			repo: STD_REPO,
			tags: ["auth", "api"],
			metadata: {},
			created_at: now,
			updated_at: now,
			hit_count: 0,
			last_used_at: null,
			agent: "test",
			model: "test"
		});

		// Insert entities and observations with the pattern that fetchKgContext expects
		db.db
			.prepare(
				`INSERT INTO entities (name, type, description, repo, owner, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
			)
			.run("JWT", "concept", "JSON Web Token", STD_REPO, "test", now, now);

		db.db
			.prepare(
				`INSERT INTO entities (name, type, description, repo, owner, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
			)
			.run("OAuth2", "concept", "OAuth 2.0 protocol", STD_REPO, "test", now, now);

		// Create observations linking entities to the standard
		db.db
			.prepare(
				`INSERT INTO observations (id, entity_name, observation, repo, owner, created_at)
			 VALUES (?, ?, ?, ?, ?, ?)`
			)
			.run(randomUUID(), "JWT", "Mentioned in standard: API Authentication Standard", STD_REPO, "test", now);

		db.db
			.prepare(
				`INSERT INTO observations (id, entity_name, observation, repo, owner, created_at)
			 VALUES (?, ?, ?, ?, ?, ?)`
			)
			.run(randomUUID(), "OAuth2", "Mentioned in standard: API Authentication Standard", STD_REPO, "test", now);

		const readResult = await handleStandardRead(
			{ code: "TEST-STD-001", owner: "test", repo: STD_REPO, json: true },
			db,
			vectors
		);

		const data = readResult.structuredContent as Record<string, unknown>;
		expect(data.kg).toBeDefined();
		const kgContext = data.kg as { entities: Array<{ name: string }>; relations: Array<unknown> };
		const entityNames = kgContext.entities.map((e: { name: string }) => e.name);
		expect(entityNames).toEqual(expect.arrayContaining(["JWT", "OAuth2"]));
		// Observations are stored — no relations are created without explicit relation insertion
		expect(kgContext.relations).toBeDefined();
	});

	it("returns empty kg for standards without entity observations", async () => {
		const now = new Date().toISOString();

		// Standard with no corresponding observation records
		db.standards.insert({
			id: randomUUID(),
			code: "TEST-STD-002",
			title: "Unrelated Style Guide",
			content: "Use tabs for indentation.",
			parent_id: null,
			context: "style",
			version: "1.0",
			language: "typescript",
			stack: [],
			is_global: true,
			owner: "test",
			repo: null,
			tags: ["style"],
			metadata: {},
			created_at: now,
			updated_at: now,
			hit_count: 0,
			last_used_at: null,
			agent: "test",
			model: "test"
		});

		// Entities exist in DB but have no observation linking to this standard
		db.db
			.prepare(
				`INSERT INTO entities (name, type, description, repo, owner, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
			)
			.run("Tabs", "concept", null, STD_REPO, "test", now, now);

		const readResult = await handleStandardRead(
			{ code: "TEST-STD-002", owner: "test", repo: STD_REPO, json: true },
			db,
			vectors
		);

		const data = readResult.structuredContent as Record<string, unknown>;
		if (data.kg) {
			const kgContext = data.kg as { entities: Array<unknown>; relations: Array<unknown> };
			expect(kgContext.entities).toHaveLength(0);
			expect(kgContext.relations).toHaveLength(0);
		}
	});

	it("includes aggregated kg in standard bulk detail by ids", async () => {
		const now = new Date().toISOString();

		// Two standards
		db.standards.insert({
			id: "std-bulk-1",
			code: "STD-B1",
			title: "Std Bulk A",
			content: "Content A",
			parent_id: null,
			context: "test",
			version: "1.0",
			language: null,
			stack: [],
			is_global: false,
			owner: "test",
			repo: STD_REPO,
			tags: [],
			metadata: {},
			created_at: now,
			updated_at: now,
			hit_count: 0,
			last_used_at: null,
			agent: "test",
			model: "test"
		});
		db.standards.insert({
			id: "std-bulk-2",
			code: "STD-B2",
			title: "Std Bulk B",
			content: "Content B",
			parent_id: null,
			context: "test",
			version: "1.0",
			language: null,
			stack: [],
			is_global: false,
			owner: "test",
			repo: STD_REPO,
			tags: [],
			metadata: {},
			created_at: now,
			updated_at: now,
			hit_count: 0,
			last_used_at: null,
			agent: "test",
			model: "test"
		});

		// One entity linked to both standards
		db.db
			.prepare(
				`INSERT INTO entities (name, type, description, repo, owner, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
			)
			.run("SharedEntity", "concept", null, STD_REPO, "test", now, now);

		db.db
			.prepare(
				`INSERT INTO observations (id, entity_name, observation, repo, owner, created_at)
			 VALUES (?, ?, ?, ?, ?, ?)`
			)
			.run(randomUUID(), "SharedEntity", "Mentioned in standard: Std Bulk A", STD_REPO, "test", now);
		db.db
			.prepare(
				`INSERT INTO observations (id, entity_name, observation, repo, owner, created_at)
			 VALUES (?, ?, ?, ?, ?, ?)`
			)
			.run(randomUUID(), "SharedEntity", "Mentioned in standard: Std Bulk B", STD_REPO, "test", now);

		const readResult = await handleStandardRead(
			{ ids: ["std-bulk-1", "std-bulk-2"], owner: "test", repo: STD_REPO, json: true },
			db,
			vectors
		);

		const data = readResult.structuredContent as Record<string, unknown>;
		expect(data.kg).toBeDefined();
		const kgContext = data.kg as { entities: Array<{ name: string }> };
		const entityNames = kgContext.entities.map((e: { name: string }) => e.name);
		expect(entityNames).toContain("SharedEntity");
	});
});
