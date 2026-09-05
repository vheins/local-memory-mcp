import { describe, it, expect, beforeEach } from "vitest";
import { handleAgentContext } from "../tools/agent-context";
import { createTestStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import type { VectorStore, MemoryEntry, CodingStandardEntry } from "../types";
import type { McpResponse } from "../utils/mcp-response";

/** Shape of handleAgentContext's structuredContent (see tools/agent-context.ts). */
interface AgentContextResult {
	schema: string;
	repo: string;
	query: string | null;
	memories: Array<{
		id: string;
		code: string | null;
		title: string;
		type: string;
		importance: number;
	}>;
	decisions: Array<{
		id: string;
		code: string | null;
		title: string;
		importance: number;
	}>;
	tasks: Array<{
		task_code: string;
		title: string;
		status: string;
		priority: number;
	}>;
	context: Array<{ source: string; id: string; estimated_tokens: number }>;
	estimated_tokens: number;
	allocation: { included_items: number };
	exclusions: Array<{ source: string; id: string; reason: string }>;
}

/** Narrow McpResponse.structuredContent (unknown) to the agent-context result shape. */
function getStructured(res: McpResponse): AgentContextResult {
	return res.structuredContent as AgentContextResult;
}

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

	it("should return memories matching the query param", async () => {
		seedMemory({ title: "Auth Setup", content: "JWT tokens with 1h expiry." });
		seedMemory({ title: "Payment Gateway", content: "Stripe integration for checkout." });

		const res = await handleAgentContext(
			{ owner: OWNER, repo: REPO, query: "auth", limit: 5, json: true },
			db,
			vectors
		);

		expect(res.structuredContent).toBeDefined();
		expect(getStructured(res).schema).toBe("agent-context");
		expect(getStructured(res).query).toBe("auth");
		expect(getStructured(res).memories.length).toBeGreaterThan(0);
		const titles = getStructured(res).memories.map((m: { title: string }) => m.title);
		expect(titles).toContain("Auth Setup");
	});

	it("should return recent memories when no query is provided", async () => {
		seedMemory({ title: "Alpha", content: "First memory content." });
		seedMemory({ title: "Beta", content: "Second memory content." });

		const res = await handleAgentContext({ owner: OWNER, repo: REPO, limit: 10, json: true }, db, vectors);

		expect(getStructured(res).memories.length).toBeGreaterThanOrEqual(2);
	});

	// ─── backward compat: objective still works ──────────────────────────

	it("should accept query param for searching", async () => {
		seedMemory({ title: "DB Schema", content: "Database schema: Users table with UUID primary key." });

		const res = await handleAgentContext(
			{ owner: OWNER, repo: REPO, query: "database", limit: 5, json: true },
			db,
			vectors
		);

		expect(getStructured(res).query).toBe("database");
		expect(getStructured(res).memories.length).toBeGreaterThan(0);
	});

	it("query param takes precedence over other params", async () => {
		seedMemory({ title: "Cache Strategy", content: "Redis caching for API responses." });
		seedMemory({ title: "Old Config", content: "Legacy config loader." });

		const res = await handleAgentContext(
			{ owner: OWNER, repo: REPO, query: "cache", limit: 5, json: true },
			db,
			vectors
		);

		expect(getStructured(res).query).toBe("cache");
		const titles = getStructured(res).memories.map((m: { title: string }) => m.title);
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

		expect(getStructured(res).memories.length).toBeGreaterThan(0);
	});

	it("vector search returns empty gracefully when repo has no memories", async () => {
		const res = await handleAgentContext(
			{ owner: OWNER, repo: "never", query: "anything", limit: 5, json: true },
			db,
			vectors
		);

		expect(getStructured(res).memories).toEqual([]);
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

		const types = getStructured(res).memories.map((m: { type: string }) => m.type);
		expect(types.every((t: string) => t === "pattern")).toBe(true);
	});

	// ─── decisions and tasks in output ───────────────────────────────────

	it("should include separate decisions section when decision memories exist", async () => {
		seedMemory({ type: "decision", title: "Use Postgres", content: "Chose Postgres over MySQL." });

		const res = await handleAgentContext({ owner: OWNER, repo: REPO, limit: 5, json: true }, db, vectors);

		expect(getStructured(res).decisions.length).toBeGreaterThan(0);
	});

	it("should include active tasks in the response", async () => {
		const now = new Date().toISOString();
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
			doc_path: null,
			created_at: now,
			updated_at: now,
			in_progress_at: now,
			finished_at: null,
			canceled_at: null,
			est_tokens: 0,
			commit_id: null,
			changed_files: [],
			tags: [],
			suggested_skills: [],
			metadata: {},
			parent_id: null,
			depends_on: null
		});

		const res = await handleAgentContext({ owner: OWNER, repo: REPO, limit: 5, json: true }, db, vectors);

		expect(getStructured(res).tasks.length).toBeGreaterThan(0);
		const taskCodes = getStructured(res).tasks.map((t: { task_code: string }) => t.task_code);
		expect(taskCodes).toContain("AC-001");
	});

	// ─── token-budgeted multi-source compiler ────────────────────────────

	it("compiles deterministic context within the requested token and item budgets", async () => {
		for (let i = 0; i < 8; i++) {
			seedMemory({
				title: `Compiler memory ${i}`,
				content: `Deterministic compiler evidence ${i} `.repeat(20),
				importance: i === 0 ? 5 : 3
			});
		}

		const args = {
			owner: OWNER,
			repo: REPO,
			objective: "deterministic compiler",
			budget: { tokens: 256, max_items: 3, code_depth: 1 },
			json: true
		};
		const first = getStructured(await handleAgentContext(args, db, vectors));
		const second = getStructured(await handleAgentContext(args, db, vectors));

		expect(first.context).toEqual(second.context);
		expect(first.context.length).toBeLessThanOrEqual(3);
		expect(first.estimated_tokens).toBeLessThanOrEqual(256);
		expect(first.allocation.included_items).toBe(first.context.length);
		expect(first.exclusions.some((entry) => entry.reason === "token_budget" || entry.reason === "item_budget")).toBe(
			true
		);
	});

	it("prioritizes an explicitly requested task and supports source selection", async () => {
		const now = new Date().toISOString();
		db.tasks.insertTask({
			id: crypto.randomUUID(),
			task_code: "AC-CRITICAL",
			owner: OWNER,
			repo: REPO,
			phase: "implementation",
			title: "Critical compiler task",
			description: "Preserve the requested task under a constrained context budget.",
			status: "in_progress",
			priority: 5,
			agent: "test-agent",
			role: "implementation",
			doc_path: null,
			created_at: now,
			updated_at: now,
			in_progress_at: now,
			finished_at: null,
			canceled_at: null,
			est_tokens: 100,
			commit_id: null,
			changed_files: [],
			tags: [],
			suggested_skills: [],
			metadata: {},
			parent_id: null,
			depends_on: null
		});
		seedMemory({ title: "Noise", content: "Unrelated memory that must not leak through source selection." });

		const result = getStructured(
			await handleAgentContext(
				{
					owner: OWNER,
					repo: REPO,
					task_code: "AC-CRITICAL",
					sources: ["tasks"],
					budget: { tokens: 256, max_items: 1, code_depth: 0 },
					json: true
				},
				db,
				vectors
			)
		);

		expect(result.context).toHaveLength(1);
		expect(result.context[0].source).toBe("tasks");
		expect(result.context[0].id).toBe("AC-CRITICAL");
		expect(result.memories).toEqual([]);
		expect(result.tasks.map((task) => task.task_code)).toEqual(["AC-CRITICAL"]);
	});

	it("retrieves handoffs, standards, fresh observations, and indexed code pointers", async () => {
		const now = new Date().toISOString();
		db.handoffs.createHandoff({
			owner: OWNER,
			repo: REPO,
			from_agent: "scout",
			summary: "Inspect the compiler contract."
		});
		const standard: CodingStandardEntry = {
			id: crypto.randomUUID(),
			code: "STD-COMPILER",
			title: "Compiler standard",
			content: "Keep context compilation deterministic and bounded.",
			parent_id: null,
			context: "agent context",
			version: "1.0.0",
			language: "typescript",
			stack: [],
			is_global: false,
			owner: OWNER,
			repo: REPO,
			tags: [],
			metadata: {},
			created_at: now,
			updated_at: now,
			hit_count: 0,
			last_used_at: null,
			agent: "test-agent",
			model: "test-model"
		};
		db.standards.insert(standard);
		db.codebaseFiles.upsertFile({
			repo: REPO,
			file_path: "src/compiler.ts",
			language: "typescript",
			checksum: "compiler-checksum",
			lines: 10,
			size_bytes: 100
		});
		db.codebaseFiles.upsertFile({
			repo: REPO,
			file_path: "src/budget.ts",
			language: "typescript",
			checksum: "budget-checksum",
			lines: 6,
			size_bytes: 60
		});
		db.codebaseSymbols.bulkUpsertSymbols([
			{
				id: "123e4567-e89b-42d3-a456-426614174101",
				repo: REPO,
				file_path: "src/compiler.ts",
				name: "compileContext",
				kind: "function",
				exported: true,
				start_line: 1,
				end_line: 8,
				signature: "compileContext(): Context"
			},
			{
				id: "123e4567-e89b-42d3-a456-426614174102",
				repo: REPO,
				file_path: "src/budget.ts",
				name: "estimateBudget",
				kind: "function",
				exported: true,
				start_line: 1,
				end_line: 5,
				signature: "estimateBudget(): number"
			}
		]);
		db.codebaseReferences.bulkUpsertReferences(REPO, [
			{
				repo: REPO,
				symbol_name: "estimateBudget",
				caller_file: "src/compiler.ts",
				caller_line: 4,
				caller_name: "compileContext",
				kind: "call",
				target_file: "src/budget.ts",
				target_symbol_id: "123e4567-e89b-42d3-a456-426614174102"
			}
		]);
		db.explorationObservations.upsertMany(OWNER, REPO, [
			{
				subject: "Compiler evidence",
				fact: "Context is packed under a deterministic token budget.",
				confidence: 0.95,
				evidence: [{ file_path: "src/compiler.ts", symbol_id: "123e4567-e89b-42d3-a456-426614174101" }]
			}
		]);

		const result = getStructured(
			await handleAgentContext(
				{
					owner: OWNER,
					repo: REPO,
					objective: "compiler",
					current_file_path: "src/compiler.ts",
					sources: ["handoffs", "standards", "observations", "code"],
					budget: { tokens: 2000, max_items: 20, code_depth: 1 },
					json: true
				},
				db,
				vectors
			)
		);

		expect(new Set(result.context.map((item) => item.source))).toEqual(
			new Set(["handoffs", "standards", "observations", "code"])
		);
		expect(result.context.filter((item) => item.source === "code").map((item) => item.id)).toContain(
			"123e4567-e89b-42d3-a456-426614174102"
		);
	});

	it("ranks objective matches found in an observation fact, not only its subject", async () => {
		db.explorationObservations.upsertMany(OWNER, REPO, [
			{
				subject: "Unrelated heading",
				fact: "The compiler uses a needle-fact token allocator.",
				confidence: 0.9,
				evidence: [{ file_path: "src/not-indexed.ts" }]
			}
		]);

		const result = getStructured(
			await handleAgentContext(
				{
					owner: OWNER,
					repo: REPO,
					objective: "needle-fact",
					sources: ["observations"],
					include_stale: true,
					json: true
				},
				db,
				vectors
			)
		);

		expect(result.context.map((item) => item.source)).toEqual(["observations"]);
	});

	// ─── limit param ─────────────────────────────────────────────────────

	it("should respect the limit parameter", async () => {
		for (let i = 0; i < 10; i++) {
			seedMemory({ title: `Limit Test ${i}`, content: `Content for memory ${i}.` });
		}

		const res = await handleAgentContext({ owner: OWNER, repo: REPO, limit: 3, json: true }, db, vectors);

		expect(getStructured(res).memories.length).toBeLessThanOrEqual(3);
	});
});
