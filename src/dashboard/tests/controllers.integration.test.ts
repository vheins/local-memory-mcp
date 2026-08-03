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

// ── Mock context.ts (must be BEFORE any imports that transitively load it) ──

vi.mock("../../dashboard/lib/context", async () => {
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
	});
});
