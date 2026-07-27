import { describe, it, expect, beforeEach } from "vitest";
import { handleAgentContext } from "../tools/agent-context";
import { createTestStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import type { VectorStore, MemoryEntry } from "../types";
import { AgentContextSchema } from "../tools/schemas";
// DecisionLogSchema and SessionSummarizeSchema removed per ADR-007.
// Use memory-write with flat fields: context/rationale/alternatives, key_decisions/next_steps
import { MemoryWriteSchema } from "../tools/schemas/memory";
import { AGENT_TOOL_DEFINITIONS } from "../tools/definitions/agent";

describe("Agent Context - handleAgentContext", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let vectors: VectorStore;

	const REPO = "agent-context-test";
	const OWNER = "test";

	function seedMemory(overrides: Partial<MemoryEntry> & { title: string; content: string }): MemoryEntry {
		const entry: MemoryEntry = {
			id: overrides.id ?? crypto.randomUUID(),
			type: overrides.type ?? "code_fact",
			title: overrides.title,
			content: overrides.content,
			importance: overrides.importance ?? 3,
			agent: "test-agent",
			role: "unknown",
			model: "test-model",
			scope: { owner: OWNER, repo: REPO },
			created_at: overrides.created_at ?? new Date().toISOString(),
			updated_at: new Date().toISOString(),
			completed_at: null,
			hit_count: 0,
			recall_count: 0,
			last_used_at: null,
			expires_at: null,
			supersedes: null,
			status: "active",
			tags: overrides.tags ?? [],
			metadata: overrides.metadata ?? {},
			is_global: false,
			code: overrides.code
		};
		db.memories.insert(entry);
		return entry;
	}

	beforeEach(async () => {
		db = await createTestStore();
		vectors = new StubVectorStore(db);
	});

	// ─── query param (new canonical) ─────────────────────────────────────

	it("should return memories matching the query param", async () => {
		seedMemory({ title: "Auth Setup", content: "JWT tokens with 1h expiry." });
		seedMemory({ title: "Payment Gateway", content: "Stripe integration for checkout." });

		const res = await handleAgentContext(
			{ owner: OWNER, repo: REPO, query: "auth", limit: 5, json: true },
			db,
			vectors
		);

		expect(res.structuredContent).toBeDefined();
		expect(res.structuredContent.schema).toBe("agent-context");
		expect(res.structuredContent.query).toBe("auth");
		expect(res.structuredContent.memories.length).toBeGreaterThan(0);
		const titles = res.structuredContent.memories.map((m: { title: string }) => m.title);
		expect(titles).toContain("Auth Setup");
	});

	it("should return recent memories when no query is provided", async () => {
		seedMemory({ title: "Alpha", content: "First memory content." });
		seedMemory({ title: "Beta", content: "Second memory content." });

		const res = await handleAgentContext({ owner: OWNER, repo: REPO, limit: 10, json: true }, db, vectors);

		expect(res.structuredContent.memories.length).toBeGreaterThanOrEqual(2);
	});

	// ─── backward compat: objective still works ──────────────────────────

	it("should accept deprecated objective param as fallback for query", async () => {
		seedMemory({ title: "DB Schema", content: "Database schema: Users table with UUID primary key." });

		const res = await handleAgentContext(
			{ owner: OWNER, repo: REPO, objective: "database", limit: 5, json: true },
			db,
			vectors
		);

		expect(res.structuredContent.query).toBe("database");
		expect(res.structuredContent.memories.length).toBeGreaterThan(0);
	});

	it("query takes precedence over objective when both are provided", async () => {
		seedMemory({ title: "Cache Strategy", content: "Redis caching for API responses." });
		seedMemory({ title: "Old Config", content: "Legacy config loader." });

		const res = await handleAgentContext(
			{ owner: OWNER, repo: REPO, query: "cache", objective: "legacy", limit: 5, json: true },
			db,
			vectors
		);

		expect(res.structuredContent.query).toBe("cache");
		const titles = res.structuredContent.memories.map((m: { title: string }) => m.title);
		expect(titles).toContain("Cache Strategy");
	});

	// ─── vector search via query param ───────────────────────────────────

	it("should attempt vector search when query is provided and fall back to keyword", async () => {
		// Seed a memory and ensure it gets a vector embedding
		seedMemory({
			title: "Vector Search Test",
			content: "This memory is about vector similarity searches in the agent context."
		});

		// Wait for vector upsert (StubVectorStore is sync-ish)
		await vectors.upsert(
			db.memories.searchByRepo(OWNER, REPO, "vector", undefined, 1)[0]?.id ?? "",
			"vector similarity searches"
		);

		const res = await handleAgentContext(
			{ owner: OWNER, repo: REPO, query: "vector similarity", limit: 5, json: true },
			db,
			vectors
		);

		expect(res.structuredContent.memories.length).toBeGreaterThan(0);
	});

	it("vector search returns empty gracefully when repo has no memories", async () => {
		const res = await handleAgentContext(
			{ owner: OWNER, repo: "never", query: "anything", limit: 5, json: true },
			db,
			vectors
		);

		expect(res.structuredContent.memories).toEqual([]);
	});

	// ─── type_filter ─────────────────────────────────────────────────────

	it("should filter by type_filter when provided", async () => {
		seedMemory({ type: "code_fact", title: "Code Rule", content: "Always use strict typing." });
		seedMemory({ type: "pattern", title: "Pattern Match", content: "Observer pattern for events." });

		const res = await handleAgentContext(
			{ owner: OWNER, repo: REPO, type_filter: "pattern", limit: 5, json: true },
			db,
			vectors
		);

		const types = res.structuredContent.memories.map((m: { type: string }) => m.type);
		expect(types.every((t: string) => t === "pattern")).toBe(true);
	});

	// ─── decisions and tasks in output ───────────────────────────────────

	it("should include separate decisions section when decision memories exist", async () => {
		seedMemory({ type: "decision", title: "Use Postgres", content: "Chose Postgres over MySQL." });

		const res = await handleAgentContext({ owner: OWNER, repo: REPO, limit: 5, json: true }, db, vectors);

		expect(res.structuredContent.decisions.length).toBeGreaterThan(0);
	});

	it("should include active tasks in the response", async () => {
		db.tasks.insertTask({
			id: crypto.randomUUID(),
			task_code: "AC-001",
			owner: OWNER,
			repo: REPO,
			phase: "test",
			title: "Agent Context Test Task",
			description: "A task for testing agent-context output.",
			status: "in_progress",
			priority: 3,
			agent: "test-agent",
			role: "tester",
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString()
		});

		const res = await handleAgentContext({ owner: OWNER, repo: REPO, limit: 5, json: true }, db, vectors);

		expect(res.structuredContent.tasks.length).toBeGreaterThan(0);
		const taskCodes = res.structuredContent.tasks.map((t: { task_code: string }) => t.task_code);
		expect(taskCodes).toContain("AC-001");
	});

	// ─── JSON output ─────────────────────────────────────────────────────

	it("should return structured JSON when json:true", async () => {
		seedMemory({ title: "JSON Test", content: "Testing JSON output format." });

		const res = await handleAgentContext({ owner: OWNER, repo: REPO, limit: 5, json: true }, db, vectors);

		expect(res.structuredContent).toBeDefined();
		expect(res.structuredContent.schema).toBe("agent-context");
		expect(res.structuredContent.repo).toBe(REPO);
		expect(Array.isArray(res.structuredContent.memories)).toBe(true);
		expect(Array.isArray(res.structuredContent.tasks)).toBe(true);
		expect(Array.isArray(res.structuredContent.decisions)).toBe(true);
	});

	// ─── limit param ─────────────────────────────────────────────────────

	it("should respect the limit parameter", async () => {
		for (let i = 0; i < 10; i++) {
			seedMemory({ title: `Limit Test ${i}`, content: `Content for memory ${i}.` });
		}

		const res = await handleAgentContext({ owner: OWNER, repo: REPO, limit: 3, json: true }, db, vectors);

		expect(res.structuredContent.memories.length).toBeLessThanOrEqual(3);
	});
});

describe("Agent Context - Schema Validation (AgentContextSchema)", () => {
	it("should reject empty owner", () => {
		expect(() => AgentContextSchema.parse({ owner: "", repo: "test" })).toThrow();
	});

	it("should reject empty repo", () => {
		expect(() => AgentContextSchema.parse({ owner: "test", repo: "" })).toThrow();
	});

	it("should accept query as optional string", () => {
		const result = AgentContextSchema.parse({ owner: "test", repo: "test", query: "search term" });
		expect(result.query).toBe("search term");
	});

	it("should accept objective as deprecated fallback", () => {
		const result = AgentContextSchema.parse({
			owner: "test",
			repo: "test",
			objective: "old search"
		});
		expect(result.objective).toBe("old search");
	});

	it("should apply default limit of 5", () => {
		const result = AgentContextSchema.parse({ owner: "test", repo: "test" });
		expect(result.limit).toBe(5);
	});

	it("should apply default json false", () => {
		const result = AgentContextSchema.parse({ owner: "test", repo: "test" });
		expect(result.json).toBe(false);
	});
});

describe("Agent Context - decision-log and session-summarize removed", () => {
	it("decision-log/session-summarize logic replaced by flat fields in memory-write", () => {
		// Verify the flat decision fields exist on memory-write schema
		const shape = MemoryWriteSchema.shape || {};
		const keys = Object.keys(shape);
		expect(keys).toContain("context");
		expect(keys).toContain("rationale");
		expect(keys).toContain("alternatives");
		expect(keys).toContain("key_decisions");
		expect(keys).toContain("next_steps");
	});

	it("agent-context definition no longer lists decision-log or session-summarize tools", () => {
		const toolNames = AGENT_TOOL_DEFINITIONS.map((t: { name: string }) => t.name);
		expect(toolNames).not.toContain("decision-log");
		expect(toolNames).not.toContain("session-summarize");
	});
});
