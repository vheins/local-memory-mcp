// Feature: mcp-transport-dual-handler (DEBT-423)
//
// Unit tests for the shared dual-era handler `createDualHandler` extracted from
// `transport/http.ts`. The helper routes modern (2026-07-28) traffic to a strict
// `legacy: "reject"` handler and 2025-era traffic to a PER-SESSION stateful
// `WebStandardStreamableHTTPServerTransport` keyed by `Mcp-Session-Id`, so the
// initialize-time `oninitialized` hook (and the MCP roots it applies, TASK-418)
// survives into later tool calls.
//
// These tests drive the helper DIRECTLY over the web-standard `fetch` face —
// no HTTP listener, no jsdom. The SDK client is bridged in-process via its
// `fetch` option, so the same code path the standalone transport and the
// combined daemon server share is exercised here.
//
// Convention follows transport.factory.test.ts: pure TS, in-memory SQLite
// (`createTestStore`) + `StubVectorStore`.

import { describe, it, expect, afterEach } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createTestStore, type SQLiteStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import { createServerFactory } from "../transport/factory";
import { createDualHandler, type DualHandler } from "../transport/http";
import { MCP_HTTP_SESSION_IDLE_TTL_MS } from "../utils/constants";

const ENDPOINT = "http://localhost/mcp";
const JSON_HEADERS = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };

// Synthetic absolute root — no disk state required. Single-root inference gives
// repo = basename(root) and owner = parent-dir name (no .git remote under /tmp).
const ROOT = "/tmp/debt423-dual/proj-a";
const SCOPED = { owner: "debt423-dual", repo: "proj-a" };

const active: Array<{ store: SQLiteStore; handler: DualHandler }> = [];

/** Start a dual handler on a fresh in-memory store + stub vectors. */
async function startHarness(): Promise<{ store: SQLiteStore; handler: DualHandler }> {
	const store = await createTestStore();
	const vectors = new StubVectorStore(store);
	const handler = createDualHandler(createServerFactory(store, vectors, "http"));
	const harness = { store, handler };
	active.push(harness);
	return harness;
}

afterEach(async () => {
	while (active.length > 0) {
		const harness = active.pop()!;
		await harness.handler.close();
		harness.store.close();
	}
});

/** Bridge an SDK client onto the handler's web-standard `fetch` face in-process. */
function bridgedTransport(handler: DualHandler): StreamableHTTPClientTransport {
	return new StreamableHTTPClientTransport(new URL(ENDPOINT), {
		fetch: (url, init) => handler.fetch(new Request(url, init))
	});
}

/** Build a `file://` URI from an already-absolute path (paths here are absolute). */
function fileUri(absPath: string): string {
	return `file://${absPath}`;
}

describe("createDualHandler — legacy session retention (DEBT-423)", () => {
	/**
	 * Raw-wire proof that a 2025-era exchange is served by the stateful legacy
	 * transport, not a throwaway stateless instance: the `initialize` POST
	 * returns an `Mcp-Session-Id` which is then REUSED, and a subsequent
	 * `tools/list` on that id succeeds — while the SAME request without the id
	 * is refused with "Server not initialized" (a stateless fallback would have
	 * answered it).
	 */
	it("retains the initialized session across requests keyed by Mcp-Session-Id", async () => {
		const { handler } = await startHarness();

		// 1. initialize → a session id must be issued and retained.
		const init = await handler.fetch(
			new Request(ENDPOINT, {
				method: "POST",
				headers: JSON_HEADERS,
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "initialize",
					params: {
						protocolVersion: "2025-06-18",
						capabilities: {},
						clientInfo: { name: "debt423-dual-raw", version: "1.0.0" }
					}
				})
			})
		);
		expect(init.status).toBe(200);
		const sessionId = init.headers.get("mcp-session-id");
		expect(sessionId).toBeTruthy();
		await init.text();

		// 2. notifications/initialized on the SAME session → 202.
		const notif = await handler.fetch(
			new Request(ENDPOINT, {
				method: "POST",
				headers: { ...JSON_HEADERS, "mcp-session-id": sessionId! },
				body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })
			})
		);
		expect(notif.status).toBe(202);
		await notif.text();

		// 3. tools/list on the SAME session → the retained, initialized server
		// answers (a throwaway stateless instance could not have kept the id).
		const list = await handler.fetch(
			new Request(ENDPOINT, {
				method: "POST",
				headers: { ...JSON_HEADERS, "mcp-session-id": sessionId! },
				body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
			})
		);
		expect(list.status).toBe(200);
		expect(list.headers.get("mcp-session-id")).toBe(sessionId);
		expect(await list.text()).toContain('"tools"');

		// 4. The same call WITHOUT the session id is refused — proving the
		// session state is genuinely keyed and retained, not reconstructed.
		const noSession = await handler.fetch(
			new Request(ENDPOINT, {
				method: "POST",
				headers: JSON_HEADERS,
				body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} })
			})
		);
		expect(noSession.status).toBe(400);
		expect(await noSession.text()).toContain("Server not initialized");
	});
});

describe("createDualHandler — roots reach later tool calls (DEBT-423)", () => {
	/**
	 * A roots-advertising client's declared root must flow through the retained
	 * per-session context so a scope-LESS write is auto-scoped from it — the
	 * exact end-to-end property the standalone transport's integration test
	 * asserts, here driven directly against the shared helper.
	 */
	it("scopes a roots-advertising session's scope-less write to its own project", async () => {
		const { store, handler } = await startHarness();

		const client = new Client(
			{ name: "debt423-roots", version: "1.0.0" },
			{ capabilities: { roots: { listChanged: true } } }
		);
		client.setRequestHandler("roots/list", async () => ({
			roots: [{ uri: fileUri(ROOT), name: "workspace" }]
		}));
		await client.connect(bridgedTransport(handler));
		try {
			await client.listTools();
			const write = await client.callTool({
				name: "memory-write",
				arguments: {
					type: "code_fact",
					title: "Dual handler roots marker",
					content: "Written with no explicit scope; scoped from the session's MCP roots.",
					importance: 3
				}
			});
			// Roots supplied the scope — the TASK-420 fail-loud guard must not trip.
			expect(write.isError).toBeFalsy();

			const titles = store.memories.getRecentMemories(SCOPED.owner, SCOPED.repo, 50).map((row) => row.title);
			expect(titles).toContain("Dual handler roots marker");
		} finally {
			await client.close();
		}
	});

	/**
	 * A roots-less client must fail LOUD instead of silently writing to the
	 * daemon working directory (TASK-420) — the same guard the standalone
	 * transport's integration test exercises.
	 */
	it("refuses a roots-less scope-less write instead of writing to the daemon CWD", async () => {
		const { handler } = await startHarness();

		const client = new Client({ name: "debt423-rootless", version: "1.0.0" });
		await client.connect(bridgedTransport(handler));
		try {
			const result = await client.callTool({
				name: "memory-write",
				arguments: {
					type: "code_fact",
					title: "Dual handler rootless marker",
					content: "This write must be refused because its scope is undeterminable.",
					importance: 3
				}
			});
			expect(result.isError).toBe(true);
			expect(JSON.stringify(result)).toMatch(/could not be determined/);
		} finally {
			await client.close();
		}
	});
});

/**
 * Open a legacy session via a raw 2025-era `initialize` POST and return its
 * `Mcp-Session-Id`. Reuses the same wire shape as the retention test above.
 */
async function openLegacySession(handler: DualHandler): Promise<string> {
	const init = await handler.fetch(
		new Request(ENDPOINT, {
			method: "POST",
			headers: JSON_HEADERS,
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2025-06-18",
					capabilities: {},
					clientInfo: { name: "idle-sweep", version: "1.0.0" }
				}
			})
		})
	);
	expect(init.status).toBe(200);
	const sessionId = init.headers.get("mcp-session-id");
	expect(sessionId).toBeTruthy();
	await init.text();
	return sessionId!;
}

/** A `tools/list` POST on a given legacy session id. */
function listOnSession(handler: DualHandler, sessionId: string): Promise<Response> {
	return handler.fetch(
		new Request(ENDPOINT, {
			method: "POST",
			headers: { ...JSON_HEADERS, "mcp-session-id": sessionId },
			body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
		})
	);
}

describe("createDualHandler — idle legacy session eviction", () => {
	/**
	 * The SDK client's normal `close()` never sends a `DELETE`, so an abandoned
	 * legacy session would pin its server + transport forever without an idle
	 * sweep. Driving the sweep past the TTL must evict the session, and a
	 * subsequent request on that id must fall back to a fresh/absent session
	 * (400 "Server not initialized" — the id is no longer retained).
	 */
	it("evicts a session idle past the TTL and a later request finds no session", async () => {
		const { handler } = await startHarness();

		const sessionId = await openLegacySession(handler);
		// The session is live right after initialize.
		expect((await listOnSession(handler, sessionId)).status).toBe(200);

		// Drive the sweep just past the TTL using an injected clock.
		handler.sweepIdleLegacySessions(Date.now() + MCP_HTTP_SESSION_IDLE_TTL_MS + 1);

		// The id is gone: the request is served by a FRESH, un-initialized
		// factory server, which refuses with "Server not initialized".
		const afterEviction = await listOnSession(handler, sessionId);
		expect(afterEviction.status).toBe(400);
		expect(await afterEviction.text()).toContain("Server not initialized");
	});

	it("keeps a recently-used session alive", async () => {
		const { handler } = await startHarness();

		const sessionId = await openLegacySession(handler);
		// Touch the session so `lastSeen` is current, then sweep with a `now`
		// that is within the TTL of that touch.
		expect((await listOnSession(handler, sessionId)).status).toBe(200);
		handler.sweepIdleLegacySessions(Date.now() + MCP_HTTP_SESSION_IDLE_TTL_MS - 1_000);

		// Still retained — the same initialized server answers.
		expect((await listOnSession(handler, sessionId)).status).toBe(200);
	});
});
