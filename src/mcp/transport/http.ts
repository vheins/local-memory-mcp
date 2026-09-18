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
 */
import http from "node:http";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import { createHash, timingSafeEqual } from "node:crypto";
import {
	createMcpHandler,
	hostHeaderValidationResponse,
	originValidationResponse,
	localhostAllowedHostnames
} from "@modelcontextprotocol/server";
import type { McpServerFactory } from "@modelcontextprotocol/server";
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

/**
 * Start the Streamable HTTP transport and begin accepting MCP sessions.
 *
 * The store and process-wide workers are NOT touched here — they are already
 * initialized exactly once by the caller (`server.ts`). Each session gets its
 * own `McpServer`/`SessionContext` from `factory`, sharing the single store.
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

	const handler = createMcpHandler(factory, {
		onerror: (error) => logger.warn("[MCP HTTP] handler error", { error: error.message })
	});

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
	 * delegate to the SDK handler → bridge the Web response back to Node.
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
