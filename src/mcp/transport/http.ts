/**
 * Streamable HTTP transport for the MCP server (opt-in via `MCP_TRANSPORT=http`).
 *
 * A single long-lived daemon serves MANY MCP clients over Streamable HTTP
 * instead of each client spawning its own stdio server process. That removes
 * duplicated embedding/maintenance/indexing workers and the cross-process
 * SQLite write contention they caused. stdio remains the default transport.
 *
 * This module is a THIN adapter around the SDK's web-standard
 * {@link createMcpHandler}: it bridges Node's `node:http` request/response to
 * the Web `Request`/`Response` the handler expects, enforces bearer auth and
 * localhost Host/Origin validation, and reuses the ONE shared store/worker
 * startup from `server.ts` via a per-session {@link McpServerFactory}.
 *
 * DUAL-HANDLER ROUTING (DEBT-423): the SDK entry has no handler-valued
 * `legacy` option, so 2025-era (legacy) traffic — which is what OpenCode and
 * most current MCP clients speak — must be routed by hand with
 * {@link isLegacyRequest} in front of a strict `legacy: "reject"` modern
 * handler. The modern path stays per-request; the legacy path is served by a
 * STATEFUL {@link WebStandardStreamableHTTPServerTransport} PER SESSION,
 * keyed by the `Mcp-Session-Id` header. That per-session transport retains the
 * initialized `McpServer`, so `oninitialized` (which applies MCP roots via
 * `applySessionRoots`, TASK-418) fires once on the REAL session and its scope
 * reaches every later tool call. A single shared transport cannot do this:
 * the SDK transport holds one `sessionId`/`_initialized` pair, so a second
 * concurrent `initialize` is rejected with "Server already initialized".
 */
import http from "node:http";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import {
	createMcpHandler,
	hostHeaderValidationResponse,
	isLegacyRequest,
	originValidationResponse,
	localhostAllowedHostnames,
	WebStandardStreamableHTTPServerTransport
} from "@modelcontextprotocol/server";
import type {
	JSONRPCMessage,
	McpHandlerRequestOptions,
	McpServer,
	McpServerFactory,
	Server
} from "@modelcontextprotocol/server";
import { MCP_HTTP_ALLOW_INSECURE, MCP_HTTP_PORT } from "../utils/constants";
import { logger } from "../utils/logger";

/** The two supported MCP transports. */
export type TransportMode = "stdio" | "http";

/** Default MCP HTTP bind host — loopback only. */
export const MCP_HTTP_DEFAULT_HOST = "127.0.0.1";
/** Default MCP HTTP endpoint path. */
export const MCP_HTTP_DEFAULT_PATH = "/mcp";

/**
 * Resolve the transport selected by `MCP_TRANSPORT`.
 *
 * `stdio` (the default when unset) and `http` are the only valid values; any
 * other value fails fast with a clear error so a typo never silently falls
 * back to the wrong transport.
 */
export function resolveTransportMode(value: string | undefined = process.env.MCP_TRANSPORT): TransportMode {
	const normalized = (value ?? "stdio").trim().toLowerCase();
	if (normalized === "stdio" || normalized === "http") return normalized;
	throw new Error(`Invalid MCP_TRANSPORT value ${JSON.stringify(value)}: expected "stdio" (default) or "http".`);
}

/** Fully-resolved HTTP transport configuration. */
export interface HttpTransportConfig {
	/** Bind host (loopback by default). */
	host: string;
	/** Bind port (`0` requests an ephemeral port). */
	port: number;
	/** Endpoint path (e.g. `/mcp`). */
	path: string;
	/** Required bearer token, or `undefined` when insecure mode is allowed. */
	token: string | undefined;
	/** When true, an unauthenticated listener is permitted (local dev only). */
	allowInsecure: boolean;
}

/** Options accepted by {@link startHttpTransport}. */
export interface HttpTransportOptions extends HttpTransportConfig {
	/** Per-session server factory (see {@link createServerFactory}). */
	factory: McpServerFactory;
}

/** Handle returned by {@link startHttpTransport} for lifecycle control. */
export interface HttpTransportHandle {
	/** Actual bound port (resolved when `port: 0` was requested). */
	readonly port: number;
	/** Base URL clients connect to (no trailing path). */
	readonly url: string;
	/** Close the HTTP listener, all sessions, and the underlying handler. */
	close(): Promise<void>;
}

/**
 * Resolve HTTP transport configuration from the environment.
 *
 * String values (`MCP_HTTP_HOST`, `MCP_HTTP_PATH`, `MCP_HTTP_TOKEN`) are read
 * inline per the repo convention; the numeric port and boolean insecure flag
 * come from the shared env constants.
 */
export function resolveHttpTransportConfig(): HttpTransportConfig {
	return {
		host: process.env.MCP_HTTP_HOST?.trim() || MCP_HTTP_DEFAULT_HOST,
		port: MCP_HTTP_PORT,
		path: normalizePath(process.env.MCP_HTTP_PATH),
		token: process.env.MCP_HTTP_TOKEN?.trim() || undefined,
		allowInsecure: MCP_HTTP_ALLOW_INSECURE
	};
}

/**
 * Normalize an endpoint path: ensure a single leading slash and no trailing
 * slash (except the root), so `/mcp` and `mcp/` both match requests to `/mcp`.
 */
function normalizePath(raw: string | undefined): string {
	const value = (raw ?? MCP_HTTP_DEFAULT_PATH).trim();
	if (value === "" || value === "/") return "/";
	const withLeading = value.startsWith("/") ? value : `/${value}`;
	return withLeading.endsWith("/") ? withLeading.slice(0, -1) : withLeading;
}

/** A live legacy (2025-era) session: one stateful transport plus its server. */
interface LegacySession {
	transport: WebStandardStreamableHTTPServerTransport;
	product: McpServer | Server;
}

/**
 * Wrap a legacy session transport so server→client messages emitted before the
 * client's standalone SSE (`GET`) stream is open are BUFFERED, not dropped.
 *
 * The SDK transport routes standalone messages — server→client requests such
 * as `roots/list`, and unsolicited notifications — to the single `_GET_stream`
 * registered by a `GET` request, and its `send()` SILENTLY DISCARDS such a
 * message while that stream is closed. A 2025-era client opens the `GET` stream
 * only AFTER its `notifications/initialized` POST returns `202` — strictly
 * after the server's `oninitialized` hook runs — so the initialize-time
 * `roots/list` (which applies the session's MCP roots, TASK-418) would
 * otherwise be lost and the roots would never reach later tool calls. Buffering
 * until the stream opens closes that window deterministically (no timers).
 *
 * Only standalone traffic is buffered; request/response traffic (anything with
 * a `relatedRequestId`, plus result/error responses) passes straight through,
 * so normal tool-call round-trips are unaffected.
 */
function bufferStandaloneUntilSse(transport: WebStandardStreamableHTTPServerTransport): void {
	const buffered: JSONRPCMessage[] = [];
	let sseOpen = false;
	const send = transport.send.bind(transport);
	const handleRequest = transport.handleRequest.bind(transport);

	transport.send = (message, options) => {
		// Mirror the SDK's own routing: a message is standalone when it is not a
		// result/error response and carries no related request id.
		const isResponse = "id" in message && !("method" in message);
		if (!isResponse && options?.relatedRequestId === undefined && !sseOpen) {
			buffered.push(message);
			return Promise.resolve();
		}
		return send(message, options);
	};

	transport.handleRequest = async (request, options) => {
		const response = await handleRequest(request, options);
		if (!sseOpen && request.method === "GET" && response.status === 200) {
			sseOpen = true;
			for (const message of buffered.splice(0)) await send(message);
		}
		return response;
	};
}

/** The web-standard face returned by {@link createDualHandler}. */
export interface DualHandler {
	/** Serve one HTTP request, routing by protocol era (modern vs legacy). */
	fetch: (request: Request, options?: McpHandlerRequestOptions) => Promise<Response>;
	/** Tear down BOTH the modern handler and every live legacy session. */
	close: () => Promise<void>;
}

/**
 * Build the dual-era MCP handler shared by the standalone HTTP transport and
 * the combined daemon server (FEAT-DAEMON-001).
 *
 * The SDK entry ({@link createMcpHandler}) has no handler-valued `legacy`
 * option, so 2025-era traffic — the era OpenCode and most current MCP clients
 * speak — is routed by hand with {@link isLegacyRequest} in front of a strict
 * `legacy: "reject"` modern handler (DEBT-423). The modern path stays
 * per-request; the legacy path is served by a STATEFUL
 * {@link WebStandardStreamableHTTPServerTransport} PER SESSION, keyed by the
 * `Mcp-Session-Id` header. That per-session transport retains the initialized
 * `McpServer`, so `oninitialized` (which applies MCP roots via
 * `applySessionRoots`, TASK-418) fires once on the REAL session and its scope
 * reaches every later tool call. A single shared transport cannot do this: the
 * SDK transport holds one `sessionId`/`_initialized` pair, so a second
 * concurrent `initialize` is rejected with "Server already initialized".
 *
 * Extracted so both mounts (the plain Node listener in
 * {@link startHttpTransport} and the Express pre-route in `combined-server.ts`)
 * share ONE implementation and cannot drift apart.
 *
 * @param factory - Per-session server factory (see {@link createServerFactory}).
 * @param onerror - Reporting callback for out-of-band errors on either leg
 *   (never alters the response). The same callback serves both the modern
 *   handler and each legacy session's transport.
 * @returns A {@link DualHandler} exposing `fetch` and a `close()` that tears
 *   down both legs.
 */
export function createDualHandler(factory: McpServerFactory, onerror?: (error: Error) => void): DualHandler {
	// Modern (2026-07-28) face. Strict: 2025-era traffic is routed by hand
	// (below) rather than served by the SDK's throwaway stateless fallback.
	const modernHandler = createMcpHandler(factory, { legacy: "reject", onerror });

	/**
	 * Live legacy sessions keyed by `Mcp-Session-Id`. Each entry owns ONE
	 * stateful transport (which retains its initialized server) so per-session
	 * state — most importantly the MCP roots applied on `oninitialized` —
	 * persists across that session's requests. A single shared transport cannot
	 * do this: the SDK transport tracks one `sessionId`/`_initialized` pair, so
	 * a second concurrent `initialize` is rejected with "Server already
	 * initialized".
	 */
	const legacySessions = new Map<string, LegacySession>();

	/**
	 * Serve one legacy request. Requests carrying a known `Mcp-Session-Id` go
	 * straight to that session's transport; anything else (an `initialize`, or
	 * a stray/expired request) gets a fresh factory server + transport, which
	 * is RETAINED only when the exchange actually opens a session.
	 */
	async function serveLegacy(webRequest: Request): Promise<Response> {
		const sessionId = webRequest.headers.get("mcp-session-id");
		const existing = sessionId !== null ? legacySessions.get(sessionId) : undefined;
		if (existing !== undefined) return existing.transport.handleRequest(webRequest);

		const product = await factory({ era: "legacy", requestInfo: webRequest });
		const transport = new WebStandardStreamableHTTPServerTransport({
			sessionIdGenerator: () => randomUUID(),
			onsessioninitialized: (id) => {
				legacySessions.set(id, { transport, product });
			}
		});
		// Assign BEFORE connect(): `Protocol.connect` captures the transport's
		// current `onclose`/`onerror` and chains them, so setting these after
		// connect would clobber the server's own teardown hooks.
		transport.onclose = () => {
			if (transport.sessionId !== undefined) legacySessions.delete(transport.sessionId);
		};
		transport.onerror = (error) => onerror?.(error);
		bufferStandaloneUntilSse(transport);
		await product.connect(transport);

		try {
			return await transport.handleRequest(webRequest);
		} finally {
			// Only an `initialize` opens a session (setting `sessionId`); any
			// other un-keyed exchange is one-shot and must not leak its server.
			if (transport.sessionId === undefined) {
				void transport.close().catch(() => {});
				void product.close().catch(() => {});
			}
		}
	}

	return {
		// `isLegacyRequest` classifies from an internal clone, so `request`
		// stays fully readable for whichever handler it is routed to.
		fetch: async (request, options) =>
			(await isLegacyRequest(request)) ? await serveLegacy(request) : await modernHandler.fetch(request, options),
		close: async () => {
			await modernHandler.close();
			const closingLegacy = [...legacySessions.values()].map(async ({ transport, product }) => {
				await transport.close().catch(() => {});
				await product.close().catch(() => {});
			});
			legacySessions.clear();
			await Promise.all(closingLegacy);
		}
	};
}

/**
 * Start the Streamable HTTP transport and begin accepting MCP sessions.
 *
 * The store and process-wide workers are NOT touched here — they are already
 * initialized exactly once by the caller (`server.ts`). Each session gets its
 * own `McpServer`/`SessionContext` from `factory`, sharing the single store.
 *
 * Traffic is split by era via {@link createDualHandler} (DEBT-423): modern
 * (2026-07-28) requests go to a strict `legacy: "reject"`
 * {@link createMcpHandler}; 2025-era requests — the era OpenCode and most
 * current clients speak — go to a per-session stateful
 * {@link WebStandardStreamableHTTPServerTransport} so the initialize-time
 * `oninitialized` hook (and the MCP roots it applies) survives into later tool
 * calls instead of being torn down with a throwaway stateless instance.
 *
 * @param options - Resolved config plus the per-session server factory.
 * @returns A handle exposing the bound port/url and a `close()` method.
 * @throws When bearer auth is required but no token is configured.
 */
export async function startHttpTransport(options: HttpTransportOptions): Promise<HttpTransportHandle> {
	const { host, port, path: endpointPath, token, allowInsecure, factory } = options;

	if (!allowInsecure && !token) {
		throw new Error(
			"MCP HTTP transport requires a bearer token (MCP_HTTP_TOKEN) unless MCP_HTTP_ALLOW_INSECURE=true " +
				"is explicitly set for local development. Refusing to start an unauthenticated HTTP listener."
		);
	}

	const handler = createDualHandler(factory, (error) =>
		logger.warn("[MCP HTTP] handler error", { error: error.message })
	);

	const allowedHostnames = buildAllowedHostnames(host);

	const server = http.createServer((req, res) => {
		void handleNodeRequest(req, res).catch((error: unknown) => {
			logger.error("[MCP HTTP] request failed", { error: String(error) });
			if (!res.headersSent) {
				res.statusCode = 500;
				res.setHeader("Content-Type", "text/plain; charset=utf-8");
			}
			res.end("Internal Server Error");
		});
	});

	await listen(server, host, port);
	const boundPort = (server.address() as AddressInfo).port;

	/**
	 * Handle one Node HTTP exchange: path gate → auth → Host/Origin validation →
	 * route by era → bridge the Web response back to Node.
	 */
	async function handleNodeRequest(nodeReq: IncomingMessage, res: ServerResponse): Promise<void> {
		const url = buildRequestUrl(nodeReq, host, boundPort);

		if (new URL(url).pathname !== endpointPath) {
			res.statusCode = 404;
			res.setHeader("Content-Type", "text/plain; charset=utf-8");
			res.end("Not Found");
			return;
		}

		if (!allowInsecure) {
			const provided = extractBearerToken(nodeReq.headers.authorization);
			if (provided === undefined || token === undefined || !tokensMatch(provided, token)) {
				res.statusCode = 401;
				res.setHeader("WWW-Authenticate", 'Bearer realm="local-memory-mcp"');
				res.setHeader("Content-Type", "text/plain; charset=utf-8");
				res.end("Unauthorized");
				return;
			}
		}

		const webRequest = toWebRequest(nodeReq, url);
		const rejected =
			hostHeaderValidationResponse(webRequest, allowedHostnames) ??
			originValidationResponse(webRequest, allowedHostnames);
		if (rejected !== undefined) {
			await writeWebResponse(res, rejected);
			return;
		}

		const webResponse = await handler.fetch(webRequest);
		await writeWebResponse(res, webResponse);
	}

	logger.info("[MCP HTTP] listening", {
		host,
		port: boundPort,
		path: endpointPath,
		auth: allowInsecure ? "insecure" : "bearer"
	});

	return {
		port: boundPort,
		url: `http://${host}:${boundPort}`,
		close: async () => {
			await handler.close();
			const closed = new Promise<void>((resolve) => server.close(() => resolve()));
			// Terminate lingering keep-alive / SSE connections so close() resolves.
			server.closeAllConnections();
			await closed;
		}
	};
}

/**
 * Build the allowlist for Host/Origin validation: the standard localhost trio
 * plus the configured bind host (so a non-loopback bind is still accepted).
 *
 * Exported for reuse by the combined daemon server (FEAT-DAEMON-001), which
 * mounts the same handler inside Express and must apply identical validation.
 */
export function buildAllowedHostnames(host: string): string[] {
	const allowed = new Set(localhostAllowedHostnames());
	if (host) allowed.add(host);
	return [...allowed];
}

/**
 * Reconstruct the request URL from the Node request. Prefers the `Host`
 * header (which carries the real port) and falls back to the bound host/port.
 *
 * Exported for the combined daemon server (FEAT-DAEMON-001) so both transports
 * reconstruct the request URL identically.
 */
export function buildRequestUrl(nodeReq: IncomingMessage, host: string, port: number): string {
	const hostHeader = nodeReq.headers.host ?? `${host}:${port}`;
	return `http://${hostHeader}${nodeReq.url ?? "/"}`;
}

/**
 * Convert Node request headers into a plain string record suitable for the Web
 * `Headers` constructor. Multi-valued headers (arrays) are joined with `, `
 * per HTTP semantics; `undefined` values are dropped. Returns a plain
 * `Record<string, string>` so the value is assignable under BOTH the Node
 * (undici) and DOM `HeadersInit` definitions (the test tsconfig adds `DOM`).
 */
function nodeHeadersToRecord(headers: IncomingHttpHeaders): Record<string, string> {
	const record: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers)) {
		if (value === undefined) continue;
		record[key] = Array.isArray(value) ? value.join(", ") : value;
	}
	return record;
}

/** `RequestInit` plus Node's `duplex` field, which the DOM lib lacks. */
type NodeRequestInit = RequestInit & { duplex?: "half" };

/**
 * Convert a Node `IncomingMessage` into a Web `Request`. Bodies (POST) are
 * streamed via `Readable.toWeb` with `duplex: "half"`; body-less methods omit
 * the body so the request stays a simple non-streaming request.
 *
 * Exported for the combined daemon server (FEAT-DAEMON-001): Express's
 * `Request` extends `IncomingMessage`, so the same bridge applies unchanged.
 */
export function toWebRequest(nodeReq: IncomingMessage, url: string): Request {
	const method = nodeReq.method ?? "GET";
	const hasBody = method !== "GET" && method !== "HEAD";
	const init: NodeRequestInit = {
		method,
		headers: nodeHeadersToRecord(nodeReq.headers)
	};
	if (hasBody) {
		init.body = Readable.toWeb(nodeReq) as ReadableStream<Uint8Array>;
		init.duplex = "half";
	}
	return new Request(url, init as RequestInit);
}

/**
 * Bridge a Web `Response` back to the Node response: copy status/headers and
 * pipe the (possibly SSE-streamed) body. `pipeline` tears the source down if
 * the client disconnects mid-stream. `headers.forEach` is used instead of
 * iteration so it compiles under both the Node and DOM `Headers` definitions.
 *
 * Exported for the combined daemon server (FEAT-DAEMON-001): Express's
 * `Response` extends `ServerResponse`, so the same bridge applies unchanged.
 */
export async function writeWebResponse(res: ServerResponse, web: Response): Promise<void> {
	res.statusCode = web.status;
	web.headers.forEach((value, key) => {
		if (key.toLowerCase() === "transfer-encoding") return;
		res.setHeader(key, value);
	});
	if (web.body === null) {
		res.end();
		return;
	}
	const source = Readable.fromWeb(web.body as NodeWebReadableStream<Uint8Array>);
	await pipeline(source, res);
}

/**
 * Extract the token from an `Authorization: Bearer <token>` header, or
 * `undefined` when the header is absent or not a bearer scheme.
 */
function extractBearerToken(header: string | string[] | undefined): string | undefined {
	if (typeof header !== "string") return undefined;
	const match = /^Bearer\s+(.+)$/i.exec(header.trim());
	return match ? match[1].trim() : undefined;
}

/**
 * Constant-time bearer-token comparison. Both values are hashed first so the
 * comparison is length-independent and cannot leak the token length via a
 * timing side channel. The token value is never logged.
 */
function tokensMatch(provided: string, expected: string): boolean {
	const a = createHash("sha256").update(provided).digest();
	const b = createHash("sha256").update(expected).digest();
	return timingSafeEqual(a, b);
}

/**
 * Promisified `server.listen` that rejects on bind errors (e.g. EADDRINUSE)
 * with the original error so the caller can surface a clear startup failure.
 */
function listen(server: http.Server, host: string, port: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const onError = (error: Error) => {
			server.off("listening", onListening);
			reject(error);
		};
		const onListening = () => {
			server.off("error", onError);
			resolve();
		};
		server.once("error", onError);
		server.once("listening", onListening);
		server.listen(port, host);
	});
}
