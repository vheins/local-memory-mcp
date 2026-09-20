/**
 * Combined daemon server integration test (FEAT-DAEMON-001).
 *
 * Boots the real combined server (Express dashboard app + MCP Streamable HTTP
 * handler on ONE loopback port) against a mocked dashboard context singleton
 * backed by an in-memory store, then exercises BOTH faces over the wire:
 *
 *   - GET  /api/health            → dashboard route served by the same app
 *   - POST /mcp  (SDK client)     → initialize + tools/list round-trip, no auth
 *
 * Hermetic: the context module is mocked (in-memory SQLiteStore + stub
 * vectors), engines are disabled, and the port is ephemeral.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { CombinedServerHandle } from "../cli/combined-server";

// ── Mock the dashboard context BEFORE any route/server import ───────────────
// The combined server reuses this singleton (dynamic import) and every
// dashboard route resolves `db` from it (static import), so the mock must be
// registered first — mirroring dashboard/tests/controllers.shared.ts.
vi.mock("../../dashboard/lib/context", async () => {
	const { SQLiteStore } = await import("../storage/sqlite");
	const { RuntimeCapabilityRegistry } = await import("../runtime-capabilities");
	const db = new SQLiteStore(":memory:");
	const runtimeCapabilities = new RuntimeCapabilityRegistry();

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
			getPendingCount: vi.fn(() => 0)
		},
		embeddingWorker: {
			start: vi.fn(),
			stop: vi.fn(),
			getStats: vi.fn().mockReturnValue({ pending: 0, claimed: 0, done: 0 })
		},
		runtimeCapabilities,
		logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
		startTime: Date.now()
	};
});

let handle: CombinedServerHandle;

beforeAll(async () => {
	const { startCombinedServer } = await import("../cli/combined-server");
	handle = await startCombinedServer({ host: "127.0.0.1", port: 0, enableEngines: false });
});

afterAll(async () => {
	await handle?.close();
});

describe("combined server — dashboard face", () => {
	it("serves the dashboard API on the same port as MCP", async () => {
		const res = await fetch(`${handle.url}/api/health`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { data?: { type?: string } };
		expect(body.data?.type).toBe("health");
	});

	it("serves the dashboard API under /api on the combined port", async () => {
		const res = await fetch(`${handle.url}/api/stats`);
		expect(res.status).toBe(200);
	});
});

describe("combined server — MCP face", () => {
	it("completes an initialize + tools/list round-trip over /mcp with no auth", async () => {
		const transport = new StreamableHTTPClientTransport(new URL(`${handle.url}/mcp`));
		const client = new Client({ name: "daemon-test-client", version: "1.0.0" });

		await client.connect(transport);
		try {
			const tools = await client.listTools();
			expect(Array.isArray(tools.tools)).toBe(true);
			expect(tools.tools.length).toBeGreaterThan(0);
		} finally {
			await client.close();
		}
	});

	it("answers a raw initialize POST without a bearer token", async () => {
		const res = await fetch(`${handle.url}/mcp`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2025-06-18",
					capabilities: {},
					clientInfo: { name: "raw", version: "0.0.0" }
				}
			})
		});
		expect(res.status).toBe(200);
	});

	/**
	 * DEBT-423: the daemon is the PRIMARY deployment, so its 2025-era traffic
	 * must be served by a PER-SESSION stateful transport — not the SDK's
	 * throwaway stateless fallback. A raw `initialize` POST must issue an
	 * `Mcp-Session-Id` that is then REUSED; a `tools/list` on that id succeeds,
	 * while the same call WITHOUT the id is refused ("Server not initialized").
	 */
	it("retains a legacy (2025-era) session across requests keyed by Mcp-Session-Id", async () => {
		const jsonHeaders = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };

		const init = await fetch(`${handle.url}/mcp`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2025-06-18",
					capabilities: {},
					clientInfo: { name: "daemon-legacy-raw", version: "1.0.0" }
				}
			})
		});
		expect(init.status).toBe(200);
		const sessionId = init.headers.get("mcp-session-id");
		expect(sessionId).toBeTruthy();
		await init.text();

		const notif = await fetch(`${handle.url}/mcp`, {
			method: "POST",
			headers: { ...jsonHeaders, "mcp-session-id": sessionId! },
			body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })
		});
		expect(notif.status).toBe(202);
		await notif.text();

		const list = await fetch(`${handle.url}/mcp`, {
			method: "POST",
			headers: { ...jsonHeaders, "mcp-session-id": sessionId! },
			body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
		});
		expect(list.status).toBe(200);
		expect(list.headers.get("mcp-session-id")).toBe(sessionId);
		expect(await list.text()).toContain('"tools"');

		const noSession = await fetch(`${handle.url}/mcp`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} })
		});
		expect(noSession.status).toBe(400);
		expect(await noSession.text()).toContain("Server not initialized");
	});
});

describe("runDaemonWorker — never resolves (no double-boot)", () => {
	it("does NOT settle after booting, so server.ts never falls into the [Server] path", async () => {
		const { runDaemonWorker } = await import("../cli/combined-server");

		// Inject a stub boot so this stays hermetic — no real listener, no second
		// store. The contract under test is purely "the promise never settles".
		let booted = false;
		const fakeHandle = {
			server: {} as never,
			port: 0,
			url: "http://127.0.0.1:0",
			close: vi.fn().mockResolvedValue(undefined)
		};

		let settled = false;
		void runDaemonWorker({
			installProcessHandlers: false,
			startServer: async () => {
				booted = true;
				return fakeHandle;
			}
		}).then(
			() => (settled = true),
			() => (settled = true)
		);

		// Let the boot + several macrotasks elapse. Pre-fix the function RETURNED,
		// so `await runDaemonWorker()` in server.ts fell through and booted a
		// SECOND SQLiteStore + EmbeddingWorker in the same pid.
		await new Promise((r) => setTimeout(r, 50));
		expect(booted).toBe(true);
		expect(settled).toBe(false);
	});
});

describe("runDaemonWorker — EADDRINUSE (TASK-425)", () => {
	it("prints an actionable message and exits once instead of crash-looping", async () => {
		const { runDaemonWorker } = await import("../cli/combined-server");

		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lmc-eaddrinuse-"));
		const prevDir = process.env.LOCAL_MEMORY_DAEMON_DIR;
		process.env.LOCAL_MEMORY_DAEMON_DIR = dir;
		const lockFile = path.join(dir, "daemon.lock");
		fs.writeFileSync(lockFile, "1234\n", "utf8");

		const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
		const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

		try {
			await runDaemonWorker({
				installProcessHandlers: false,
				port: 3456,
				startServer: async () => {
					throw Object.assign(new Error("listen EADDRINUSE"), { code: "EADDRINUSE" });
				}
			});

			expect(exitSpy).toHaveBeenCalledWith(1);
			const output = stderrSpy.mock.calls.map((call) => String(call[0])).join("");
			expect(output).toContain("Daemon port 3456 is already in use");
			expect(output).toContain('Run "daemon status"');
			// The single-instance lock is released so the next start is not blocked.
			expect(fs.existsSync(lockFile)).toBe(false);
		} finally {
			exitSpy.mockRestore();
			stderrSpy.mockRestore();
			if (prevDir === undefined) delete process.env.LOCAL_MEMORY_DAEMON_DIR;
			else process.env.LOCAL_MEMORY_DAEMON_DIR = prevDir;
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});
