// Standalone-SSE buffer bounds + re-arm (branch fix).
//
// `bufferStandaloneUntilSse` buffers server→client standalone messages emitted
// while a legacy session's SSE (`GET`) stream is closed (TASK-418 window).
// Previously the buffer was UNBOUNDED and the `sseOpen` flag was never reset:
// a client that initialized but never opened the SSE stream leaked memory, and
// a stream that later closed could never re-arm buffering.
//
// These tests drive the exported helper directly against a stub transport, so
// both the cap and the reset are asserted deterministically.
//
// Convention: pure TS, no jsdom. The helper is transport-internal, so a stub
// `WebStandardStreamableHTTPServerTransport` (with `send`/`handleRequest`
// replaced before wrapping) is the lightest faithful seam.

import { describe, it, expect } from "vitest";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import type { JSONRPCMessage } from "@modelcontextprotocol/server";
import { bufferStandaloneUntilSse, MCP_HTTP_STANDALONE_BUFFER_MAX } from "../transport/http";

const ENDPOINT = "http://localhost/mcp";

/** A minimal standalone notification message (not a response). */
function standalone(i: number): JSONRPCMessage {
	return { jsonrpc: "2.0", method: "notifications/message", params: { i } } as JSONRPCMessage;
}

/**
 * Build a transport whose `send` records forwarded messages and whose
 * `handleRequest` returns a fresh 200 SSE response per call. Both are replaced
 * BEFORE `bufferStandaloneUntilSse` wraps the transport, so the helper binds
 * these stubs as the "underlying" implementations.
 */
function makeStubTransport(): {
	transport: WebStandardStreamableHTTPServerTransport;
	forwarded: JSONRPCMessage[];
} {
	const transport = new WebStandardStreamableHTTPServerTransport();
	const forwarded: JSONRPCMessage[] = [];
	transport.send = (async (message: JSONRPCMessage) => {
		forwarded.push(message);
	}) as typeof transport.send;
	transport.handleRequest = (async () =>
		new Response(new ReadableStream<Uint8Array>({ start: () => {} }), {
			status: 200,
			headers: { "content-type": "text/event-stream" }
		})) as typeof transport.handleRequest;
	return { transport, forwarded };
}

describe("bufferStandaloneUntilSse — bounded buffer + sseOpen reset", () => {
	it("caps the retained buffer at MCP_HTTP_STANDALONE_BUFFER_MAX (drops oldest)", async () => {
		const { transport, forwarded } = makeStubTransport();
		const handle = bufferStandaloneUntilSse(transport);

		const total = MCP_HTTP_STANDALONE_BUFFER_MAX + 150;
		for (let i = 0; i < total; i++) {
			await transport.send(standalone(i));
		}

		// Bounded — never exceeds the cap.
		expect(handle.bufferedCount()).toBe(MCP_HTTP_STANDALONE_BUFFER_MAX);
		// Nothing forwarded while the SSE stream is closed.
		expect(forwarded).toHaveLength(0);

		// Opening the SSE stream drains the buffer (the most recent entries).
		const res = await transport.handleRequest(new Request(ENDPOINT, { method: "GET" }));
		expect(handle.isSseOpen()).toBe(true);
		expect(handle.bufferedCount()).toBe(0);
		expect(forwarded).toHaveLength(MCP_HTTP_STANDALONE_BUFFER_MAX);
		// The OLDEST entries were dropped: the first forwarded message is the
		// one at index `total - MCP_HTTP_STANDALONE_BUFFER_MAX`.
		expect((forwarded[0] as unknown as { params: { i: number } }).params.i).toBe(
			total - MCP_HTTP_STANDALONE_BUFFER_MAX
		);

		await res.body?.cancel().catch(() => {});
	});

	it("resets sseOpen when the SSE stream is cancelled, so a later GET re-arms buffering", async () => {
		const { transport, forwarded } = makeStubTransport();
		const handle = bufferStandaloneUntilSse(transport);

		// First GET opens the stream.
		const first = await transport.handleRequest(new Request(ENDPOINT, { method: "GET" }));
		expect(handle.isSseOpen()).toBe(true);

		// Cancel the stream → sseOpen flips back to false.
		await first.body?.cancel();
		expect(handle.isSseOpen()).toBe(false);

		// A new standalone message is buffered again (not dropped).
		await transport.send(standalone(999));
		expect(handle.bufferedCount()).toBe(1);
		expect(forwarded).toHaveLength(0);

		// A second GET re-arms the stream and drains the buffer.
		const second = await transport.handleRequest(new Request(ENDPOINT, { method: "GET" }));
		expect(handle.isSseOpen()).toBe(true);
		expect(handle.bufferedCount()).toBe(0);
		expect(forwarded).toHaveLength(1);

		await second.body?.cancel().catch(() => {});
	});

	it("forwards (does not buffer) standalone messages once the SSE stream is open", async () => {
		const { transport, forwarded } = makeStubTransport();
		const handle = bufferStandaloneUntilSse(transport);

		const res = await transport.handleRequest(new Request(ENDPOINT, { method: "GET" }));
		expect(handle.isSseOpen()).toBe(true);

		await transport.send(standalone(1));
		expect(handle.bufferedCount()).toBe(0);
		expect(forwarded).toHaveLength(1);

		await res.body?.cancel().catch(() => {});
	});

	it("does not buffer request/response traffic (relatedRequestId present)", async () => {
		const { transport, forwarded } = makeStubTransport();
		const handle = bufferStandaloneUntilSse(transport);

		// A related (non-standalone) message passes straight through.
		await transport.send(standalone(1), { relatedRequestId: 42 });
		expect(handle.bufferedCount()).toBe(0);
		expect(forwarded).toHaveLength(1);
	});
});
