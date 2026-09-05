import { beforeEach, describe, it, expect } from "vitest";
import { AgentContextSchema } from "../tools/schemas/index";
import { MemoryWriteSchema } from "../tools/schemas/memory";
import { handleAgentContext } from "../tools/agent-context";
import { createTestStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import type { MemoryEntry, VectorStore } from "../types";
import { AGENT_TOOL_DEFINITIONS } from "../types/tool-definitions/agent";

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

	it("should accept search via query field", () => {
		const result = AgentContextSchema.parse({
			owner: "test",
			repo: "test",
			query: "old search"
		});
		expect(result.query).toBe("old search");
	});

	it("should apply default limit of 5", () => {
		const result = AgentContextSchema.parse({ owner: "test", repo: "test" });
		expect(result.limit).toBe(5);
	});

	it("should apply default json false", () => {
		const result = AgentContextSchema.parse({ owner: "test", repo: "test" });
		expect(result.json).toBe(false);
	});

	it("accepts compiler inputs and applies bounded defaults", () => {
		const result = AgentContextSchema.parse({ owner: "test", repo: "test", objective: "ship feature" });
		expect(result.budget).toEqual({ tokens: 2000, max_items: 20, code_depth: 1 });
		expect(result.sources).toEqual(["memories", "decisions", "tasks", "handoffs", "standards", "observations", "code"]);
	});

	it("rejects unsafe compiler budgets and unknown sources", () => {
		expect(() => AgentContextSchema.parse({ owner: "test", repo: "test", budget: { tokens: 255 } })).toThrow();
		expect(() => AgentContextSchema.parse({ owner: "test", repo: "test", sources: ["internet"] })).toThrow();
	});
});

describe("Agent Context - response and performance contract", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let vectors: VectorStore;
	const owner = "test";
	const repo = "agent-context-contract";

	beforeEach(async () => {
		db = await createTestStore();
		vectors = new StubVectorStore(db);
	});

	function seedMemory(index: number): void {
		const now = new Date().toISOString();
		const entry: MemoryEntry = {
			id: crypto.randomUUID(),
			type: "code_fact",
			title: `Contract memory ${index}`,
			content: `Bounded compiler candidate ${index} `.repeat(12),
			importance: 3,
			agent: "test-agent",
			role: "unknown",
			model: "test-model",
			scope: { owner, repo },
			created_at: now,
			updated_at: now,
			completed_at: null,
			hit_count: 0,
			recall_count: 0,
			last_used_at: null,
			expires_at: null,
			supersedes: null,
			status: "active",
			tags: [],
			metadata: {},
			is_global: false
		};
		db.memories.insert(entry);
	}

	it("keeps warm in-memory compilation p95 below 250ms", async () => {
		for (let i = 0; i < 40; i++) seedMemory(i);
		const args = {
			owner,
			repo,
			objective: "bounded compiler",
			sources: ["memories"] as const,
			budget: { tokens: 2_000, max_items: 20, code_depth: 0 },
			json: true
		};
		await handleAgentContext(args, db, vectors);
		const durations: number[] = [];
		for (let i = 0; i < 20; i++) {
			const started = performance.now();
			await handleAgentContext(args, db, vectors);
			durations.push(performance.now() - started);
		}
		durations.sort((a, b) => a - b);
		const p95 = durations[Math.ceil(durations.length * 0.95) - 1]!;
		expect(p95).toBeLessThan(250);
	});

	it("keeps compact text without structured JSON and includes it when requested", async () => {
		seedMemory(1);
		const args = { owner, repo, objective: "bounded compiler", sources: ["memories"] as const };
		const compact = await handleAgentContext(args, db, vectors);
		expect(compact.structuredContent).toBeUndefined();
		expect(compact.content).toHaveLength(1);
		const [content] = compact.content ?? [];
		if (content?.type !== "text") throw new Error("Expected text content");
		expect(content.text).toContain("Relevant Memories");

		const structured = await handleAgentContext({ ...args, json: true }, db, vectors);
		expect(structured.structuredContent).toMatchObject({
			schema: "agent-context",
			repo,
			memories: expect.any(Array),
			decisions: expect.any(Array),
			tasks: expect.any(Array)
		});
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
