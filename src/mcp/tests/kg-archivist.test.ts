import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "crypto";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	extractEntities,
	saveExtractions,
	saveTaskRelations,
	saveCodebaseRelations,
	observationText
} from "../tools/kg-archivist";
import { logger } from "../utils/logger";
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
// Server-side graph edge cap (TASK-070)
// ---------------------------------------------------------------------------

describe("KnowledgeGraphEntity — server-side graph edge cap (TASK-070)", () => {
	let db: SQLiteStore;

	const REPO = "kg-graph-cap-test";

	/** Insert the node subset + edges and return the expected degree ranks. */
	function seedGraph(): void {
		const now = new Date().toISOString();
		for (const name of ["A", "B", "C", "D"]) {
			db.db
				.prepare(
					"INSERT INTO entities (name, type, description, repo, owner, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
				)
				.run(name, "concept", null, REPO, "test", now, now);
		}
		// Edges: A→B, A→C, B→C, D→A, B→D
		const edges: Array<[string, string]> = [
			["A", "B"],
			["A", "C"],
			["B", "C"],
			["D", "A"],
			["B", "D"]
		];
		for (const [from, to] of edges) {
			db.knowledgeGraph.upsertRelation({
				from_entity: from,
				to_entity: to,
				relation_type: "related_to",
				repo: REPO,
				owner: "test",
				created_at: now
			});
		}
	}

	beforeEach(async () => {
		db = await createTestStore();
		seedGraph();
	});

	afterEach(() => {
		db.close();
	});

	it("listGraphEdges caps to top-N by endpoint degree, not a random slice", () => {
		// Degrees: A=3 (AB,AC,DA), B=3 (AB,BC,BD), C=2 (AC,BC), D=2 (DA,BD).
		// A→B has the highest combined degree (3+3=6); the rest tie at 5 and
		// fall back to (from_entity, to_entity) ordering.
		const edges = db.knowledgeGraph.listGraphEdges(REPO, 2);
		expect(edges).toHaveLength(2);
		expect(edges[0]).toEqual({ source: "A", target: "B", relation_type: "related_to" });
		expect(edges[1]).toEqual({ source: "A", target: "C", relation_type: "related_to" });
	});

	it("listGraphEdges returns everything below the cap", () => {
		const edges = db.knowledgeGraph.listGraphEdges(REPO);
		expect(edges.length).toBe(5); // 5 edges < default KG_MAX_GRAPH_EDGES
	});

	it("listRelationsForGraph filters edges to the node subset (both endpoints in set)", () => {
		const rels = db.knowledgeGraph.listRelationsForGraph(REPO, ["A", "B"]);
		expect(rels).toHaveLength(1); // only A→B has both endpoints in {A, B}
		expect(rels[0].from_entity).toBe("A");
		expect(rels[0].to_entity).toBe("B");
	});

	it("listRelationsForGraph with an empty node subset ships no edges", () => {
		expect(db.knowledgeGraph.listRelationsForGraph(REPO, [])).toHaveLength(0);
	});

	it("listRelationsForGraph keeps legacy behavior when no subset is given", () => {
		const rels = db.knowledgeGraph.listRelationsForGraph(REPO);
		expect(rels.length).toBe(5);
	});
});

// ---------------------------------------------------------------------------
// Probe/truncated flag (TASK-148)
//
// listGraphEdges with probe=true requests limit+1 rows so callers can detect
// truncation without a separate COUNT query. The extra probe row is never
// returned to the client — the caller slices to limit before shipping.
// ---------------------------------------------------------------------------

describe("KnowledgeGraphEntity — probe/truncated detection (TASK-148)", () => {
	let db: SQLiteStore;

	const REPO = "kg-probe-test";
	const CAP = 4; // small cap for testing

	beforeEach(async () => {
		db = await createTestStore();
		const now = new Date().toISOString();
		// Seed 6 entities (A–F) and 6 edges so we exceed CAP.
		for (const name of ["A", "B", "C", "D", "E", "F"]) {
			db.db
				.prepare(
					"INSERT INTO entities (name, type, description, repo, owner, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
				)
				.run(name, "concept", null, REPO, "test", now, now);
		}
		const edges: Array<[string, string]> = [
			["A", "B"],
			["A", "C"],
			["B", "C"],
			["D", "E"],
			["E", "F"],
			["F", "A"]
		];
		for (const [from, to] of edges) {
			db.knowledgeGraph.upsertRelation({
				from_entity: from,
				to_entity: to,
				relation_type: "related_to",
				repo: REPO,
				owner: "test",
				created_at: now
			});
		}
	});

	afterEach(() => {
		db.close();
	});

	it("probe=true returns cap+1 rows when graph exceeds cap", () => {
		const edges = db.knowledgeGraph.listGraphEdges(REPO, CAP, true);
		// 6 edges > CAP (4), so probe returns CAP+1 = 5 rows
		expect(edges).toHaveLength(CAP + 1);
	});

	it("probe=false (default) returns exactly cap rows when graph exceeds cap", () => {
		const edges = db.knowledgeGraph.listGraphEdges(REPO, CAP, false);
		expect(edges).toHaveLength(CAP);
	});

	it("probe=true returns all rows when graph is at or below cap", () => {
		// Use a high cap so all 6 edges fit
		const edges = db.knowledgeGraph.listGraphEdges(REPO, 10, true);
		expect(edges).toHaveLength(6);
	});

	it("probe detection: truncated = rawEdges.length > cap", () => {
		const rawEdges = db.knowledgeGraph.listGraphEdges(REPO, CAP, true);
		const truncated = rawEdges.length > CAP;
		expect(truncated).toBe(true);

		// Caller slices to cap
		const edges = truncated ? rawEdges.slice(0, CAP) : rawEdges;
		expect(edges).toHaveLength(CAP);
	});

	it("no-truncation detection: truncated = false when at cap", () => {
		// Use CAP equal to total edges
		const rawEdges = db.knowledgeGraph.listGraphEdges(REPO, 6, true);
		const truncated = rawEdges.length > 6;
		expect(truncated).toBe(false);
		expect(rawEdges).toHaveLength(6);
	});
});

// ---------------------------------------------------------------------------
// Subset-bounded graph edges (TASK-268 / audit F2)
//
// The dashboard graph payload is assembled from the fetched top-N node
// window: listGraphEdgesForSubset returns ONLY edges whose BOTH endpoints
// are in that window (every shipped edge is drawable) and ranks them by
// endpoint degree via the materialized kg_degrees cache (migration v22).
// This bounds the edge query to the window instead of sorting ALL of the
// repo's relations per request (the former ~23s warm / ~190s cold path).
// ---------------------------------------------------------------------------

describe("KnowledgeGraphEntity — subset-bounded graph edges (TASK-268)", () => {
	let db: SQLiteStore;

	const REPO = "kg-subset-test";

	function seedGraph() {
		const now = new Date().toISOString();
		// Entities A–D; edges: AB, AC, BC, DA, BD.
		// Degrees: A=3 (AB,AC,DA), B=3 (AB,BC,BD), C=2 (AC,BC), D=2 (DA,BD).
		for (const name of ["A", "B", "C", "D"]) {
			db.knowledgeGraph.upsertEntity({
				name,
				type: "concept",
				description: null,
				repo: REPO,
				owner: "test",
				created_at: now,
				updated_at: now
			});
		}
		const edges: Array<[string, string]> = [
			["A", "B"],
			["A", "C"],
			["B", "C"],
			["D", "A"],
			["B", "D"]
		];
		for (const [from, to] of edges) {
			db.knowledgeGraph.upsertRelation({
				from_entity: from,
				to_entity: to,
				relation_type: "related_to",
				repo: REPO,
				owner: "test",
				created_at: now
			});
		}
	}

	beforeEach(async () => {
		db = await createTestStore();
		seedGraph();
	});

	afterEach(() => {
		db.close();
	});

	it("returns only edges with BOTH endpoints in the subset", () => {
		const edges = db.knowledgeGraph.listGraphEdgesForSubset(REPO, ["A", "B"]);
		expect(edges).toHaveLength(1); // only A→B is fully inside {A, B}
		expect(edges[0]).toEqual({ source: "A", target: "B", relation_type: "related_to" });
	});

	it("ranks subset edges by endpoint degree like the full graph", () => {
		// Combined degrees: AB=6, AC=5, BC=5, BD=5, DA=5 (ties by from,to).
		const edges = db.knowledgeGraph.listGraphEdgesForSubset(REPO, ["A", "B", "C", "D"], 2);
		expect(edges).toHaveLength(2);
		expect(edges[0]).toEqual({ source: "A", target: "B", relation_type: "related_to" });
		expect(edges[1]).toEqual({ source: "A", target: "C", relation_type: "related_to" });
	});

	it("probe=true returns cap+1 rows so callers detect truncation", () => {
		// 5 subset edges > cap 4 → probe returns 5 rows; caller slices to 4.
		const raw = db.knowledgeGraph.listGraphEdgesForSubset(REPO, ["A", "B", "C", "D"], 4, true);
		expect(raw).toHaveLength(5);
		const truncated = raw.length > 4;
		expect(truncated).toBe(true);
		expect(truncated ? raw.slice(0, 4) : raw).toHaveLength(4);
	});

	it("returns everything below the cap and empty for an empty subset", () => {
		expect(db.knowledgeGraph.listGraphEdgesForSubset(REPO, ["A", "B", "C", "D"])).toHaveLength(5);
		expect(db.knowledgeGraph.listGraphEdgesForSubset(REPO, [])).toHaveLength(0);
	});

	it("degree cache stays consistent across writes and deletes", () => {
		// Insert a new relation B→A (self-loop-free, both endpoints existing):
		// degree of A and B should bump to 4.
		const now = new Date().toISOString();
		db.knowledgeGraph.upsertRelation({
			from_entity: "B",
			to_entity: "A",
			relation_type: "backlink",
			repo: REPO,
			owner: "test",
			created_at: now
		});
		const degreeRow = db.db.prepare("SELECT degree FROM kg_degrees WHERE repo = ? AND node = ?").get(REPO, "A") as {
			degree: number;
		};
		expect(degreeRow.degree).toBe(4);

		// Deleting the relation decrements back to 3.
		db.knowledgeGraph.deleteRelation("B", "A", "backlink");
		const after = db.db.prepare("SELECT degree FROM kg_degrees WHERE repo = ? AND node = ?").get(REPO, "A") as {
			degree: number;
		};
		expect(after.degree).toBe(3);

		// Edge set reflects the mutation (backlink now absent).
		const edges = db.knowledgeGraph.listGraphEdgesForSubset(REPO, ["A", "B", "C", "D"]);
		expect(edges).toHaveLength(5);
		expect(edges.some((e) => e.relation_type === "backlink")).toBe(false);
	});

	it("listGraphNodes is degree-ordered via the kg_degrees cache", () => {
		const nodes = db.knowledgeGraph.listGraphNodes(REPO, { limit: 10 });
		// A and B tie at degree 3; name ordering breaks the tie.
		expect(nodes[0].name).toBe("A");
		expect(nodes[1].name).toBe("B");
		expect(
			nodes
				.map((n) => n.name)
				.slice(0, 4)
				.sort()
		).toEqual(["A", "B", "C", "D"]);
	});
});

// ---------------------------------------------------------------------------
// saveTaskRelations — FK integrity (TASK-065 / MEM-473)
//
// depends_on/extends/related_to relations reference entities extracted
// on-the-fly from ANOTHER document (the parent/similar standard). Those
// endpoint entities can be orphan-swept while the child still points at the
// parent, so every relation insert MUST resolve-or-upsert BOTH endpoints
// first (KnowledgeGraphEntity.ensureRelation) or the relations FK
// (from_entity/to_entity → entities(name), PRAGMA foreign_keys=ON) throws
// `FOREIGN KEY constraint failed` — swallowed into a warn flood. Canceled
// parents are skipped entirely (their entities were already swept).
// ---------------------------------------------------------------------------

describe("KG Archivist — saveTaskRelations FK integrity (TASK-065)", () => {
	let db: SQLiteStore;

	const REPO = "kg-fk-test";
	const PARENT_TITLE = "[PARENT] Gold Standard Compliance (Aesthetics & Icons)";
	const PARENT_DESCRIPTION = "Enforces quality standards and implementation details for the Icons theme";
	const CHILD_TITLE = "Payroll Module";
	const CHILD_DESCRIPTION = "Payroll Module implementation aligned with quality standards and Icons";
	// Deterministic endpoints (verified against extractEntities): the parent
	// document extracts "Icons theme", the child extracts "Payroll Module
	// implementation" — the exact "missing TO endpoint" pair from the RCA.
	const PARENT_ENTITY = "Icons theme";
	const CHILD_ENTITY = "Payroll Module implementation";

	function makeTask(overrides: Partial<Task> = {}): Task {
		const now = new Date().toISOString();
		return {
			id: randomUUID(),
			owner: "test",
			repo: REPO,
			task_code: `KG-${randomUUID().slice(0, 6)}`,
			phase: "implementation",
			title: "test task",
			description: null,
			status: "backlog",
			priority: 3,
			agent: "test",
			role: "backend",
			doc_path: null,
			created_at: now,
			updated_at: now,
			in_progress_at: null,
			finished_at: null,
			canceled_at: null,
			est_tokens: 0,
			commit_id: null,
			changed_files: [],
			tags: [],
			suggested_skills: [],
			metadata: {},
			parent_id: null,
			depends_on: null,
			...overrides
		};
	}

	function getDependsOn(from: string, to: string): Record<string, unknown> | undefined {
		return db.db
			.prepare("SELECT * FROM relations WHERE from_entity = ? AND to_entity = ? AND relation_type = 'depends_on'")
			.get(from, to) as Record<string, unknown> | undefined;
	}

	beforeEach(async () => {
		db = await createTestStore();
	});

	afterEach(() => {
		db.close();
		vi.restoreAllMocks();
	});

	it("sweep-parents repro: re-upserts swept endpoint entities and re-inserts depends_on with no FK failure and no warn", async () => {
		const parent = makeTask({ title: PARENT_TITLE, description: PARENT_DESCRIPTION, status: "completed" });
		const child = makeTask({
			title: CHILD_TITLE,
			description: CHILD_DESCRIPTION,
			status: "pending",
			parent_id: parent.id
		});
		db.tasks.insertTask(parent);
		db.tasks.insertTask(child);

		// First pass: ensureRelation upserts BOTH endpoints and inserts the edge.
		await saveTaskRelations(CHILD_DESCRIPTION, CHILD_TITLE, "test", REPO, db, { parentId: parent.id });
		expect(db.knowledgeGraph.getEntityByName(PARENT_ENTITY)).toBeDefined();
		expect(getDependsOn(CHILD_ENTITY, PARENT_ENTITY)).toBeDefined();

		// Simulate the orphan sweep of the parent document's entities
		// (deleteEntity cascades the depends_on edge away — the exact
		// post-sweep state that used to flood FK warnings on reprocess).
		db.knowledgeGraph.deleteEntity(PARENT_ENTITY);
		expect(db.knowledgeGraph.getEntityByName(PARENT_ENTITY)).toBeUndefined();
		expect(getDependsOn(CHILD_ENTITY, PARENT_ENTITY)).toBeUndefined();

		// Reprocessing the child after the sweep: ensureRelation must upsert
		// the swept endpoint and re-insert the edge — no FK failure, no warn.
		const warnSpy = vi.spyOn(logger, "warn");
		await saveTaskRelations(CHILD_DESCRIPTION, CHILD_TITLE, "test", REPO, db, { parentId: parent.id });

		expect(db.knowledgeGraph.getEntityByName(PARENT_ENTITY)).toBeDefined();
		expect(getDependsOn(CHILD_ENTITY, PARENT_ENTITY)).toBeDefined();
		const fkWarns = warnSpy.mock.calls.filter((call) => String(call[0]).includes("Failed to save depends_on relation"));
		expect(fkWarns).toHaveLength(0);
	});

	it("skips canceled parents — no depends_on relations are attempted", async () => {
		const parent = makeTask({
			title: PARENT_TITLE,
			description: PARENT_DESCRIPTION,
			status: "canceled",
			canceled_at: new Date().toISOString()
		});
		const child = makeTask({
			title: CHILD_TITLE,
			description: CHILD_DESCRIPTION,
			status: "pending",
			parent_id: parent.id
		});
		db.tasks.insertTask(parent);
		db.tasks.insertTask(child);

		await saveTaskRelations(CHILD_DESCRIPTION, CHILD_TITLE, "test", REPO, db, { parentId: parent.id });

		// No depends_on edges and no entity resurrected from the canceled
		// parent's content (its entities were already swept).
		const dependsOn = db.db
			.prepare("SELECT COUNT(*) as cnt FROM relations WHERE relation_type = 'depends_on'")
			.get() as { cnt: number };
		expect(dependsOn.cnt).toBe(0);
		expect(db.knowledgeGraph.getEntityByName(PARENT_ENTITY)).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// ensureRelation atomicity (TASK-072)
//
// ensureRelation wraps the 2 endpoint upserts + the relation insert in a
// single BEGIN IMMEDIATE transaction (base.ts `transaction()` is immediate
// per TASK-064 / MEM-475). These tests pin that contract: a failure anywhere
// rolls back EVERYTHING (no half-written endpoint entities), and a nested
// call inside an outer transaction commits atomically via savepoints
// (better-sqlite3 reentrancy). Without the transaction wrapper the endpoint
// upserts would autocommit and survive the failed relation insert — the
// exact regression the rollback test guards against (TASK-078 finding).
// ---------------------------------------------------------------------------

describe("KnowledgeGraphEntity — ensureRelation atomicity (TASK-072)", () => {
	let db: SQLiteStore;

	const REPO = "kg-atomicity-test";

	beforeEach(async () => {
		db = await createTestStore();
	});

	afterEach(() => {
		db.close();
		vi.restoreAllMocks();
	});

	it("rolls back both endpoint upserts when the relation insert throws", () => {
		const now = new Date().toISOString();

		// Simulate a mid-transaction failure: the relation insert throws after
		// the two endpoint upserts already ran inside the transaction.
		const upsertRelationSpy = vi.spyOn(db.knowledgeGraph, "upsertRelation").mockImplementation(() => {
			throw new Error("boom");
		});

		expect(() =>
			db.knowledgeGraph.ensureRelation({
				from_entity: "A",
				from_type: "concept",
				to_entity: "B",
				to_type: "concept",
				relation_type: "related_to",
				repo: REPO,
				owner: "test",
				created_at: now
			})
		).toThrow("boom");

		// The failure came from the relation insert (last step of ensureRelation).
		expect(upsertRelationSpy).toHaveBeenCalledTimes(1);

		// Rollback proof: neither endpoint survives the failed relation insert.
		// Without the BEGIN IMMEDIATE wrapper these would have autocommitted.
		expect(db.knowledgeGraph.getEntityByName("A")).toBeUndefined();
		expect(db.knowledgeGraph.getEntityByName("B")).toBeUndefined();
	});

	it("nested inside an outer transaction, ensureRelation commits atomically via savepoints", () => {
		const now = new Date().toISOString();

		// Outer BEGIN IMMEDIATE; each nested ensureRelation runs inside a
		// SAVEPOINT and releases it on success, so every write commits together
		// when the outer transaction commits.
		db.db
			.transaction(() => {
				db.knowledgeGraph.ensureRelation({
					from_entity: "A",
					from_type: "concept",
					to_entity: "B",
					to_type: "concept",
					relation_type: "related_to",
					repo: REPO,
					owner: "test",
					created_at: now
				});
				db.knowledgeGraph.ensureRelation({
					from_entity: "C",
					from_type: "concept",
					to_entity: "D",
					to_type: "concept",
					relation_type: "related_to",
					repo: REPO,
					owner: "test",
					created_at: now
				});
			})
			.immediate();

		// Both endpoint pairs and both edges committed atomically.
		expect(db.knowledgeGraph.getEntityByName("A")).toBeDefined();
		expect(db.knowledgeGraph.getEntityByName("B")).toBeDefined();
		expect(db.knowledgeGraph.getEntityByName("C")).toBeDefined();
		expect(db.knowledgeGraph.getEntityByName("D")).toBeDefined();
		expect(db.knowledgeGraph.listRelations(REPO)).toHaveLength(2);
	});
});

// ---------------------------------------------------------------------------
// Entity+observation pair atomicity (TASK-073)
//
// saveExtractions/saveStandardRelations write each entity AND its observation
// through KnowledgeGraphEntity.ensureObservation, which wraps the pair in a
// single BEGIN IMMEDIATE transaction (base.ts `transaction()` is immediate per
// TASK-064 / MEM-475). The observations.entity_name → entities(name) FK used
// to be written as two autocommit statements: a concurrent orphan-sweep
// (deleteOrphanEntities) could delete the fresh entity between the upsert and
// the observation insert and fail the FK. These tests pin the contract:
// (1) a failed observation insert rolls back the entity upsert (no
// half-written pair), and (2) a real orphan sweep from a SECOND connection is
// blocked by the write lock — it cannot delete the endpoint between the upsert
// and the observation insert.
// ---------------------------------------------------------------------------

describe("KG Archivist — entity+observation pair atomicity (TASK-073)", () => {
	let db: SQLiteStore;

	const REPO = "kg-obs-atomicity-test";

	beforeEach(async () => {
		db = await createTestStore();
	});

	afterEach(() => {
		db.close();
		vi.restoreAllMocks();
	});

	it("rolls back the entity upsert when the observation insert throws (pair is atomic)", () => {
		const now = new Date().toISOString();

		// Simulate a mid-pair failure: the observation insert throws after the
		// entity upsert already ran inside the transaction.
		vi.spyOn(db.knowledgeGraph, "insertObservation").mockImplementation(() => {
			throw new Error("boom");
		});

		expect(() =>
			db.knowledgeGraph.ensureObservation({
				id: randomUUID(),
				name: "A",
				type: "concept",
				description: null,
				observation: "Mentioned in memory: X",
				repo: REPO,
				owner: "test",
				created_at: now
			})
		).toThrow("boom");

		// Rollback proof: the entity must NOT survive the failed observation
		// insert. Without the BEGIN IMMEDIATE wrapper the upsert would have
		// autocommitted and left an orphaned entity (referenced by neither an
		// observation nor a relation) — the exact regression this guards.
		expect(db.knowledgeGraph.getEntityByName("A")).toBeUndefined();
	});

	it("an orphan sweep from a second connection cannot delete an endpoint between its upsert and observation insert", async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kg-obs-sweep-"));
		const dbPath = path.join(tempDir, "test.db");
		const fileDb = await SQLiteStore.create(dbPath);

		// Second raw connection simulating the dashboard-worker orphan sweep.
		// Fail fast (100ms) so the test never waits the full 5s busy timeout.
		const sweeper = new Database(dbPath);
		sweeper.pragma("busy_timeout = 100");
		sweeper.pragma("foreign_keys = ON");

		const sweepOrphans = (): void => {
			sweeper.exec(`DELETE FROM entities WHERE name NOT IN (
				SELECT DISTINCT entity_name FROM observations
				UNION
				SELECT DISTINCT from_entity FROM relations
				UNION
				SELECT DISTINCT to_entity FROM relations
			)`);
		};

		try {
			let sweepBlocked = false;
			const upsertSpy = vi.spyOn(fileDb.knowledgeGraph, "upsertEntity").mockImplementation((params) => {
				// Restore the real implementation and run the real upsert —
				// still INSIDE the BEGIN IMMEDIATE transaction started by
				// ensureObservation (base.ts `transaction()` is immediate).
				upsertSpy.mockRestore();
				fileDb.knowledgeGraph.upsertEntity(params);

				// Attempt the orphan sweep on the OTHER connection immediately
				// after the upsert. With the fix the write lock is held, so the
				// sweep gets SQLITE_BUSY and cannot delete the fresh entity.
				// (Without the fix the upsert would have autocommitted, the
				// sweep would delete the orphan entity, and the observation
				// insert would fail the FK — the regression this test guards.)
				try {
					sweepOrphans();
				} catch {
					sweepBlocked = true;
				}
			});

			const warnSpy = vi.spyOn(logger, "warn");
			await saveExtractions("Alice worked on the project", "Test Memory", "owner", REPO, fileDb);

			// The sweep was blocked by the immediate write lock — it never ran
			// between the upsert and the observation insert.
			expect(sweepBlocked).toBe(true);

			// No FK failure, no warn.
			const fkWarns = warnSpy.mock.calls.filter((call) => String(call[0]).includes("Failed to save extraction"));
			expect(fkWarns).toHaveLength(0);

			// Both the entity and its observation were persisted atomically.
			expect(fileDb.knowledgeGraph.getEntityByName("Alice")).toBeDefined();
			const observations = fileDb.db
				.prepare("SELECT entity_name FROM observations WHERE entity_name = 'Alice'")
				.all() as Array<{ entity_name: string }>;
			expect(observations.length).toBeGreaterThan(0);
		} finally {
			sweeper.close();
			fileDb.close();
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("saveExtractions does not throw when another connection holds the write lock (TASK-175 boundary guard)", async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kg-batch-busy-"));
		const dbPath = path.join(tempDir, "test.db");
		const fileDb = await SQLiteStore.create(dbPath);

		// Fail fast: lower the store connection's busy_timeout so the blocked
		// BEGIN IMMEDIATE throws SQLITE_BUSY after ~100ms, not the default 5s
		// (sqlite.ts sets busy_timeout = 5000).
		fileDb.db.pragma("busy_timeout = 100");

		// Second raw connection holds the write lock (BEGIN IMMEDIATE) for the
		// whole test — simulating a cross-process dashboard-worker orphan sweep
		// or repo delete (TASK-175 regression: the whole-batch refactor moved
		// the per-pair catches INSIDE the transaction, so the single BEGIN
		// IMMEDIATE boundary itself must be guarded).
		const lockHolder = new Database(dbPath);
		lockHolder.pragma("busy_timeout = 100");
		lockHolder.pragma("foreign_keys = ON");
		lockHolder.exec("BEGIN IMMEDIATE");

		try {
			const warnSpy = vi.spyOn(logger, "warn");

			// The batch's BEGIN IMMEDIATE hits SQLITE_BUSY after 100ms; the
			// boundary guard catches it, so saveExtractions resolves without
			// throwing (extract.ts contract: "Failures are logged at warn
			// level but never thrown"). Without the guard this rejects and
			// poisons the embedding worker cycle (outbox fail → backoff).
			await expect(
				saveExtractions("Alice and Bob worked on the project", "Test Memory", "owner", REPO, fileDb)
			).resolves.toBeUndefined();

			// Exactly one batch-level warn with repo + count diagnostics.
			const batchWarns = warnSpy.mock.calls.filter((call) =>
				String(call[0]).includes("Failed to save extraction batch")
			);
			expect(batchWarns).toHaveLength(1);

			// Whole-document atomicity: nothing landed after the boundary
			// rollback (IMMEDIATE lock held by the other connection).
			const entities = fileDb.db.prepare("SELECT COUNT(*) as cnt FROM entities").get() as { cnt: number };
			expect(entities.cnt).toBe(0);
			const observations = fileDb.db.prepare("SELECT COUNT(*) as cnt FROM observations").get() as {
				cnt: number;
			};
			expect(observations.cnt).toBe(0);
		} finally {
			lockHolder.exec("ROLLBACK");
			lockHolder.close();
			fileDb.close();
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	// -----------------------------------------------------------------------
	// inspired_by / co_mentioned now flow through ensureRelation (TASK-073)
	// -----------------------------------------------------------------------

	it("writes inspired_by relations to a decision entity (type 'decision') via ensureRelation", async () => {
		await saveTaskRelations(
			"Payroll Module implementation aligned with quality standards and Icons",
			"Payroll Module",
			"test",
			REPO,
			db,
			{ decisionRefs: ["ADR-006"] }
		);

		// The decision entity is upserted by ensureRelation with type "decision".
		const decision = db.knowledgeGraph.getEntityByName("ADR-006");
		expect(decision).toBeDefined();
		expect(decision?.type).toBe("decision");

		// inspired_by edges point at the decision and their source endpoints exist.
		const rels = db.db
			.prepare("SELECT from_entity, to_entity FROM relations WHERE relation_type = 'inspired_by'")
			.all() as Array<{ from_entity: string; to_entity: string }>;
		expect(rels.length).toBeGreaterThan(0);
		for (const rel of rels) {
			expect(rel.to_entity).toBe("ADR-006");
			expect(db.knowledgeGraph.getEntityByName(rel.from_entity)).toBeDefined();
		}
	});

	it("writes co_mentioned relations whose endpoints all exist", async () => {
		await saveExtractions("Alice and Bob deployed the system to Seattle", "Test Memory", "owner", REPO, db);

		const rels = db.db
			.prepare("SELECT from_entity, to_entity FROM relations WHERE relation_type = 'co_mentioned'")
			.all() as Array<{ from_entity: string; to_entity: string }>;
		expect(rels.length).toBeGreaterThan(0);
		for (const rel of rels) {
			expect(db.knowledgeGraph.getEntityByName(rel.from_entity)).toBeDefined();
			expect(db.knowledgeGraph.getEntityByName(rel.to_entity)).toBeDefined();
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
		const entityNames = (kgContext.entities as Array<{ name: string }>).map((e) => e.name);
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
			commit_id: null,
			changed_files: [],
			suggested_skills: [],
			parent_id: null,
			depends_on: null,
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
				pending_handoff_id: null,
				pending_handoff_summary: null,
				pending_handoff_to_agent: null,
				pending_handoff_created_at: null
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
			commit_id: null,
			changed_files: [],
			suggested_skills: [],
			parent_id: null,
			depends_on: null,
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
				pending_handoff_id: null,
				pending_handoff_summary: null,
				pending_handoff_to_agent: null,
				pending_handoff_created_at: null
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

// ---------------------------------------------------------------------------
// saveCodebaseRelations (TASK-293)
// ---------------------------------------------------------------------------

describe("KG Archivist — saveCodebaseRelations (TASK-293)", () => {
	let db: SQLiteStore;

	beforeEach(async () => {
		db = await createTestStore();
	});

	afterEach(() => {
		db.close();
	});

	function count(sql: string, params: unknown[] = []): number {
		return (db.db.prepare(sql).get(...params) as { cnt: number }).cnt;
	}

	it("creates symbol entities (type = kind) + reference edges for one indexed file", async () => {
		const repo = "kg-test";
		const filePath = "src/order.ts";

		db.codebaseFiles.upsertFile({ repo, file_path: filePath, language: "typescript" });
		db.codebaseSymbols.bulkUpsertSymbols([
			{ repo, file_path: filePath, name: "OrderService", kind: "class" },
			{ repo, file_path: filePath, name: "computeTotal", kind: "function" }
		]);
		db.codebaseReferences.bulkUpsertReferences(repo, [
			{
				repo,
				symbol_name: "computeTotal",
				caller_file: filePath,
				caller_line: 5,
				caller_name: "OrderService",
				kind: "call"
			},
			{ repo, symbol_name: "ExternalDep", caller_file: filePath, caller_line: 9, caller_name: null, kind: "import" }
		]);

		await saveCodebaseRelations({ filePath, owner: "test", repo }, db);

		// Symbol entities typed by the symbol kind, observed under the shared
		// codebase observation text (same as saveExtractions').
		const obsText = observationText("codebase", filePath);
		expect(count("SELECT COUNT(*) as cnt FROM entities WHERE name = 'OrderService' AND type = 'class'")).toBe(1);
		expect(count("SELECT COUNT(*) as cnt FROM entities WHERE name = 'computeTotal' AND type = 'function'")).toBe(1);
		expect(count("SELECT COUNT(*) as cnt FROM observations WHERE observation = ?", [obsText])).toBeGreaterThanOrEqual(
			2
		);

		// caller_name → referenced symbol edge, relation_type = ref kind.
		const callRel = db.db
			.prepare("SELECT relation_type FROM relations WHERE from_entity = 'OrderService' AND to_entity = 'computeTotal'")
			.get() as { relation_type: string } | undefined;
		expect(callRel).toBeDefined();
		expect(callRel!.relation_type).toBe("call");

		// caller_name NULL → the file path is the from endpoint.
		const importRel = db.db
			.prepare("SELECT relation_type FROM relations WHERE from_entity = ? AND to_entity = 'ExternalDep'")
			.get(filePath) as { relation_type: string } | undefined;
		expect(importRel).toBeDefined();
		expect(importRel!.relation_type).toBe("import");
	});

	it("resolves the referenced symbol's type via name lookup (v23 target support)", async () => {
		const repo = "kg-test";
		const callerFile = "src/derived.ts";
		const targetFile = "src/base.ts";

		db.codebaseFiles.upsertFile({ repo, file_path: callerFile, language: "typescript" });
		db.codebaseSymbols.bulkUpsertSymbols([
			{ repo, file_path: callerFile, name: "Derived", kind: "class" },
			// The referenced symbol lives in ANOTHER file — name-based
			// resolution (ADR-002) lets the writer type it as its kind.
			{ repo, file_path: targetFile, name: "Base", kind: "interface" }
		]);
		db.codebaseReferences.bulkUpsertReferences(repo, [
			{
				repo,
				symbol_name: "Base",
				caller_file: callerFile,
				caller_line: 1,
				caller_name: "Derived",
				kind: "extends",
				target_file: targetFile,
				target_symbol_id: "target-base-1"
			}
		]);

		await saveCodebaseRelations({ filePath: callerFile, owner: "test", repo }, db);

		// The edge exists with the heritage kind, and the endpoint upsert
		// types the referenced symbol by its resolved kind (the relations
		// table itself stores no endpoint type columns).
		const rel = db.db
			.prepare("SELECT relation_type FROM relations WHERE from_entity = 'Derived' AND to_entity = 'Base'")
			.get() as { relation_type: string } | undefined;
		expect(rel).toBeDefined();
		expect(rel!.relation_type).toBe("extends");
		expect(count("SELECT COUNT(*) as cnt FROM entities WHERE name = 'Base' AND type = 'interface'")).toBe(1);
	});

	it("emits the file-path→symbol edge for a reference-only file (no symbols, caller_name NULL)", async () => {
		const repo = "kg-test";
		const filePath = "src/entry.ts";

		// Reference-only file: zero extracted symbols, but one call-site row
		// with caller_name NULL (entry-point / side-effect-import / setup
		// file). The enqueue gate (indexing-writer.ts:245
		// `(symbols && symbols.length > 0) || (refs && refs.length > 0)`)
		// enqueues these files, so the relation writer must still emit the
		// caller edge with the FILE PATH as the from endpoint — the standalone
		// symbols===0 early-return previously dropped it silently (TASK-339 /
		// review F2).
		db.codebaseFiles.upsertFile({ repo, file_path: filePath, language: "typescript" });
		db.codebaseReferences.bulkUpsertReferences(repo, [
			{
				repo,
				symbol_name: "initializeApp",
				caller_file: filePath,
				caller_line: 1,
				caller_name: null,
				kind: "call"
			}
		]);

		await saveCodebaseRelations({ filePath, owner: "test", repo }, db);

		// No symbol entities (the file declares none) — but the caller edge
		// exists with the file path as its from endpoint, relation_type = the
		// ref kind.
		const rel = db.db
			.prepare("SELECT relation_type FROM relations WHERE from_entity = ? AND to_entity = 'initializeApp'")
			.get(filePath) as { relation_type: string } | undefined;
		expect(rel).toBeDefined();
		expect(rel!.relation_type).toBe("call");

		// ensureRelation upserts both endpoints: the file-path endpoint is
		// typed by the writer's fromType fallback ('symbol'), and the
		// referenced name is typed via lookup (unresolved here → 'symbol').
		expect(count("SELECT COUNT(*) as cnt FROM entities WHERE name = ?", [filePath])).toBe(1);
		expect(count("SELECT COUNT(*) as cnt FROM entities WHERE name = 'initializeApp'")).toBe(1);
	});

	it("is a no-op for an unknown file or a file with neither symbols nor references", async () => {
		const repo = "kg-test";

		await saveCodebaseRelations({ filePath: "src/ghost.ts", owner: "test", repo }, db);
		expect(count("SELECT COUNT(*) as cnt FROM entities")).toBe(0);
		expect(count("SELECT COUNT(*) as cnt FROM observations")).toBe(0);

		// File exists but declares no symbols AND has no reference rows —
		// both sources empty → nothing to link (a file without symbols but
		// WITH refs is NOT a no-op; covered by the ref-only test above).
		db.codebaseFiles.upsertFile({ repo, file_path: "src/empty.ts", language: "typescript" });
		await saveCodebaseRelations({ filePath: "src/empty.ts", owner: "test", repo }, db);
		expect(count("SELECT COUNT(*) as cnt FROM entities")).toBe(0);
		expect(count("SELECT COUNT(*) as cnt FROM observations")).toBe(0);
	});
});
