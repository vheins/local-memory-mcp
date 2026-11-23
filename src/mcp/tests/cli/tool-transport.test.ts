/**
 * Transport tests for the root CLI (TASK-011).
 *
 * Two invariants are load-bearing here:
 *
 *   1. Selection — a running daemon means HTTP to its MCP endpoint; no daemon
 *      means in-process dispatch.
 *   2. One writer — when the daemon path fails, the CLI reports the failure and
 *      NEVER falls back to opening a store (the FIX-008/FIX-013 lineage: a second
 *      `SQLiteStore` over the same file is the ~50s lock stall the daemon guard
 *      exists to prevent).
 *
 * The dashboard context is mocked with an in-memory store, so the in-process
 * round trip exercises the REAL dispatcher and executors without touching the
 * user's database.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("../../../dashboard/lib/context", async () => {
	const { SQLiteStore } = await import("../../storage/sqlite");
	const db = new SQLiteStore(":memory:");
	return {
		db,
		vectors: {
			upsert: vi.fn(),
			remove: vi.fn(),
			search: vi.fn(async () => [])
		}
	};
});

import {
	ToolTransportError,
	callToolInProcess,
	callToolOverHttp,
	createToolTransport,
	resolveDaemonMcpUrl,
	type ToolOutcome
} from "../../cli/tool-transport";

/** A recorded caller invocation. */
const okOutcome: ToolOutcome = {
	transport: "in-process",
	isError: false,
	structuredContent: { ok: true },
	text: "ok"
};

describe("createToolTransport", () => {
	it("uses the daemon endpoint while the daemon is running", async () => {
		const http = vi.fn(async () => ({ ...okOutcome, transport: "http" as const }));
		const local = vi.fn(async () => okOutcome);
		const transport = createToolTransport({ env: {}, daemonStatus: () => ({ running: true, pid: 1 }), http, local });

		expect(transport.select()).toBe("http");
		await transport.call("memory-read", { query: "x" }, null);

		expect(http).toHaveBeenCalledWith("memory-read", { query: "x" }, { timeoutMs: null, env: {} });
		expect(local).not.toHaveBeenCalled();
	});

	it("uses the in-process dispatcher when no daemon holds the database", async () => {
		const http = vi.fn(async () => okOutcome);
		const local = vi.fn(async () => okOutcome);
		const transport = createToolTransport({
			env: {},
			daemonStatus: () => ({ running: false, pid: null }),
			http,
			local
		});

		expect(transport.select()).toBe("in-process");
		await transport.call("memory-read", { query: "x" }, 1000);

		expect(local).toHaveBeenCalledWith("memory-read", { query: "x" }, { timeoutMs: 1000, env: {} });
		expect(http).not.toHaveBeenCalled();
	});

	it("never falls back to a local store when the daemon path fails", async () => {
		const local = vi.fn(async () => okOutcome);
		const transport = createToolTransport({
			env: {},
			daemonStatus: () => ({ running: true, pid: 1 }),
			http: async () => {
				throw new ToolTransportError("daemon refused", "inspect 'local-memory-mcp daemon status'");
			},
			local
		});

		await expect(transport.call("memory-read", {}, null)).rejects.toBeInstanceOf(ToolTransportError);
		expect(local).not.toHaveBeenCalled();
	});
});

describe("resolveDaemonMcpUrl", () => {
	it("defaults to the combined daemon's port and MCP path", () => {
		expect(resolveDaemonMcpUrl({})).toBe("http://127.0.0.1:3456/mcp");
	});

	it("honours PORT and ignores an unusable value", () => {
		expect(resolveDaemonMcpUrl({ PORT: "4000" })).toBe("http://127.0.0.1:4000/mcp");
		expect(resolveDaemonMcpUrl({ PORT: "not-a-port" })).toBe("http://127.0.0.1:3456/mcp");
	});
});

describe("callToolInProcess", () => {
	it("dispatches a read tool through the real dispatcher and returns its envelope", async () => {
		// `json: true` is the tool's own switch for materializing structuredContent.
		const outcome = await callToolInProcess(
			"memory-read",
			{ query: "nothing here", json: true },
			{
				timeoutMs: null,
				env: {}
			}
		);

		expect(outcome.transport).toBe("in-process");
		expect(outcome.isError).toBe(false);
		const structured = outcome.structuredContent as { rows?: unknown };
		expect(Array.isArray(structured.rows)).toBe(true);
	});

	it("returns prose and no structuredContent when the tool's json switch is off", async () => {
		const outcome = await callToolInProcess("memory-read", { query: "nothing here" }, { timeoutMs: null, env: {} });

		expect(outcome.isError).toBe(false);
		expect(outcome.structuredContent).toBeUndefined();
		expect(outcome.text.length).toBeGreaterThan(0);
	});

	it("wraps an unknown tool in a ToolTransportError with a help hint", async () => {
		let caught: unknown;
		try {
			await callToolInProcess("no-such-tool", {}, { timeoutMs: null, env: {} });
		} catch (error) {
			caught = error;
		}

		expect(caught).toBeInstanceOf(ToolTransportError);
		expect((caught as ToolTransportError).hint).toContain("help no-such-tool");
	});
});

describe("callToolOverHttp", () => {
	it("reports an unreachable daemon as a ToolTransportError naming the one-writer rule", async () => {
		let caught: unknown;
		try {
			// Port 1 is never a daemon; loopback refusal is immediate and deterministic.
			await callToolOverHttp("memory-read", { query: "x" }, { timeoutMs: 3000, env: { PORT: "1" } });
		} catch (error) {
			caught = error;
		}

		expect(caught).toBeInstanceOf(ToolTransportError);
		expect((caught as ToolTransportError).message).toContain("http://127.0.0.1:1/mcp");
		expect((caught as ToolTransportError).hint).toContain("will not open a second database");
	});
});
