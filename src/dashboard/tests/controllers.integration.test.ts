/**
 * Controllers Integration Tests.
 *
 * Tests all dashboard controllers (except CodebaseController, which has
 * its own dedicated test suite) against an in-memory SQLiteStore using
 * vi.mock to bypass the real context.ts module.
 *
 * Controllers under test:
 *   - SystemController   (health, repos, stats, capabilities)
 *   - MemoriesController (list, get, create validation)
 *   - TasksController    (list, get, getByCode validation)
 *   - StandardsController(list, get, create validation)
 *   - KGController       (entities, graph, relations)
 *   - CoordinationController (claims)
 *   - UnifiedGraphController (graph)
 *   - QueueController    (embedding/KG outbox status)
 *
 * CodebaseController is already covered by codebase-api.integration.test.ts.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";
// Resolves to the mocked context module (vi.mock is hoisted above imports),
// giving access to the same SQLiteStore instance the controllers use.
import { db } from "../../dashboard/lib/context";
// Must stay AFTER the context import: constants.ts is first evaluated through
// the mock factory above (with KG_MAX_GRAPH_EDGES overridden), so this
// binding reflects the test cap used by the truncated graph assertion.
import { EMBEDDING_QUEUE_POISON_THRESHOLD, KG_MAX_GRAPH_EDGES } from "../../mcp/utils/constants";
// Outbox helper used by the TASK-296 retry tests to prove a retried job is
// re-claimable by the worker (pure library import — no vi.mock interaction).
import { outboxFor } from "../../mcp/embedding-queue/outbox";
// TTL stats cache (OPT-PERF-06 / TASK-202) — cleared between /api/stats cache
// tests so each case starts from a cold cache regardless of run order.
import { clearRepoStatsCache } from "../services/statsCache";
// Arena overview aggregate cache (TASK-269 / audit F7) — same isolation need.
import { clearArenaOverviewCache } from "../services/arena.service";

// ── Mock context.ts (must be BEFORE any imports that transitively load it) ──

vi.mock("../../dashboard/lib/context", async () => {
	// OPT-FEAT-03 test hook: KG_MAX_GRAPH_EDGES is captured at constants.ts
	// module load, so the cap MUST be set BEFORE sqlite.ts → constants.ts is
	// imported. A small cap lets the truncated graph test seed a handful of
	// relations instead of 4000+. No other test in this file depends on the
	// default 4000 cap (the existing graph tests only assert shape/empty), so
	// the override is safe for the whole file run (vitest workers are isolated).
	process.env.KG_MAX_GRAPH_EDGES = "10";
	const { SQLiteStore } = await import("../../mcp/storage/sqlite");
	const db = new SQLiteStore(":memory:");

	return {
		db,
		vectors: {
			upsert: vi.fn(),
			remove: vi.fn(),
			search: vi.fn().mockResolvedValue([])
		},
		mcpClient: {
			start: vi.fn(),
			stop: vi.fn(),
			isConnected: vi.fn(() => false),
			getPendingCount: vi.fn(() => 0),
			callTool: vi.fn().mockResolvedValue({ structuredContent: { success: true } })
		},
		// Embedding/KG outbox worker (TASK-013): QueueController.status reads
		// embeddingWorker.getStats() — stubbed so the endpoint is exercised
		// without starting a real worker.
		embeddingWorker: {
			getStats: vi.fn().mockReturnValue({
				pending: 0,
				claimed: 0,
				done: 0,
				poison: 0,
				total: 0,
				processed: 0,
				failed: 0,
				poisoned: 0,
				lastBatchSize: 0,
				lastRunAt: null,
				running: false,
				started: false,
				modelReady: false,
				pollIntervalMs: 5000,
				batchSize: 8,
				leaseMs: 60_000
			})
		},
		logger: {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			debug: vi.fn()
		},
		startTime: Date.now()
	};
});

// ── Server fixture ───────────────────────────────────────────────────────

describe("Dashboard Controllers", () => {
	let app: express.Express;
	let server: ReturnType<express.Express["listen"]>;
	let baseUrl: string;

	beforeAll(async () => {
		const router = (await import("../../dashboard/routes/index")).default;
		app = express();
		app.use(express.json());
		app.use("/api", router);
		server = app.listen(0);
		const { port } = server.address() as AddressInfo;
		baseUrl = `http://127.0.0.1:${port}`;
	});

	afterAll(async () => {
		await new Promise<void>((resolve, reject) => {
			server.close((err) => (err ? reject(err) : resolve()));
		});
	});

	// ── Queue-jobs seed helpers (TASK-296) ────────────────────────────────
	// The mocked context stubs embeddingWorker, so queue_jobs rows for the
	// queue-admin endpoints are inserted straight into the shared store here.
	// `status` values are the literal enum names (pending|claimed|done|poison).

	const seedQueueRow = (
		overrides: {
			id?: string;
			repo?: string;
			status?: "pending" | "claimed" | "done" | "poison";
			attempts?: number;
			last_error?: string | null;
			backoff_until?: string | null;
			created_at?: string;
		} = {}
	): string => {
		const id = overrides.id ?? randomUUID();
		const now = new Date().toISOString();
		db.db
			.prepare(
				`INSERT INTO queue_jobs
				(id, entity_kind, entity_id, entity_repo, payload, content_hash, status, attempts,
				 lease_until, locked_by, backoff_until, last_error, created_at, updated_at)
				VALUES (?, 'memory', ?, ?, '{}', NULL, ?, ?, NULL, NULL, ?, ?, ?, ?)`
			)
			.run(
				id,
				id,
				overrides.repo ?? "queue-admin-repo",
				overrides.status ?? "pending",
				overrides.attempts ?? 0,
				overrides.backoff_until ?? null,
				overrides.last_error ?? null,
				overrides.created_at ?? now,
				now
			);
		return id;
	};

	const getQueueRow = (id: string): Record<string, any> =>
		db.db.prepare("SELECT * FROM queue_jobs WHERE id = ?").get(id) as Record<string, any>;

	// ── System Controller ──────────────────────────────────────────────────

	describe("System API", () => {
		it("GET /api/health returns 200 with health data", async () => {
			const res = await fetch(`${baseUrl}/api/health`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.data).toBeDefined();
			expect(body.data.type).toBe("health");
			expect(body.data.attributes.connected).toBe(false);
			expect(body.data.attributes.uptime).toBeGreaterThanOrEqual(0);
			expect(body.data.attributes.version).toBeDefined();
		});

		it("GET /api/repos returns 200 with array", async () => {
			const res = await fetch(`${baseUrl}/api/repos`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(Array.isArray(body.data)).toBe(true);
		});

		it("GET /api/stats returns 200 with global stats", async () => {
			const res = await fetch(`${baseUrl}/api/stats`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.data.type).toBe("system-stats");
			expect(body.data.attributes).toHaveProperty("total");
			expect(body.data.attributes).toHaveProperty("byType");
		});

		it("GET /api/capabilities returns 200 with tools/resources/prompts", async () => {
			const res = await fetch(`${baseUrl}/api/capabilities`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.data.type).toBe("capability");
			expect(body.data.attributes).toHaveProperty("tools");
			expect(body.data.attributes).toHaveProperty("resources");
			expect(body.data.attributes).toHaveProperty("prompts");
			expect(Array.isArray(body.data.attributes.tools)).toBe(true);
		});
	});

	// ── Stats caching (OPT-PERF-06 / TASK-202) ─────────────────────────────
	// Repo-scoped /api/stats runs 16+ aggregate queries per call; the TTL cache
	// (statsCache.ts, DASHBOARD_STATS_TTL_MS, default 30 s) serves repeated
	// selects within the window from memory. Contract: identical JSON:API shape
	// on hit and miss; stats may be up to TTL stale — acceptable for an overview.
	// The TTL is read lazily from the env, so each test sets its own window.

	describe("System API — /api/stats caching (OPT-PERF-06)", () => {
		afterEach(() => {
			delete process.env.DASHBOARD_STATS_TTL_MS;
			clearRepoStatsCache();
		});

		it("GET /api/stats?repo=... returns 200 with the repo-scoped shape", async () => {
			const repo = "stats-shape-repo";
			const res = await fetch(`${baseUrl}/api/stats?repo=${repo}`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.data.type).toBe("system-stats");
			const attrs = body.data.attributes as Record<string, any>;
			expect(attrs.scope).toBe("repo");
			expect(typeof attrs.total).toBe("number");
			expect(typeof attrs.avgImportance).toBe("string");
			expect(typeof attrs.totalHitCount).toBe("number");
			expect(typeof attrs.expiringSoon).toBe("number");
			expect(attrs.byType).toBeDefined();
			expect(attrs.taskStats).toHaveProperty("total");
			expect(Array.isArray(attrs.topMemories)).toBe(true);
		});

		it("GET /api/stats?repo=... serves repeated calls from cache (single compute within TTL)", async () => {
			const repo = "stats-cache-repo";
			// Long window: both calls are guaranteed to land inside the TTL.
			process.env.DASHBOARD_STATS_TTL_MS = "60000";
			clearRepoStatsCache();
			const spy = vi.spyOn(db.system, "getDashboardStats");

			const res1 = await fetch(`${baseUrl}/api/stats?repo=${repo}`);
			expect(res1.status).toBe(200);
			expect(spy).toHaveBeenCalledTimes(1);
			const body1 = await res1.json();

			const res2 = await fetch(`${baseUrl}/api/stats?repo=${repo}`);
			expect(res2.status).toBe(200);
			// Cache hit: the aggregates are NOT recomputed, payload is identical.
			expect(spy).toHaveBeenCalledTimes(1);
			expect(await res2.json()).toEqual(body1);

			spy.mockRestore();
		});

		it("GET /api/stats?repo=... recomputes after the TTL expires", async () => {
			const repo = "stats-expiry-repo";
			process.env.DASHBOARD_STATS_TTL_MS = "100";
			clearRepoStatsCache();
			const spy = vi.spyOn(db.system, "getDashboardStats");

			// Warm the cache (cold compute #1).
			const warm = await fetch(`${baseUrl}/api/stats?repo=${repo}`);
			expect(warm.status).toBe(200);
			expect(spy).toHaveBeenCalledTimes(1);
			const warmBody = (await warm.json()) as Record<string, any>;
			const warmTotal = warmBody.data.attributes.total as number;

			// Mutate the data source directly (bypasses the cache entirely).
			db.memories.insert({
				id: randomUUID(),
				type: "code_fact",
				title: "ttl-expiry seed",
				content: "should surface once the stats cache expires",
				importance: 1,
				agent: "test",
				role: "backend",
				model: "test",
				scope: { owner: "", repo },
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
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
			});

			// Within the TTL: cached payload served (no recompute, stale total).
			const within = await fetch(`${baseUrl}/api/stats?repo=${repo}`);
			expect(within.status).toBe(200);
			expect(spy).toHaveBeenCalledTimes(1);
			expect(((await within.json()) as Record<string, any>).data.attributes.total).toBe(warmTotal);

			// Past the TTL: the next call recomputes and sees the new row.
			await new Promise((r) => setTimeout(r, 400));
			const after = await fetch(`${baseUrl}/api/stats?repo=${repo}`);
			expect(after.status).toBe(200);
			expect(spy).toHaveBeenCalledTimes(2);
			expect(((await after.json()) as Record<string, any>).data.attributes.total).toBe(warmTotal + 1);

			spy.mockRestore();
		});
	});

	// ── Memories Controller ────────────────────────────────────────────────

	describe("Memories API", () => {
		it("GET /api/memories returns 400 when repo is missing", async () => {
			const res = await fetch(`${baseUrl}/api/memories`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.errors[0].detail).toMatch(/repo/i);
		});

		it("GET /api/memories?repo=test-repo returns 200 with paginated results", async () => {
			const res = await fetch(`${baseUrl}/api/memories?repo=test-repo`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(Array.isArray(body.data)).toBe(true);
			expect(body.meta).toBeDefined();
			expect(body.meta).toHaveProperty("page");
			expect(body.meta).toHaveProperty("totalItems");
		});

		it("GET /api/memories/nonexist returns 404", async () => {
			const res = await fetch(`${baseUrl}/api/memories/00000000-0000-0000-0000-000000000000`);
			expect(res.status).toBe(404);
			const body = (await res.json()) as Record<string, any>;
			expect(body.errors[0].detail).toMatch(/not found/i);
		});
	});

	// ── Tasks Controller ──────────────────────────────────────────────────

	describe("Tasks API", () => {
		it("GET /api/tasks returns 400 when repo is missing", async () => {
			const res = await fetch(`${baseUrl}/api/tasks`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.errors[0].detail).toMatch(/repo/i);
		});

		it("GET /api/tasks?repo=test-repo returns 200 with paginated results", async () => {
			const res = await fetch(`${baseUrl}/api/tasks?repo=test-repo`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(Array.isArray(body.data)).toBe(true);
			expect(body.meta).toHaveProperty("page");
			expect(body.meta).toHaveProperty("totalItems");
		});

		it("GET /api/tasks/nonexist returns 404", async () => {
			const res = await fetch(`${baseUrl}/api/tasks/00000000-0000-0000-0000-000000000000`);
			expect(res.status).toBe(404);
			const body = (await res.json()) as Record<string, any>;
			expect(body.errors[0].detail).toMatch(/not found/i);
		});

		it("GET /api/tasks/by-code returns 400 when repo or task_code missing", async () => {
			const res = await fetch(`${baseUrl}/api/tasks/by-code`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.errors[0].detail).toMatch(/repo and task_code/i);
		});

		it("GET /api/tasks/stats/time returns 200 with time stats", async () => {
			const res = await fetch(`${baseUrl}/api/tasks/stats/time`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.data.type).toBe("performance-stats");
			expect(body.data.attributes).toHaveProperty("daily");
			expect(body.data.attributes).toHaveProperty("weekly");
			expect(body.data.attributes).toHaveProperty("monthly");
			expect(body.data.attributes).toHaveProperty("overall");
		});
	});

	// ── Standards Controller ───────────────────────────────────────────────

	describe("Standards API", () => {
		it("GET /api/standards returns 200 with results", async () => {
			const res = await fetch(`${baseUrl}/api/standards`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(Array.isArray(body.data)).toBe(true);
			expect(body.meta).toHaveProperty("page");
			expect(body.meta).toHaveProperty("totalItems");
		});

		it("GET /api/standards/nonexist returns 404", async () => {
			const res = await fetch(`${baseUrl}/api/standards/00000000-0000-0000-0000-000000000000`);
			expect(res.status).toBe(404);
			const body = (await res.json()) as Record<string, any>;
			expect(body.errors[0].detail).toMatch(/not found/i);
		});

		it("POST /api/standards returns 400 when required fields missing", async () => {
			const res = await fetch(`${baseUrl}/api/standards`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: "incomplete" })
			});
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.errors[0].detail).toMatch(/required fields/i);
		});

		it("GET /api/standards/export returns 200 with export payload", async () => {
			const res = await fetch(`${baseUrl}/api/standards/export`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.data.type).toBe("standard-export");
			expect(body.data.attributes).toHaveProperty("schema");
			expect(body.data.attributes).toHaveProperty("standards");
			expect(Array.isArray(body.data.attributes.standards)).toBe(true);
		});
	});

	// ── KG Controller ─────────────────────────────────────────────────────

	describe("KG API", () => {
		it("GET /api/kg/entities returns 400 when repo is missing", async () => {
			const res = await fetch(`${baseUrl}/api/kg/entities`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.errors[0].detail).toMatch(/repo/i);
		});

		it("GET /api/kg/entities?repo=test-repo returns 200 with array", async () => {
			const res = await fetch(`${baseUrl}/api/kg/entities?repo=test-repo`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(Array.isArray(body.data)).toBe(true);
			// Pagination meta (OPT-FEAT-02): same {page, pageSize, totalItems,
			// totalPages} shape as listGraph — the data array shape is unchanged.
			expect(body.meta).toHaveProperty("page");
			expect(body.meta).toHaveProperty("pageSize");
			expect(body.meta).toHaveProperty("totalItems");
			expect(body.meta).toHaveProperty("totalPages");
		});

		it("GET /api/kg/entities/nonexist returns 404", async () => {
			const res = await fetch(`${baseUrl}/api/kg/entities/nonexist`);
			expect(res.status).toBe(404);
			const body = (await res.json()) as Record<string, any>;
			expect(body.errors[0].detail).toMatch(/not found/i);
		});

		it("GET /api/kg/relations returns 400 when repo is missing", async () => {
			const res = await fetch(`${baseUrl}/api/kg/relations`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.errors[0].detail).toMatch(/repo/i);
		});

		it("GET /api/kg/graph returns 400 when repo is missing", async () => {
			const res = await fetch(`${baseUrl}/api/kg/graph`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.errors[0].detail).toMatch(/repo/i);
		});

		it("GET /api/kg/graph?repo=test-repo returns 200 with nodes and edges", async () => {
			const res = await fetch(`${baseUrl}/api/kg/graph?repo=test-repo`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.data.type).toBe("graph");
			expect(body.data.attributes).toHaveProperty("nodes");
			expect(body.data.attributes).toHaveProperty("edges");
			expect(Array.isArray(body.data.attributes.nodes)).toBe(true);
			expect(Array.isArray(body.data.attributes.edges)).toBe(true);
		});

		it("GET /api/kg/graph?repo=test-repo&includeEdges=false returns 200 with empty edges", async () => {
			const res = await fetch(`${baseUrl}/api/kg/graph?repo=test-repo&includeEdges=false`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.data.type).toBe("graph");
			expect(Array.isArray(body.data.attributes.nodes)).toBe(true);
			expect(body.data.attributes.edges).toEqual([]);
			expect(body.data.attributes.truncated).toBe(false);
		});
	});

	// ── KG pagination + truncated (OPT-FEAT-02 / OPT-FEAT-03) ───────────────
	// List endpoints carry JSON:API pagination meta; the graph `truncated`
	// flag is driven by a LIMIT+1 probe so it is only true when the edge set
	// exceeds KG_MAX_GRAPH_EDGES (TASK-148 pattern).

	describe("KG API — pagination + truncated (OPT-FEAT-02/03)", () => {
		const now = new Date().toISOString();

		const seedEntities = (repo: string, count: number) => {
			for (let i = 0; i < count; i++) {
				db.knowledgeGraph.upsertEntity({
					name: `${repo}-entity-${i}`,
					type: "concept",
					description: null,
					repo,
					owner: "test",
					created_at: now,
					updated_at: now
				});
			}
		};

		const seedRelation = (repo: string, from: string, to: string, relationType: string) => {
			db.knowledgeGraph.upsertRelation({
				from_entity: from,
				to_entity: to,
				relation_type: relationType,
				repo,
				owner: "test",
				created_at: now
			});
		};

		it("GET /api/kg/entities paginates with meta (default pageSize 20)", async () => {
			const repo = "kg-pag-entities";
			seedEntities(repo, 25);

			const res = await fetch(`${baseUrl}/api/kg/entities?repo=${repo}`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.data).toHaveLength(20);
			expect(body.meta).toEqual({ page: 1, pageSize: 20, totalItems: 25, totalPages: 2 });
		});

		it("GET /api/kg/entities honors page/pageSize, offsets correctly, clamps pageSize to 100", async () => {
			const repo = "kg-pag-entities-page";
			seedEntities(repo, 25);

			const page1Res = await fetch(`${baseUrl}/api/kg/entities?repo=${repo}&pageSize=10`);
			expect(page1Res.status).toBe(200);
			const page1 = (await page1Res.json()) as Record<string, any>;
			const page2Res = await fetch(`${baseUrl}/api/kg/entities?repo=${repo}&page=2&pageSize=10`);
			expect(page2Res.status).toBe(200);
			const page2 = (await page2Res.json()) as Record<string, any>;
			expect(page2.data).toHaveLength(10);
			expect(page2.meta).toEqual({ page: 2, pageSize: 10, totalItems: 25, totalPages: 3 });

			// Offset slicing: page 1 and page 2 are disjoint windows of the same set.
			const names = (arr: Array<Record<string, any>>) => arr.map((item) => item.attributes.name);
			const union = new Set([...names(page1.data), ...names(page2.data)]);
			expect(union.size).toBe(20);

			// Clamp: pageSize above 100 falls back to the 100 max (parsePageParams).
			const clampedRes = await fetch(`${baseUrl}/api/kg/entities?repo=${repo}&pageSize=500`);
			expect(clampedRes.status).toBe(200);
			const clamped = (await clampedRes.json()) as Record<string, any>;
			expect(clamped.meta.pageSize).toBe(100);
			expect(clamped.data).toHaveLength(25);
		});

		it("GET /api/kg/relations returns 200 with array + pagination meta", async () => {
			const repo = "kg-pag-relations";
			seedEntities(repo, 41);
			for (let i = 1; i <= 40; i++) {
				seedRelation(repo, `${repo}-entity-0`, `${repo}-entity-${i}`, `rel-${i}`);
			}

			const res = await fetch(`${baseUrl}/api/kg/relations?repo=${repo}&pageSize=10`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(Array.isArray(body.data)).toBe(true);
			expect(body.data).toHaveLength(10);
			expect(body.meta).toEqual({ page: 1, pageSize: 10, totalItems: 40, totalPages: 4 });
		});

		it("GET /api/kg/graph sets truncated=true when edges exceed the cap (LIMIT+1 probe)", async () => {
			const repo = "kg-truncated";
			// Hub-spoke: KG_MAX_GRAPH_EDGES (10 under the test override) + 1
			// relations → the probe returns 11 rows and the controller slices
			// to the cap with truncated=true (OPT-FEAT-03 / TASK-148 pattern).
			seedEntities(repo, 12);
			for (let i = 1; i <= 11; i++) {
				seedRelation(repo, `${repo}-entity-0`, `${repo}-entity-${i}`, "rel");
			}

			const res = await fetch(`${baseUrl}/api/kg/graph?repo=${repo}`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.data.attributes.truncated).toBe(true);
			expect(body.data.attributes.edges).toHaveLength(KG_MAX_GRAPH_EDGES);
			// Nodes are paginated independently of the edge cap (still meta'd).
			expect(body.meta).toHaveProperty("totalItems");
			expect(body.meta.totalItems).toBe(12);
		});
	});

	// ── KG graphLimit top-N view (TASK-212) ────────────────────────────────
	// `graphLimit` overrides page/pageSize for the top-N-by-degree graph view:
	// bypasses the pageSize clamp (max 100) so a renderer can fetch its full
	// top-N window (up to 1000, client-side MAX_GRAPH_LIMIT) in one request.
	// When absent, the legacy paginated behavior is unchanged (covered by the
	// tests above).

	describe("KG API — graphLimit top-N view (TASK-212)", () => {
		const now = new Date().toISOString();

		const seedEntities = (repo: string, count: number) => {
			for (let i = 0; i < count; i++) {
				db.knowledgeGraph.upsertEntity({
					name: `${repo}-entity-${i}`,
					type: "concept",
					description: null,
					repo,
					owner: "test",
					created_at: now,
					updated_at: now
				});
			}
		};

		it("GET /api/kg/graph?repo=X&graphLimit=250 returns top-250 nodes of 260 with graphLimit meta", async () => {
			const repo = "kg-graphlimit";
			seedEntities(repo, 260);

			const res = await fetch(`${baseUrl}/api/kg/graph?repo=${repo}&graphLimit=250`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.data.type).toBe("graph");
			// Top-N window: never more than graphLimit nodes, and for a fresh
			// repo with 260 seeded entities exactly 250 (degree ties broken by
			// name — the ordering is stable, only the count matters here).
			expect(Array.isArray(body.data.attributes.nodes)).toBe(true);
			expect(body.data.attributes.nodes.length).toBeLessThanOrEqual(250);
			expect(body.data.attributes.nodes.length).toBe(250);
			// includeEdges default (TASK-197): edges still fetched + probed.
			expect(body.data.attributes).toHaveProperty("edges");
			expect(body.data.attributes).toHaveProperty("truncated");
			// Meta drives the renderer's "Top N of M" readout.
			expect(body.meta.totalItems).toBe(260);
			expect(body.meta.totalPages).toBe(2); // ceil(260 / 250)
			expect(body.meta.graphLimit).toBe(250);
		});

		it("GET /api/kg/graph clamps graphLimit into [100, 1000]", async () => {
			const repo = "kg-graphlimit-clamp";
			seedEntities(repo, 1200);

			const clampedRes = await fetch(`${baseUrl}/api/kg/graph?repo=${repo}&graphLimit=5000`);
			expect(clampedRes.status).toBe(200);
			const clamped = (await clampedRes.json()) as Record<string, any>;
			expect(clamped.meta.graphLimit).toBe(1000);
			expect(clamped.data.attributes.nodes.length).toBeLessThanOrEqual(1000);

			const flooredRes = await fetch(`${baseUrl}/api/kg/graph?repo=${repo}&graphLimit=50`);
			expect(flooredRes.status).toBe(200);
			const floored = (await flooredRes.json()) as Record<string, any>;
			expect(floored.meta.graphLimit).toBe(100);
			expect(floored.data.attributes.nodes.length).toBeLessThanOrEqual(100);
		});

		it("GET /api/kg/graph rejects non-positive-integer graphLimit with 400", async () => {
			const repo = "kg-graphlimit-invalid";
			seedEntities(repo, 5);

			for (const bad of ["abc", "-1", "0", "1.5"]) {
				const res = await fetch(`${baseUrl}/api/kg/graph?repo=${repo}&graphLimit=${bad}`);
				expect(res.status).toBe(400);
				const body = (await res.json()) as Record<string, any>;
				expect(body.errors[0].detail).toMatch(/graphLimit/i);
			}
		});
	});

	// ── KG graph cache + invalidation (TASK-268 / audit F2) ─────────────────
	// The graph payload is assembled once per repo+window and served from the
	// KG graph TTL cache (statsCache) for the TTL; dashboard-initiated KG
	// mutations must invalidate the cache so edits are reflected immediately.

	describe("KG API — graph TTL cache + invalidation (TASK-268)", () => {
		const now = new Date().toISOString();

		const seedEntity = (repo: string, name: string) => {
			db.knowledgeGraph.upsertEntity({
				name,
				type: "concept",
				description: null,
				repo,
				owner: "test",
				created_at: now,
				updated_at: now
			});
		};

		it("reflects a relation created via the API immediately (cache invalidation)", async () => {
			const repo = "kg-cache-inval";
			// entities.name is a GLOBAL PK — prefix names with the repo so
			// tests in the same process can never collide (TASK-268).
			seedEntity(repo, `${repo}-hub`);
			seedEntity(repo, `${repo}-leaf-a`);
			seedEntity(repo, `${repo}-leaf-b`);
			db.knowledgeGraph.upsertRelation({
				from_entity: `${repo}-hub`,
				to_entity: `${repo}-leaf-a`,
				relation_type: "related_to",
				repo,
				owner: "test",
				created_at: now
			});

			// First fetch: assembles + caches the payload (window includes all 3 nodes).
			const firstRes = await fetch(`${baseUrl}/api/kg/graph?repo=${repo}`);
			expect(firstRes.status).toBe(200);
			const first = (await firstRes.json()) as Record<string, any>;
			expect(first.data.attributes.edges).toHaveLength(1);

			// Mutate through the API — must invalidate the cached graph payload.
			const createRes = await fetch(`${baseUrl}/api/kg/relations`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					data: {
						type: "relation",
						attributes: {
							from_entity: `${repo}-hub`,
							to_entity: `${repo}-leaf-b`,
							relation_type: "related",
							repo
						}
					}
				})
			});
			expect(createRes.status).toBe(200);

			// Second fetch: same window, but the new relation must be present.
			const secondRes = await fetch(`${baseUrl}/api/kg/graph?repo=${repo}`);
			expect(secondRes.status).toBe(200);
			const second = (await secondRes.json()) as Record<string, any>;
			const edges = second.data.attributes.edges as Array<{ source: string; target: string }>;
			expect(edges).toHaveLength(2);
			expect(edges.some((e) => e.source === `${repo}-hub` && e.target === `${repo}-leaf-b`)).toBe(true);
		});

		it("legacy pageSize window ships only subset-bounded edges (both endpoints in window)", async () => {
			const repo = "kg-subset-window";
			// 5 entities → legacy default pageSize 20 returns all of them.
			// Names are repo-prefixed (entities.name is a GLOBAL PK).
			seedEntity(repo, `${repo}-hub`);
			seedEntity(repo, `${repo}-node-a`);
			seedEntity(repo, `${repo}-node-b`);
			seedEntity(repo, `${repo}-hub2`);
			seedEntity(repo, `${repo}-node-c`);
			for (const [from, to] of [
				[`${repo}-hub`, `${repo}-node-a`],
				[`${repo}-hub`, `${repo}-node-b`],
				[`${repo}-hub2`, `${repo}-node-c`]
			] as Array<[string, string]>) {
				db.knowledgeGraph.upsertRelation({
					from_entity: from,
					to_entity: to,
					relation_type: "related",
					repo,
					owner: "test",
					created_at: now
				});
			}

			const res = await fetch(`${baseUrl}/api/kg/graph?repo=${repo}&pageSize=10`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			const edges = body.data.attributes.edges as Array<{ source: string; target: string }>;
			// All edges connect pairs within the 5-node window.
			expect(edges).toHaveLength(3);
		});
	});

	// ── Arena Overview aggregate (TASK-269 / audit F7) ───────────────────
	// ONE /api/dashboard/overview response replaces the ~5×N per-repo fan-out
	// the Agent Arena fired on first load. It must return the same merged
	// task/claim/handoff rows across all repos.

	describe("Dashboard API — arena overview aggregate (TASK-269)", () => {
		const now = new Date().toISOString();

		const seedTask = (repo: string, status: string, code: string) => {
			const id = randomUUID();
			db.tasks.insertTask({
				id,
				owner: "",
				repo,
				task_code: code,
				phase: "test",
				title: `arena task ${code}`,
				description: null,
				status,
				priority: 3,
				agent: "probe-agent",
				role: "backend",
				doc_path: null,
				created_at: now,
				updated_at: now,
				in_progress_at: null,
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
			} as never);
			return id;
		};

		beforeEach(() => {
			clearArenaOverviewCache();
		});

		it("returns merged tasks/claims/handoffs across all repos in ONE response", async () => {
			const repoA = "arena-overview-a";
			const repoB = "arena-overview-b";
			const tA = seedTask(repoA, "in_progress", "AROV-A-1");
			seedTask(repoB, "pending", "AROV-B-1");
			db.handoffs.claimTask({ owner: "", repo: repoA, task_id: tA, agent: "probe-agent" });
			db.handoffs.createHandoff({
				owner: "",
				repo: repoB,
				from_agent: "probe-agent",
				to_agent: "other-agent",
				summary: "arena handoff B"
			});

			const res = await fetch(`${baseUrl}/api/dashboard/overview`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.data.type).toBe("arena-overview");
			const attrs = body.data.attributes as Record<string, any>;
			expect(Array.isArray(attrs.tasks)).toBe(true);
			expect(Array.isArray(attrs.claims)).toBe(true);
			expect(Array.isArray(attrs.handoffs)).toBe(true);
			const taskCodes = (attrs.tasks as Array<{ task_code: string }>).map((t) => t.task_code);
			expect(taskCodes).toContain("AROV-A-1");
			expect(taskCodes).toContain("AROV-B-1");
			expect((attrs.tasks as unknown[]).length).toBeGreaterThan(0);
			expect((attrs.claims as unknown[]).length).toBeGreaterThan(0);
			expect((attrs.handoffs as Array<{ summary: string }>).some((h) => h.summary === "arena handoff B")).toBe(true);
		});

		it("respects the per-status/per-repo caps of the old fan-out", async () => {
			const repo = "arena-overview-caps";
			// 12 in_progress tasks — the old client only pulled 10 per repo.
			for (let i = 0; i < 12; i++) {
				seedTask(repo, "in_progress", `AROV-CAP-${i}`);
			}

			const res = await fetch(`${baseUrl}/api/dashboard/overview`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			const attrs = body.data.attributes as Record<string, any>;
			const ipTasks = (attrs.tasks as Array<{ status: string }>).filter((t) => t.status === "in_progress");
			// 12 seeded + any other in_progress rows from earlier tests in this
			// process — the per-repo cap still binds at 10 for this repo.
			const ipForRepo = (attrs.tasks as Array<{ repo: string; status: string }>).filter(
				(t) => t.repo === repo && t.status === "in_progress"
			);
			expect(ipForRepo.length).toBe(10);
			expect(ipTasks.length).toBeGreaterThanOrEqual(10);
		});
	});

	// ── Coordination Controller ────────────────────────────────────────────

	describe("Coordination API", () => {
		it("GET /api/coordination/claims returns 400 when repo is missing", async () => {
			const res = await fetch(`${baseUrl}/api/coordination/claims`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.errors[0].detail).toMatch(/repo/i);
		});

		it("GET /api/coordination/claims?repo=test-repo returns 200 with array", async () => {
			const res = await fetch(`${baseUrl}/api/coordination/claims?repo=test-repo`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(Array.isArray(body.data)).toBe(true);
			expect(body.meta).toHaveProperty("page");
			expect(body.meta).toHaveProperty("totalItems");
		});
	});

	// ── Unified Graph Controller ───────────────────────────────────────────

	describe("Unified Graph API", () => {
		it("GET /api/unified-graph returns 400 when owner is missing", async () => {
			const res = await fetch(`${baseUrl}/api/unified-graph`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.errors[0].detail).toMatch(/owner/i);
		});

		it("GET /api/unified-graph?owner=test-owner returns 200 with graph data", async () => {
			const res = await fetch(`${baseUrl}/api/unified-graph?owner=test-owner`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.data.type).toBe("unified-graph");
			expect(body.data.attributes).toHaveProperty("nodes");
			expect(body.data.attributes).toHaveProperty("edges");
			expect(body.data.attributes).toHaveProperty("stats");
			expect(Array.isArray(body.data.attributes.nodes)).toBe(true);
			expect(Array.isArray(body.data.attributes.edges)).toBe(true);
		});
	});

	// ── Queue Controller (TASK-104) ────────────────────────────────────────
	// Embedding/KG outbox observability (TASK-013): exposes worker + queue
	// depth stats so the dashboard can surface backpressure.

	describe("Queue API", () => {
		it("GET /api/queue/status returns 200 with queue-status payload", async () => {
			const res = await fetch(`${baseUrl}/api/queue/status`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.data.type).toBe("queue-status");
			expect(body.data.attributes).toHaveProperty("pending");
			expect(body.data.attributes).toHaveProperty("poison");
			expect(body.data.attributes).toHaveProperty("total");
			expect(body.data.attributes).toHaveProperty("running");
			expect(body.data.attributes).toHaveProperty("started");
			expect(body.data.attributes).toHaveProperty("modelReady");
			expect(body.data.attributes).toHaveProperty("batchSize");
			expect(body.data.attributes).toHaveProperty("leaseMs");
		});

		it("GET /api/queue/status reflects worker depth + config from getStats", async () => {
			const { embeddingWorker } = await import("../../dashboard/lib/context");
			(embeddingWorker.getStats as ReturnType<typeof vi.fn>).mockReturnValue({
				pending: 7,
				claimed: 2,
				done: 10,
				poison: 1,
				total: 20,
				processed: 42,
				failed: 3,
				poisoned: 1,
				lastBatchSize: 5,
				lastRunAt: "2026-08-02T00:00:00.000Z",
				running: true,
				started: true,
				modelReady: true,
				pollIntervalMs: 5000,
				batchSize: 8,
				leaseMs: 60_000
			});

			const res = await fetch(`${baseUrl}/api/queue/status`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.data.attributes.pending).toBe(7);
			expect(body.data.attributes.poison).toBe(1);
			expect(body.data.attributes.running).toBe(true);
			expect(body.data.attributes.started).toBe(true);
			expect(body.data.attributes.modelReady).toBe(true);
			expect(body.data.attributes.batchSize).toBe(8);
			expect(body.data.attributes.leaseMs).toBe(60_000);
		});

		it("GET /api/queue/status is a read endpoint — does NOT acquire the write lock", async () => {
			const withWriteSpy = vi.spyOn(db, "withWrite").mockImplementation(async (fn) => fn());
			const res = await fetch(`${baseUrl}/api/queue/status`);
			expect(res.status).toBe(200);
			expect(withWriteSpy).not.toHaveBeenCalled();
			withWriteSpy.mockRestore();
		});

		// ── Queue job admin (TASK-296) ─────────────────────────────────────
		// List / retry / clear / retry-all for failed (poison) jobs. Wire
		// statuses are the LITERAL enum values ('pending'|'claimed'|'done'|
		// 'poison') — 'failed' exists only as a UI label.

		it("GET /api/queue/jobs returns paginated queue jobs — default filter shows pending + poison only", async () => {
			const pendingId = seedQueueRow({ status: "pending" });
			const poisonId = seedQueueRow({ status: "poison", attempts: 5, last_error: "worker poison" });
			seedQueueRow({ status: "done", attempts: 1 });

			const res = await fetch(`${baseUrl}/api/queue/jobs`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;

			expect(body.jsonapi.version).toBe("1.1");
			expect(Array.isArray(body.data)).toBe(true);
			expect(body.data[0].type).toBe("queue-job");
			const statuses = body.data.map((d: any) => (d.attributes as Record<string, any>).status as string);
			// default filter: pending + poison — done never leaks in
			expect(statuses.every((s: string) => s === "pending" || s === "poison")).toBe(true);

			// Full attribute set on a seeded row (id, entity_kind, entity_id,
			// status, attempts, max_attempts, enqueued_at, processed_at, last_error).
			const gotPending = body.data.find((d: any) => d.id === pendingId);
			expect(gotPending).toBeDefined();
			const attrs = gotPending.attributes as Record<string, any>;
			expect(attrs.status).toBe("pending");
			expect(attrs.entity_kind).toBe("memory");
			expect(attrs.entity_id).toBe(pendingId);
			expect(attrs.attempts).toBe(0);
			expect(attrs.max_attempts).toBe(EMBEDDING_QUEUE_POISON_THRESHOLD);
			expect(attrs.enqueued_at).toBeDefined();
			expect(attrs.processed_at).toBeDefined();

			const gotPoison = body.data.find((d: any) => d.id === poisonId);
			expect(gotPoison).toBeDefined();
			expect((gotPoison.attributes as Record<string, any>).status).toBe("poison");
			// Assert the exact seeded literal — the mapper passes last_error through
			// raw, so the assertion must match the fixture ("worker poison").
			expect((gotPoison.attributes as Record<string, any>).last_error).toBe("worker poison");

			expect(body.meta.totalItems).toBeGreaterThanOrEqual(2);
			expect(body.meta.page).toBe(1);
			expect(body.meta.pageSize).toBe(20);
		});

		it("GET /api/queue/jobs?status=done filters to the literal enum value (excludes pending/poison)", async () => {
			seedQueueRow({ status: "pending" });
			const doneId = seedQueueRow({ status: "done" });
			seedQueueRow({ status: "poison" });

			const res = await fetch(`${baseUrl}/api/queue/jobs?status=done`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.data.every((d: any) => d.attributes.status === "done")).toBe(true);
			expect(body.data.find((d: any) => d.id === doneId)).toBeDefined();
		});

		it("GET /api/queue/jobs supports page/pageSize pagination (newest-first)", async () => {
			const ids = [
				seedQueueRow({ status: "poison" }),
				seedQueueRow({ status: "poison" }),
				seedQueueRow({ status: "poison" })
			];

			const page1 = await fetch(`${baseUrl}/api/queue/jobs?status=poison&pageSize=2`);
			const body1 = (await page1.json()) as Record<string, any>;
			expect(body1.data).toHaveLength(2);
			expect(body1.meta.totalItems).toBeGreaterThanOrEqual(3);

			const page2 = await fetch(`${baseUrl}/api/queue/jobs?status=poison&pageSize=2&page=2`);
			const body2 = (await page2.json()) as Record<string, any>;
			expect(body2.data.length).toBeGreaterThanOrEqual(1);

			const allIds = [...body1.data.map((d: any) => d.id), ...body2.data.map((d: any) => d.id)];
			expect(ids.every((id) => allIds.includes(id))).toBe(true);
		});

		it("GET /api/queue/jobs?status=bogus returns 400 with the valid literal enums", async () => {
			const res = await fetch(`${baseUrl}/api/queue/jobs?status=bogus`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.errors[0].detail).toContain("bogus");
			expect(body.errors[0].detail).toContain("poison");
		});

		it("GET /api/queue/jobs is a read endpoint — does NOT acquire the write lock", async () => {
			seedQueueRow({ status: "poison" });
			const withWriteSpy = vi.spyOn(db, "withWrite").mockImplementation(async (fn) => fn());
			try {
				const res = await fetch(`${baseUrl}/api/queue/jobs`);
				expect(res.status).toBe(200);
				expect(withWriteSpy).not.toHaveBeenCalled();
			} finally {
				withWriteSpy.mockRestore();
			}
		});

		it("POST /api/queue/jobs/:id/retry flips poison → pending (attempts=0, error/backoff cleared) and the row is re-claimable", async () => {
			const id = seedQueueRow({
				status: "poison",
				attempts: EMBEDDING_QUEUE_POISON_THRESHOLD,
				last_error: "database is locked",
				backoff_until: new Date(Date.now() + 60_000).toISOString()
			});
			const withWriteSpy = vi.spyOn(db, "withWrite").mockImplementation(async (fn) => fn());
			try {
				const res = await fetch(`${baseUrl}/api/queue/jobs/${id}/retry`, { method: "POST" });
				expect(res.status).toBe(200);
				expect(withWriteSpy).toHaveBeenCalledTimes(1);
			} finally {
				withWriteSpy.mockRestore();
			}

			const row = getQueueRow(id);
			expect(row.status).toBe("pending");
			expect(row.attempts).toBe(0);
			expect(row.last_error).toBeNull();
			expect(row.backoff_until).toBeNull();
			expect(row.lease_until).toBeNull();
			expect(row.locked_by).toBeNull();

			// Re-claimable: a fresh worker claim picks the row up again.
			const claimed = outboxFor(db).claim(10, 60_000);
			expect(claimed.some((job) => job.id === id)).toBe(true);
		});

		it("POST /api/queue/jobs/:id/retry also resets a done row to pending", async () => {
			const id = seedQueueRow({ status: "done", attempts: 1 });
			const withWriteSpy = vi.spyOn(db, "withWrite").mockImplementation(async (fn) => fn());
			try {
				const res = await fetch(`${baseUrl}/api/queue/jobs/${id}/retry`, { method: "POST" });
				expect(res.status).toBe(200);
			} finally {
				withWriteSpy.mockRestore();
			}
			expect(getQueueRow(id).status).toBe("pending");
			expect(getQueueRow(id).attempts).toBe(0);
		});

		it("POST /api/queue/jobs/:id/retry returns 404 for an unknown id", async () => {
			const withWriteSpy = vi.spyOn(db, "withWrite").mockImplementation(async (fn) => fn());
			try {
				const res = await fetch(`${baseUrl}/api/queue/jobs/${randomUUID()}/retry`, { method: "POST" });
				expect(res.status).toBe(404);
			} finally {
				withWriteSpy.mockRestore();
			}
		});

		it("POST /api/queue/jobs/:id/retry returns 409 for a live (pending) job", async () => {
			const id = seedQueueRow({ status: "pending" });
			const withWriteSpy = vi.spyOn(db, "withWrite").mockImplementation(async (fn) => fn());
			try {
				const res = await fetch(`${baseUrl}/api/queue/jobs/${id}/retry`, { method: "POST" });
				expect(res.status).toBe(409);
			} finally {
				withWriteSpy.mockRestore();
			}
		});

		it("POST /api/queue/jobs/:id/clear deletes a poison row (write lock acquired)", async () => {
			const poisonId = seedQueueRow({ status: "poison", attempts: 5, last_error: "embed failed" });
			const withWriteSpy = vi.spyOn(db, "withWrite").mockImplementation(async (fn) => fn());
			try {
				const res = await fetch(`${baseUrl}/api/queue/jobs/${poisonId}/clear`, { method: "POST" });
				expect(res.status).toBe(200);
				expect(withWriteSpy).toHaveBeenCalledTimes(1);
			} finally {
				withWriteSpy.mockRestore();
			}
			expect(getQueueRow(poisonId)).toBeUndefined();
		});

		it("DELETE /api/queue/jobs/:id removes a done row", async () => {
			const doneId = seedQueueRow({ status: "done" });
			const withWriteSpy = vi.spyOn(db, "withWrite").mockImplementation(async (fn) => fn());
			try {
				const res = await fetch(`${baseUrl}/api/queue/jobs/${doneId}`, { method: "DELETE" });
				expect(res.status).toBe(200);
			} finally {
				withWriteSpy.mockRestore();
			}
			expect(getQueueRow(doneId)).toBeUndefined();
		});

		it("DELETE /api/queue/jobs/:id returns 409 for a claimed (live) job", async () => {
			const claimedId = seedQueueRow({ status: "claimed" });
			const withWriteSpy = vi.spyOn(db, "withWrite").mockImplementation(async (fn) => fn());
			try {
				const res = await fetch(`${baseUrl}/api/queue/jobs/${claimedId}`, { method: "DELETE" });
				expect(res.status).toBe(409);
			} finally {
				withWriteSpy.mockRestore();
			}
			expect(getQueueRow(claimedId)).toBeDefined();
		});

		it("POST /api/queue/retry-all flips every poisoned job to pending (live rows untouched)", async () => {
			const poisonA = seedQueueRow({ status: "poison", attempts: EMBEDDING_QUEUE_POISON_THRESHOLD });
			const poisonB = seedQueueRow({ status: "poison", attempts: 3 });
			const live = seedQueueRow({ status: "pending" });
			const withWriteSpy = vi.spyOn(db, "withWrite").mockImplementation(async (fn) => fn());
			try {
				const res = await fetch(`${baseUrl}/api/queue/retry-all`, { method: "POST" });
				expect(res.status).toBe(200);
				expect(withWriteSpy).toHaveBeenCalledTimes(1);
			} finally {
				withWriteSpy.mockRestore();
			}

			expect(getQueueRow(poisonA).status).toBe("pending");
			expect(getQueueRow(poisonA).attempts).toBe(0);
			expect(getQueueRow(poisonB).status).toBe("pending");
			expect(getQueueRow(live).status).toBe("pending");
		});

		// ── Repo scoping (TASK-360) ───────────────────────────────────────
		// Optional ?repo= filter on ALL admin endpoints, mirroring the other
		// dashboard controllers. Unique repo names per test keep the shared
		// suite DB isolated (rows persist across tests in this file).

		it("GET /api/queue/jobs?repo=B returns ONLY repo B rows (repo A excluded, total scoped)", async () => {
			const repoA = `repo-a-${randomUUID().slice(0, 8)}`;
			const repoB = `repo-b-${randomUUID().slice(0, 8)}`;
			const aPoison = seedQueueRow({ repo: repoA, status: "poison" });
			const bPoison = seedQueueRow({ repo: repoB, status: "poison", attempts: 5, last_error: "embed failed" });
			const bPending = seedQueueRow({ repo: repoB, status: "pending" });

			const res = await fetch(`${baseUrl}/api/queue/jobs?repo=${repoB}`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;

			const ids = body.data.map((d: any) => d.id);
			expect(ids).toContain(bPoison);
			expect(ids).toContain(bPending);
			expect(ids).not.toContain(aPoison);
			// total is the repo-scoped window, not the global table.
			expect(body.meta.totalItems).toBe(2);
		});

		it("GET /api/queue/jobs?repo= (whitespace) returns 400 — malformed filter fails closed", async () => {
			const res = await fetch(`${baseUrl}/api/queue/jobs?repo=%20%20`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.errors[0].detail).toContain("repo");
		});

		it("POST /api/queue/jobs/:id/retry?repo=B returns 404 for a repo A job (no cross-repo retry, row untouched)", async () => {
			const id = seedQueueRow({ repo: "repo-a", status: "poison", attempts: 5, last_error: "embed failed" });
			const withWriteSpy = vi.spyOn(db, "withWrite").mockImplementation(async (fn) => fn());
			try {
				const res = await fetch(`${baseUrl}/api/queue/jobs/${id}/retry?repo=other-repo`, { method: "POST" });
				expect(res.status).toBe(404);
			} finally {
				withWriteSpy.mockRestore();
			}
			expect(getQueueRow(id).status).toBe("poison");
		});

		it("POST /api/queue/jobs/:id/retry?repo=A flips a repo A poison row to pending (scoped success)", async () => {
			const id = seedQueueRow({ repo: "repo-a", status: "poison", attempts: 5 });
			const withWriteSpy = vi.spyOn(db, "withWrite").mockImplementation(async (fn) => fn());
			try {
				const res = await fetch(`${baseUrl}/api/queue/jobs/${id}/retry?repo=repo-a`, { method: "POST" });
				expect(res.status).toBe(200);
				expect(withWriteSpy).toHaveBeenCalledTimes(1);
			} finally {
				withWriteSpy.mockRestore();
			}
			expect(getQueueRow(id).status).toBe("pending");
			expect(getQueueRow(id).attempts).toBe(0);
		});

		it("POST /api/queue/jobs/:id/clear?repo=B returns 404 for a repo A job (row kept)", async () => {
			const id = seedQueueRow({ repo: "repo-a", status: "poison", attempts: 5 });
			const withWriteSpy = vi.spyOn(db, "withWrite").mockImplementation(async (fn) => fn());
			try {
				const res = await fetch(`${baseUrl}/api/queue/jobs/${id}/clear?repo=other-repo`, { method: "POST" });
				expect(res.status).toBe(404);
			} finally {
				withWriteSpy.mockRestore();
			}
			expect(getQueueRow(id)).toBeDefined();
		});

		it("POST /api/queue/retry-all?repo=B flips ONLY repo B poison rows (repo A untouched, scoped count)", async () => {
			const repoA = `repo-a-${randomUUID().slice(0, 8)}`;
			const repoB = `repo-b-${randomUUID().slice(0, 8)}`;
			const aPoison = seedQueueRow({ repo: repoA, status: "poison", attempts: 5 });
			const bPoison = seedQueueRow({ repo: repoB, status: "poison", attempts: 5 });
			seedQueueRow({ repo: repoB, status: "pending" });

			const withWriteSpy = vi.spyOn(db, "withWrite").mockImplementation(async (fn) => fn());
			try {
				const res = await fetch(`${baseUrl}/api/queue/retry-all?repo=${repoB}`, { method: "POST" });
				expect(res.status).toBe(200);
				expect(withWriteSpy).toHaveBeenCalledTimes(1);
				const body = (await res.json()) as Record<string, any>;
				expect(body.meta.retried).toBe(1);
			} finally {
				withWriteSpy.mockRestore();
			}

			expect(getQueueRow(bPoison).status).toBe("pending");
			expect(getQueueRow(bPoison).attempts).toBe(0);
			expect(getQueueRow(aPoison).status).toBe("poison");
		});
	});

	// ── Write-lock scope (TASK-102) ─────────────────────────────────────────
	// Regression guard: every dashboard mutation endpoint must mutate through
	// db.withWrite — the same file-lock boundary used by MCP write tools
	// (router.ts / tools/index.ts) — so HTTP writes serialize with tool writes
	// instead of racing them. Read endpoints must NOT take the lock.
	//
	// The spy passes through to the original handler body (so the mutation
	// still executes and the JSON:API response shape is preserved) while
	// recording that the withWrite boundary was crossed. This mirrors the
	// router.test.ts pattern (`expect(mockDb.withWrite).toHaveBeenCalled()`).
	// A passthrough spy (rather than the real proper-lockfile acquisition) is
	// used deliberately: other test files exercise the real lock against the
	// shared `:memory:` target, and parallel forks must not contend on it.

	describe("Write-lock scope (TASK-102)", () => {
		let withWriteSpy: ReturnType<typeof vi.spyOn>;

		beforeEach(() => {
			withWriteSpy = vi.spyOn(db, "withWrite").mockImplementation(async (fn) => fn());
		});

		afterEach(() => {
			withWriteSpy.mockRestore();
		});

		it("POST /api/memories (create) acquires the write lock", async () => {
			const res = await fetch(`${baseUrl}/api/memories`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					data: {
						type: "memory",
						attributes: {
							repo: "lock-test-repo",
							type: "code_fact",
							title: "lock-scope regression",
							content: "created through the dashboard — must run under withWrite",
							importance: 3
						}
					}
				})
			});
			expect(res.status).toBe(200);
			expect(withWriteSpy).toHaveBeenCalledTimes(1);
		});

		it("PUT + DELETE /api/memories/:id acquire the write lock", async () => {
			// Seed through the locked create path so the row exists for update/delete.
			const created = await fetch(`${baseUrl}/api/memories`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					data: {
						type: "memory",
						attributes: {
							repo: "lock-test-repo",
							type: "pattern",
							title: "to be updated",
							content: "seed content",
							importance: 2
						}
					}
				})
			});
			expect(created.status).toBe(200);
			const id = ((await created.json()) as Record<string, any>).data.id as string;
			withWriteSpy.mockClear();

			const updated = await fetch(`${baseUrl}/api/memories/${id}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ data: { type: "memory", attributes: { title: "renamed" } } })
			});
			expect(updated.status).toBe(200);
			expect(withWriteSpy).toHaveBeenCalledTimes(1);

			const deleted = await fetch(`${baseUrl}/api/memories/${id}`, { method: "DELETE" });
			expect(deleted.status).toBe(200);
			expect(withWriteSpy).toHaveBeenCalledTimes(2);
		});

		it("POST /api/memories/import (bulk insert) acquires the write lock", async () => {
			const res = await fetch(`${baseUrl}/api/memories/import`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					data: {
						type: "memory",
						attributes: {
							repo: "lock-test-repo",
							items: [{ title: "bulk one", content: "bulk body", type: "code_fact", importance: 3 }]
						}
					}
				})
			});
			expect(res.status).toBe(200);
			expect(withWriteSpy).toHaveBeenCalledTimes(1);
		});

		it("POST /api/memories/action (bulk delete) acquires the write lock", async () => {
			const created = await fetch(`${baseUrl}/api/memories`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					data: {
						type: "memory",
						attributes: {
							repo: "lock-test-repo",
							type: "decision",
							title: "bulk-action target",
							content: "to be bulk-deleted",
							importance: 2
						}
					}
				})
			});
			expect(created.status).toBe(200);
			const id = ((await created.json()) as Record<string, any>).data.id as string;
			withWriteSpy.mockClear();

			// TASK-160 / FIX-164: the compound bulkAction body routes through the
			// EXCLUSIVE path (withExclusiveWrite) so the getByIds→purge sequence
			// serializes cross-process; it no longer crosses the fast-path withWrite.
			const exclusiveSpy = vi.spyOn(db, "withExclusiveWrite").mockImplementation(async (fn) => fn());
			try {
				const res = await fetch(`${baseUrl}/api/memories/action`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						data: { type: "memory", attributes: { action: "delete", ids: [id] } }
					})
				});
				expect(res.status).toBe(200);
				expect(exclusiveSpy).toHaveBeenCalledTimes(1);
				expect(withWriteSpy).not.toHaveBeenCalled();
			} finally {
				exclusiveSpy.mockRestore();
			}
		});

		it("POST /api/standards (create) acquires the write lock", async () => {
			const res = await fetch(`${baseUrl}/api/standards`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					data: {
						type: "standard",
						attributes: {
							title: "Lock scope standard",
							content: "must be inserted under withWrite",
							tags: ["lock-scope"],
							metadata: { source: "regression-test" }
						}
					}
				})
			});
			expect(res.status).toBe(200);
			expect(withWriteSpy).toHaveBeenCalledTimes(1);
		});

		it("POST /api/standards/import acquires the write lock", async () => {
			// TASK-160 / FIX-164: the compound import loop routes through the
			// EXCLUSIVE path (withExclusiveWrite) so the getById/getByCode →
			// update/insert per-iteration sequence serializes cross-process; it
			// no longer crosses the fast-path withWrite.
			const exclusiveSpy = vi.spyOn(db, "withExclusiveWrite").mockImplementation(async (fn) => fn());
			try {
				const res = await fetch(`${baseUrl}/api/standards/import`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						standards: [{ title: "Imported standard", content: "imported body" }]
					})
				});
				expect(res.status).toBe(200);
				expect(exclusiveSpy).toHaveBeenCalledTimes(1);
				expect(withWriteSpy).not.toHaveBeenCalled();
			} finally {
				exclusiveSpy.mockRestore();
			}
		});

		it("PUT + DELETE /api/standards/:id acquire the write lock", async () => {
			const created = await fetch(`${baseUrl}/api/standards`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					data: {
						type: "standard",
						attributes: {
							title: "Update me",
							content: "seed standard",
							tags: ["lock-scope"],
							metadata: { source: "regression-test" }
						}
					}
				})
			});
			expect(created.status).toBe(200);
			const id = ((await created.json()) as Record<string, any>).data.id as string;
			withWriteSpy.mockClear();

			const updated = await fetch(`${baseUrl}/api/standards/${id}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ data: { type: "standard", attributes: { title: "Updated" } } })
			});
			expect(updated.status).toBe(200);
			expect(withWriteSpy).toHaveBeenCalledTimes(1);

			const deleted = await fetch(`${baseUrl}/api/standards/${id}`, { method: "DELETE" });
			expect(deleted.status).toBe(200);
			expect(withWriteSpy).toHaveBeenCalledTimes(2);
		});

		it("read endpoints do NOT acquire the write lock", async () => {
			withWriteSpy.mockClear();
			const res = await fetch(`${baseUrl}/api/memories?repo=lock-test-repo`);
			expect(res.status).toBe(200);
			expect(withWriteSpy).not.toHaveBeenCalled();
		});

		// TASK-125 / OPT-FEAT-01: coordination mutation endpoints must acquire
		// db.withWrite; read endpoints must NOT.

		it("GET /api/coordination/handoffs does NOT acquire the write lock", async () => {
			withWriteSpy.mockClear();
			const res = await fetch(`${baseUrl}/api/coordination/handoffs?repo=lock-test-repo`);
			expect(res.status).toBe(200);
			expect(withWriteSpy).not.toHaveBeenCalled();
		});

		it("POST /api/coordination/handoffs/status acquires the write lock", async () => {
			// Seed a handoff directly via the real store (mocked mcpClient
			// doesn't persist, so HTTP seeding would yield no DB row).
			const handoff = db.handoffs.createHandoff({
				owner: "test-owner",
				repo: "lock-test-repo",
				from_agent: "backend",
				summary: "handoff-status write lock target"
			});
			withWriteSpy.mockClear();

			const res = await fetch(`${baseUrl}/api/coordination/handoffs/status`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					data: {
						type: "tool-result",
						attributes: { id: handoff.id, status: "expired" }
					}
				})
			});
			expect(res.status).toBe(200);
			expect(withWriteSpy).toHaveBeenCalledTimes(1);
		});

		it("POST /api/coordination/claims/release acquires the write lock", async () => {
			// Seed a task directly, then claim it via the real store so the
			// release has a real target in the DB.
			const now = new Date().toISOString();
			const taskId = randomUUID();
			db.tasks.insertTask({
				id: taskId,
				owner: "test-owner",
				repo: "lock-test-repo",
				task_code: "T-LOCK-RELEASE",
				phase: "test",
				title: "claim-release lock target",
				description: null,
				status: "pending",
				priority: 3,
				agent: "",
				role: "",
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
				depends_on: null
			});
			db.handoffs.claimTask({
				owner: "test-owner",
				repo: "lock-test-repo",
				task_id: taskId,
				agent: "backend"
			});
			withWriteSpy.mockClear();

			const released = await fetch(`${baseUrl}/api/coordination/claims/release`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					data: {
						type: "tool-result",
						attributes: {
							owner: "test-owner",
							repo: "lock-test-repo",
							task_id: taskId
						}
					}
				})
			});
			expect(released.status).toBe(200);
			expect(withWriteSpy).toHaveBeenCalledTimes(1);
		});

		// TASK-296: queue failed-job admin mutations cross db.withWrite; the
		// terminal-state guards (poison/done) live in QueueService.

		it("GET /api/queue/jobs does NOT acquire the write lock", async () => {
			seedQueueRow({ status: "poison" });
			withWriteSpy.mockClear();
			const res = await fetch(`${baseUrl}/api/queue/jobs`);
			expect(res.status).toBe(200);
			expect(withWriteSpy).not.toHaveBeenCalled();
		});

		it("POST /api/queue/jobs/:id/retry acquires the write lock", async () => {
			const id = seedQueueRow({ status: "poison", attempts: 5, last_error: "locked out" });
			withWriteSpy.mockClear();
			const res = await fetch(`${baseUrl}/api/queue/jobs/${id}/retry`, { method: "POST" });
			expect(res.status).toBe(200);
			expect(withWriteSpy).toHaveBeenCalledTimes(1);
		});

		it("POST /api/queue/jobs/:id/clear acquires the write lock", async () => {
			const id = seedQueueRow({ status: "poison" });
			withWriteSpy.mockClear();
			const res = await fetch(`${baseUrl}/api/queue/jobs/${id}/clear`, { method: "POST" });
			expect(res.status).toBe(200);
			expect(withWriteSpy).toHaveBeenCalledTimes(1);
		});

		it("POST /api/queue/retry-all acquires the write lock", async () => {
			seedQueueRow({ status: "poison" });
			withWriteSpy.mockClear();
			const res = await fetch(`${baseUrl}/api/queue/retry-all`, { method: "POST" });
			expect(res.status).toBe(200);
			expect(withWriteSpy).toHaveBeenCalledTimes(1);
		});
	});

	// ── Bulk actions API (OPT-FEAT-04 / STR-01 coverage) ────────────────────
	// Zero-test-coverage bulk paths: POST /api/tasks/action and
	// POST /api/standards/action. The compound delete/update bodies route
	// through the EXCLUSIVE write path (withExclusiveWrite) — passthrough-spied
	// exactly like the Write-lock scope describe above so parallel forks don't
	// contend on the real proper-lockfile target.

	describe("Bulk actions API (OPT-FEAT-04 / STR-01)", () => {
		let exclusiveSpy: ReturnType<typeof vi.spyOn>;

		const seedTask = (overrides: Record<string, unknown> = {}) => {
			const now = new Date().toISOString();
			const id = randomUUID();
			db.tasks.insertTask({
				id,
				owner: "test-owner",
				repo: "bulk-test-repo",
				task_code: `T-BULK-${id.slice(0, 8)}`,
				phase: "test",
				title: "bulk action target",
				description: null,
				status: "pending",
				priority: 3,
				agent: "",
				role: "",
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
			} as never);
			return id;
		};

		const seedStandard = (overrides: Record<string, unknown> = {}) => {
			const now = new Date().toISOString();
			const id = randomUUID();
			db.standards.insert({
				id,
				title: "Bulk standard",
				content: "bulk standard body",
				parent_id: null,
				context: "general",
				version: "1.0.0",
				language: null,
				stack: [],
				is_global: false,
				owner: "test-owner",
				repo: "bulk-test-repo",
				tags: ["bulk"],
				metadata: {},
				created_at: now,
				updated_at: now,
				hit_count: 0,
				last_used_at: null,
				agent: "test",
				model: "test",
				...overrides
			} as never);
			return id;
		};

		const postAction = (path: string, attributes: Record<string, unknown>) =>
			fetch(`${baseUrl}${path}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ data: { type: "action", attributes } })
			});

		beforeEach(async () => {
			exclusiveSpy = vi.spyOn(db, "withExclusiveWrite").mockImplementation(async (fn) => fn());
			const { mcpClient } = await import("../../dashboard/lib/context");
			(mcpClient.callTool as ReturnType<typeof vi.fn>).mockClear();
		});

		afterEach(() => {
			exclusiveSpy.mockRestore();
		});

		describe("POST /api/tasks/action", () => {
			it("delete soft-cancels existing tasks (status → canceled) and returns count", async () => {
				const id = seedTask();

				const res = await postAction("/api/tasks/action", { action: "delete", ids: [id] });
				expect(res.status).toBe(200);
				const body = (await res.json()) as Record<string, any>;
				expect(body.data.attributes.count).toBe(1);

				// Soft-cancel contract (OPT-DRY-03): the row survives with
				// status canceled — not a hard delete.
				const task = db.tasks.getTaskById(id);
				expect(task).not.toBeNull();
				expect(task?.status).toBe("canceled");
			});

			it("canceled tasks are excluded from the default list unless ?status=canceled (TASK-209)", async () => {
				const repo = "task-read-repo";
				const id = seedTask({ repo, owner: "test-owner", status: "canceled" });

				// Default list hides canceled (soft-deleted) tasks…
				const list = await fetch(`${baseUrl}/api/tasks?repo=${repo}`);
				expect(list.status).toBe(200);
				const listBody = (await list.json()) as Record<string, any>;
				expect((listBody.data as Array<{ id: string }>).map((d) => d.id)).not.toContain(id);

				// …but an explicit ?status=canceled filter still returns them.
				const listCanceled = await fetch(`${baseUrl}/api/tasks?repo=${repo}&status=canceled`);
				expect(listCanceled.status).toBe(200);
				const canceledBody = (await listCanceled.json()) as Record<string, any>;
				expect((canceledBody.data as Array<{ id: string }>).map((d) => d.id)).toContain(id);
			});

			it("delete with phantom ids returns count 0 and cancels nothing", async () => {
				const res = await postAction("/api/tasks/action", {
					action: "delete",
					ids: [randomUUID()]
				});
				expect(res.status).toBe(200);
				const body = (await res.json()) as Record<string, any>;
				expect(body.data.attributes.count).toBe(0);
			});

			it("status/update routes each id through mcpClient.callTool('task-update', …)", async () => {
				const id1 = seedTask();
				const id2 = seedTask();
				const { mcpClient } = await import("../../dashboard/lib/context");

				const res = await postAction("/api/tasks/action", {
					action: "status",
					ids: [id1, id2],
					updates: { status: "completed" }
				});
				expect(res.status).toBe(200);
				const body = (await res.json()) as Record<string, any>;
				expect(body.data.attributes.count).toBe(2);

				// The dashboard delegates task mutations to the MCP client —
				// assert the mocked callTool got the right tool + per-id args.
				expect(mcpClient.callTool).toHaveBeenCalledTimes(2);
				expect(mcpClient.callTool).toHaveBeenCalledWith(
					"task-update",
					expect.objectContaining({ id: id1, status: "completed", agent: "dashboard", structured: true })
				);
				expect(mcpClient.callTool).toHaveBeenCalledWith(
					"task-update",
					expect.objectContaining({ id: id2, status: "completed", agent: "dashboard", structured: true })
				);
			});

			it("update with no updates payload → 400", async () => {
				const id = seedTask();

				const res = await postAction("/api/tasks/action", { action: "update", ids: [id] });
				expect(res.status).toBe(400);
				const body = (await res.json()) as Record<string, any>;
				expect(body.errors[0].detail).toMatch(/updates/i);
			});

			it("invalid action → 400", async () => {
				const res = await postAction("/api/tasks/action", {
					action: "explode",
					ids: [randomUUID()]
				});
				expect(res.status).toBe(400);
				const body = (await res.json()) as Record<string, any>;
				expect(body.errors[0].detail).toMatch(/invalid action/i);
			});

			it("non-array ids → 400", async () => {
				const res = await postAction("/api/tasks/action", {
					action: "delete",
					ids: "not-an-array"
				});
				expect(res.status).toBe(400);
				const body = (await res.json()) as Record<string, any>;
				expect(body.errors[0].detail).toMatch(/ids/i);
			});

			it("status with all-unknown ids → 422", async () => {
				const res = await postAction("/api/tasks/action", {
					action: "status",
					ids: [randomUUID(), randomUUID()],
					updates: { status: "completed" }
				});
				expect(res.status).toBe(422);
				const body = (await res.json()) as Record<string, any>;
				expect(body.errors[0].detail).toMatch(/all tasks failed/i);
			});
		});

		describe("POST /api/standards/action", () => {
			it("delete hard-deletes standards (getById → null)", async () => {
				const id = seedStandard();

				const res = await postAction("/api/standards/action", { action: "delete", ids: [id] });
				expect(res.status).toBe(200);
				const body = (await res.json()) as Record<string, any>;
				expect(body.data.attributes.count).toBe(1);

				// Hard-delete contract: the row is gone, not soft-marked.
				expect(db.standards.getById(id)).toBeNull();
			});

			it("update applies bulkUpdateStandards — field actually changed", async () => {
				const id = seedStandard();

				const res = await postAction("/api/standards/action", {
					action: "update",
					ids: [id],
					updates: { title: "Renamed bulk standard" }
				});
				expect(res.status).toBe(200);
				const body = (await res.json()) as Record<string, any>;
				expect(body.data.attributes.count).toBe(1);

				const updated = db.standards.getById(id);
				expect(updated?.title).toBe("Renamed bulk standard");
			});

			it("invalid action → 400", async () => {
				const res = await postAction("/api/standards/action", {
					action: "explode",
					ids: [randomUUID()]
				});
				expect(res.status).toBe(400);
				const body = (await res.json()) as Record<string, any>;
				expect(body.errors[0].detail).toMatch(/invalid action/i);
			});

			it("non-array ids → 400", async () => {
				const res = await postAction("/api/standards/action", {
					action: "delete",
					ids: "not-an-array"
				});
				expect(res.status).toBe(400);
				const body = (await res.json()) as Record<string, any>;
				expect(body.errors[0].detail).toMatch(/ids/i);
			});
		});

		describe("POST /api/memories/action + single delete — soft-archive reads (TASK-207/209)", () => {
			const seedMemory = async (repo: string, overrides: Record<string, unknown> = {}) => {
				const created = await fetch(`${baseUrl}/api/memories`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						data: {
							type: "memory",
							attributes: {
								repo,
								type: "code_fact",
								title: "soft-archive read target",
								content: "must disappear from default dashboard reads after delete",
								importance: 3,
								...overrides
							}
						}
					})
				});
				expect(created.status).toBe(200);
				const body = (await created.json()) as Record<string, any>;
				return body.data.id as string;
			};

			const listIds = async (url: string): Promise<string[]> => {
				const res = await fetch(url);
				expect(res.status).toBe(200);
				const body = (await res.json()) as Record<string, any>;
				return (body.data as Array<{ id: string }>).map((d) => d.id);
			};

			it("DELETE /api/memories/:id archives, then GET returns 404 unless includeArchived=true", async () => {
				const repo = "soft-delete-read-repo";
				const id = await seedMemory(repo);

				const del = await fetch(`${baseUrl}/api/memories/${id}`, { method: "DELETE" });
				expect(del.status).toBe(200);

				// Soft-archive contract (TASK-207): the row survives with
				// status archived — not a hard delete.
				const stored = db.memories.getById(id);
				expect(stored).not.toBeNull();
				expect(stored?.status).toBe("archived");

				// TASK-209 regression: the previously-returned 200 is now 404
				// by default (matches the pre-soft-delete hard-delete behavior).
				const get = await fetch(`${baseUrl}/api/memories/${id}`);
				expect(get.status).toBe(404);

				// Still restorable: explicit includeArchived=true serves it.
				const getArchived = await fetch(`${baseUrl}/api/memories/${id}?includeArchived=true`);
				expect(getArchived.status).toBe(200);
				const archivedBody = (await getArchived.json()) as Record<string, any>;
				expect(archivedBody.data.id).toBe(id);

				// List excludes archived by default…
				expect(await listIds(`${baseUrl}/api/memories?repo=${repo}`)).not.toContain(id);
				// …and includeArchived=true brings it back.
				expect(await listIds(`${baseUrl}/api/memories?repo=${repo}&includeArchived=true`)).toContain(id);
			});

			it("bulk delete soft-archives and hides from reads; includeArchived=true restores", async () => {
				const repo = "soft-delete-bulk-repo";
				const id = await seedMemory(repo);

				const res = await postAction("/api/memories/action", { action: "delete", ids: [id] });
				expect(res.status).toBe(200);
				const body = (await res.json()) as Record<string, any>;
				expect(body.data.attributes.count).toBe(1);

				expect(db.memories.getById(id)?.status).toBe("archived");
				expect((await fetch(`${baseUrl}/api/memories/${id}`)).status).toBe(404);
				expect(await listIds(`${baseUrl}/api/memories?repo=${repo}`)).not.toContain(id);
				expect(await listIds(`${baseUrl}/api/memories?repo=${repo}&includeArchived=true`)).toContain(id);
			});
		});
	});

	// ── Action-log policy (TASK-186 / OPT-PERF-05) ──────────────────────────
	// POLICY 2: reads never write. Dashboard GET detail endpoints must NOT emit
	// action_log rows — only mutations do. Covers the three read sites that
	// previously logged directly via db.actions.logAction (memory/standard/task
	// getById). The in-memory SQLiteStore is shared across the file, so every
	// test counts rows scoped to its OWN repo.

	describe("Action-log policy (TASK-186 / OPT-PERF-05)", () => {
		const actionCountForRepo = (repo: string): number => db.actions.getRecentActions("", repo, 10_000).length;

		it("POST /api/memories (create) still writes an action-log row", async () => {
			const repo = "policy-write-test-repo";
			const before = actionCountForRepo(repo);

			const res = await fetch(`${baseUrl}/api/memories`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					data: {
						type: "memory",
						attributes: {
							repo,
							type: "code_fact",
							title: "policy write target",
							content: "create must keep logging an action",
							importance: 3
						}
					}
				})
			});
			expect(res.status).toBe(200);
			expect(actionCountForRepo(repo)).toBe(before + 1);
		});

		it("GET /api/memories/:id (read) does NOT write an action-log row", async () => {
			const repo = "policy-read-memory-repo";
			const created = await fetch(`${baseUrl}/api/memories`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					data: {
						type: "memory",
						attributes: {
							repo,
							type: "code_fact",
							title: "read target",
							content: "reads must not log",
							importance: 2
						}
					}
				})
			});
			expect(created.status).toBe(200);
			const id = ((await created.json()) as Record<string, any>).data.id as string;

			const before = actionCountForRepo(repo);
			const res = await fetch(`${baseUrl}/api/memories/${id}`);
			expect(res.status).toBe(200);
			expect(actionCountForRepo(repo)).toBe(before);
		});

		it("GET /api/standards/:id (read) does NOT write an action-log row", async () => {
			const repo = "policy-read-standard-repo";
			const created = await fetch(`${baseUrl}/api/standards`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					data: {
						type: "standard",
						attributes: {
							repo,
							title: "Read-only standard",
							content: "reads must not log",
							tags: ["policy"],
							metadata: { source: "policy-test" }
						}
					}
				})
			});
			expect(created.status).toBe(200);
			const id = ((await created.json()) as Record<string, any>).data.id as string;

			const before = actionCountForRepo(repo);
			const res = await fetch(`${baseUrl}/api/standards/${id}`);
			expect(res.status).toBe(200);
			expect(actionCountForRepo(repo)).toBe(before);
		});

		it("GET /api/tasks/:id (read) does NOT write an action-log row", async () => {
			const repo = "policy-read-task-repo";
			const now = new Date().toISOString();
			const id = randomUUID();
			db.tasks.insertTask({
				id,
				owner: "test-owner",
				repo,
				task_code: "T-POLICY-READ",
				phase: "test",
				title: "read-only task",
				description: null,
				status: "pending",
				priority: 3,
				agent: "",
				role: "",
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
				depends_on: null
			} as never);

			const before = actionCountForRepo(repo);
			const res = await fetch(`${baseUrl}/api/tasks/${id}`);
			expect(res.status).toBe(200);
			expect(actionCountForRepo(repo)).toBe(before);
		});
	});
});
