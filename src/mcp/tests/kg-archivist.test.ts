import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { extractEntities, saveExtractions } from "../tools/kg-archivist";
import { handleMemoryStore } from "../tools/memory.store";
import { createTestStore, SQLiteStore } from "../storage/sqlite";
import { VectorStore } from "../types/vector";

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

// ---------------------------------------------------------------------------
// extractEntities
// ---------------------------------------------------------------------------

describe("KG Archivist — extractEntities", () => {
	describe("people extraction", () => {
		it("extracts people from text with proper names", () => {
			const result = extractEntities("Alice and Bob worked on the project");
			const people = result.filter((e) => e.type === "person");
			// compromise should detect "Alice" and "Bob" as named people
			expect(people.length).toBeGreaterThanOrEqual(2);
			const names = people.map((p) => p.name);
			expect(names).toEqual(expect.arrayContaining(["Alice", "Bob"]));
		});

		it("deduplicates people regardless of case", () => {
			const result = extractEntities("Alice talked to alice about the design");
			const people = result.filter((e) => e.type === "person");
			const names = people.map((p) => p.name.toLowerCase());
			const unique = new Set(names);
			expect(unique.size).toBe(names.length);
		});
	});

	describe("places extraction", () => {
		it("extracts place names from text", () => {
			const result = extractEntities("The deployment was in Seattle");
			const places = result.filter((e) => e.type === "place");
			expect(places.length).toBeGreaterThanOrEqual(1);
			const names = places.map((p) => p.name);
			expect(names).toContain("Seattle");
		});

		it("extracts multiple places", () => {
			const result = extractEntities("The team traveled from London to Paris for the conference");
			const places = result.filter((e) => e.type === "place");
			const names = places.map((p) => p.name);
			expect(names).toContain("London");
			expect(names).toContain("Paris");
		});
	});

	describe("organizations extraction", () => {
		it("extracts organization names", () => {
			const result = extractEntities("Acme Corp acquired Startup Inc");
			const orgs = result.filter((e) => e.type === "organization");
			expect(orgs.length).toBeGreaterThanOrEqual(2);
			const names = orgs.map((o) => o.name);
			expect(names).toEqual(expect.arrayContaining(["Acme Corp", "Startup Inc"]));
		});

		it("extracts well-known organizations", () => {
			const result = extractEntities("Google and Microsoft announced a partnership");
			const orgs = result.filter((e) => e.type === "organization");
			const names = orgs.map((o) => o.name);
			expect(names).toContain("Google");
			expect(names).toContain("Microsoft");
		});
	});

	describe("concepts extraction", () => {
		it("extracts technical concepts from text", () => {
			const result = extractEntities("The microservices architecture improved scalability and maintainability");
			const concepts = result.filter((e) => e.type === "concept");
			expect(concepts.length).toBeGreaterThanOrEqual(1);
			const names = concepts.map((c) => c.name.toLowerCase());
			expect(names).toContain("microservices architecture");
		});

		it("filters out pronouns from concepts", () => {
			const result = extractEntities("He said she would handle it themselves");
			const concepts = result.filter((e) => e.type === "concept");
			const names = concepts.map((c) => c.name.toLowerCase());
			// Pronouns should be excluded
			expect(names).not.toContain("he");
			expect(names).not.toContain("she");
			expect(names).not.toContain("it");
			expect(names).not.toContain("themselves");
		});

		it("filters out common stopwords from concepts", () => {
			const result = extractEntities("The thing is a very complex problem");
			const concepts = result.filter((e) => e.type === "concept");
			const names = concepts.map((c) => c.name.toLowerCase());
			expect(names).not.toContain("the");
			expect(names).not.toContain("thing");
			expect(names).not.toContain("very");
			expect(names).not.toContain("problem");
		});

		it("removes leading determiners from concept noun phrases", () => {
			const result = extractEntities("The database schema needs a new index");
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
		it("does not return the same name twice", () => {
			const result = extractEntities("Alice and Bob worked on the project with Alice again");
			const names = result.map((e) => e.name.toLowerCase());
			const unique = new Set(names);
			expect(unique.size).toBe(names.length);
		});
	});

	describe("edge cases", () => {
		it("returns empty array for empty string", () => {
			expect(extractEntities("")).toEqual([]);
		});

		it("returns empty array for whitespace-only string", () => {
			expect(extractEntities("   ")).toEqual([]);
		});

		it("returns empty array for string with only newlines", () => {
			expect(extractEntities("\n\n\r\n")).toEqual([]);
		});

		it("handles short content (fewer than 10 characters) gracefully", () => {
			const result = extractEntities("Hi");
			expect(Array.isArray(result)).toBe(true);
		});

		it("handles single-word content", () => {
			const result = extractEntities("Hello");
			expect(Array.isArray(result)).toBe(true);
		});

		it("handles content with only stopwords", () => {
			const result = extractEntities("the and of in to a an is");
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

	it("inserts extracted entities into the entities table", () => {
		saveExtractions("Alice and Bob worked on the project", "Test Memory", "test-owner", "test-repo", db);

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

	it("inserts observation records linking entities to the memory title", () => {
		saveExtractions("Alice and Bob worked on the project", "Test Memory", "owner", "repo", db);

		const observations = db.db.prepare("SELECT entity_name, observation FROM observations").all() as Array<{
			entity_name: string;
			observation: string;
		}>;

		expect(observations.length).toBeGreaterThan(0);
		for (const obs of observations) {
			expect(obs.observation).toBe("Mentioned in memory: Test Memory");
		}
	});

	it("uses INSERT OR IGNORE for duplicate entity names", () => {
		saveExtractions("Alice and Bob worked on the project", "Memory 1", "owner", "repo", db);
		const count1 = (db.db.prepare("SELECT COUNT(*) as cnt FROM entities").get() as { cnt: number }).cnt;

		// Same content again — duplicate names should be ignored
		saveExtractions("Alice and Bob worked on the project", "Memory 2", "owner", "repo", db);
		const count2 = (db.db.prepare("SELECT COUNT(*) as cnt FROM entities").get() as { cnt: number }).cnt;

		// Count should be the same — INSERT OR IGNORE prevents duplicates
		expect(count2).toBe(count1);
	});

	it("still creates observation records on duplicate entity insert", () => {
		saveExtractions("Alice worked on the project", "Memory 1", "owner", "repo", db);
		const obs1 = (db.db.prepare("SELECT COUNT(*) as cnt FROM observations").get() as { cnt: number }).cnt;

		saveExtractions("Alice worked on the project again", "Memory 2", "owner", "repo", db);
		const obs2 = (db.db.prepare("SELECT COUNT(*) as cnt FROM observations").get() as { cnt: number }).cnt;

		// Observations are fresh INSERTs, so count should increase even if entity already exists
		expect(obs2).toBeGreaterThan(obs1);
	});

	it("does nothing when content is empty", () => {
		saveExtractions("", "Empty Memory", "owner", "repo", db);
		const entities = db.db.prepare("SELECT COUNT(*) as cnt FROM entities").get() as { cnt: number };
		expect(entities.cnt).toBe(0);
		const observations = db.db.prepare("SELECT COUNT(*) as cnt FROM observations").get() as { cnt: number };
		expect(observations.cnt).toBe(0);
	});

	it("does nothing when content is whitespace only", () => {
		saveExtractions("   ", "Whitespace Memory", "owner", "repo", db);
		const entities = db.db.prepare("SELECT COUNT(*) as cnt FROM entities").get() as { cnt: number };
		expect(entities.cnt).toBe(0);
	});

	it("processes content longer than 5000 characters by truncating", () => {
		const longContent = "Alice and Bob " + "x".repeat(5000);
		saveExtractions(longContent, "Long Memory", "owner", "repo", db);

		// Should not throw and should process the first part
		const entities = db.db.prepare("SELECT COUNT(*) as cnt FROM entities").get() as { cnt: number };
		expect(entities.cnt).toBeGreaterThan(0);
	});

	it("stores entity with correct columns (name, type, description, repo, owner)", () => {
		saveExtractions("Alice worked on the deployment in Seattle", "Test Memory", "owner", "repo", db);

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

	it("handles content with mixed entity types across multiple calls", () => {
		saveExtractions("Alice works at Acme Corp", "Memory 1", "owner", "repo", db);
		saveExtractions("The deployment was in Seattle", "Memory 2", "owner", "repo", db);

		const entities = db.db.prepare("SELECT DISTINCT type FROM entities").all() as Array<{ type: string }>;
		const types = entities.map((e) => e.type);

		// Should have at least person and place types
		expect(types).toContain("person");
		expect(types).toContain("place");
	});

	it("does not throw when NLP extraction fails on malformed input", () => {
		// saveExtractions catches extraction errors internally
		// Sending null-like content should be safe
		expect(() => {
			saveExtractions("", "No Content", "owner", "repo", db);
		}).not.toThrow();
	});

	it("maintains referential integrity between entities and observations", () => {
		saveExtractions("Alice worked on the project", "Test Memory", "owner", "repo", db);

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
// Integration: handleMemoryStore → saveExtractions
// ---------------------------------------------------------------------------

describe("KG Archivist — integration with handleMemoryStore", () => {
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
		await handleMemoryStore(
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
				structured: false
			},
			db,
			vectors
		);

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
		await handleMemoryStore(
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
				structured: false
			},
			db,
			vectors
		);

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
		await handleMemoryStore(
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
				structured: false
			},
			db,
			vectors
		);

		const entities = db.db.prepare("SELECT name FROM entities").all() as Array<{ name: string }>;
		const names = entities.map((e) => e.name);

		expect(names).toEqual(expect.arrayContaining(["Alice", "Bob", "Seattle"]));
	});

	it("does not block the memory store operation when extraction produces no entities", async () => {
		const result = await handleMemoryStore(
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
				structured: false
			},
			db,
			vectors
		);

		// Memory store itself should succeed
		expect(result.isError).toBeFalsy();

		// No entities should have been extracted
		const entities = db.db.prepare("SELECT COUNT(*) as cnt FROM entities").get() as { cnt: number };
		expect(entities.cnt).toBe(0);
	});
});
