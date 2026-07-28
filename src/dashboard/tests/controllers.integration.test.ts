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
 *
 * CodebaseController is already covered by codebase-api.integration.test.ts.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

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
});
