/**
 * CLI tool transport (TASK-011).
 *
 * The CLI talks to the tools through ONE of two paths, chosen per call by
 * whether the daemon owns the database:
 *
 *   - daemon running  → MCP Streamable HTTP against `http://127.0.0.1:$PORT/mcp`
 *     (the combined daemon's own endpoint).
 *   - daemon absent   → in-process dispatch through the dashboard's
 *     `callLocalTool` (FIX-013), which owns this process's single store.
 *
 * The rule is strict and deliberate (FIX-008 / FIX-013 lineage): a live daemon
 * is the one writer over `memory.db`. When the HTTP call fails, this module
 * reports the failure — it NEVER falls back to opening a store, because a second
 * `SQLiteStore` over the same file is the ~50s lock stall the daemon guard
 * exists to prevent.
 *
 * The in-process session is labelled `stdio`, not `http`: the CLI process has
 * exactly one client and its working directory IS that client's project, so the
 * historical CWD-derived scope is correct here and must stay permissive for
 * writes (see `normalizeToolArguments`, TASK-420).
 */
import { DAEMON_DEFAULT_PORT } from "../utils/constants";
import { MCP_HTTP_DEFAULT_PATH } from "../transport/http";

/** Which path a tool call took. */
export type ToolTransportKind = "http" | "in-process";

/** Daemon liveness, as reported by the storage-free PID probe. */
export interface DaemonStatus {
	running: boolean;
	pid: number | null;
}

/** Normalized outcome of one tool call, independent of the transport. */
export interface ToolOutcome {
	transport: ToolTransportKind;
	/** Whether the tool returned an error envelope (or the call itself failed). */
	isError: boolean;
	/** The machine-readable payload, when the tool produced one. */
	structuredContent: unknown;
	/** The human-readable text content blocks, joined. */
	text: string;
}

/** A caller is responsible for normalizing one tool call into a {@link ToolOutcome}. */
export type ToolCaller = (
	name: string,
	args: Record<string, unknown>,
	options: { timeoutMs: number | null; env: NodeJS.ProcessEnv }
) => Promise<ToolOutcome>;

/** Failure that must surface as exit 1 with an actionable message. */
export class ToolTransportError extends Error {
	/** Second line telling the operator what to do next. */
	readonly hint: string;

	constructor(message: string, hint: string) {
		super(message);
		this.name = "ToolTransportError";
		this.hint = hint;
	}
}

export interface ToolTransportDeps {
	env: NodeJS.ProcessEnv;
	/** Storage-free liveness probe (defaults to the daemon PID file). */
	daemonStatus: () => DaemonStatus;
	/** Test seam: replace the HTTP caller. */
	http?: ToolCaller;
	/** Test seam: replace the in-process caller. */
	local?: ToolCaller;
}

export interface ToolTransport {
	/** Which transport a call would take right now, without issuing one. */
	select(): ToolTransportKind;
	/** Issue one tool call over the selected transport. */
	call(name: string, args: Record<string, unknown>, timeoutMs: number | null): Promise<ToolOutcome>;
}

/**
 * Build the transport for one CLI invocation.
 *
 * Selection happens per call, not once at construction, so a daemon that dies
 * between the two is reported honestly instead of being talked to.
 */
export function createToolTransport(deps: ToolTransportDeps): ToolTransport {
	const kind = (): ToolTransportKind => (deps.daemonStatus().running ? "http" : "in-process");

	return {
		select: kind,
		async call(name, args, timeoutMs) {
			if (kind() === "http") {
				const caller = deps.http ?? callToolOverHttp;
				return caller(name, args, { timeoutMs, env: deps.env });
			}
			const caller = deps.local ?? callToolInProcess;
			return caller(name, args, { timeoutMs, env: deps.env });
		}
	};
}

/** Resolve the daemon's MCP URL from the environment (`PORT`, default 3456). */
export function resolveDaemonMcpUrl(env: NodeJS.ProcessEnv = process.env): string {
	const raw = env.PORT?.trim();
	const port = raw ? Number(raw) : DAEMON_DEFAULT_PORT;
	const safePort = Number.isInteger(port) && port > 0 ? port : DAEMON_DEFAULT_PORT;
	return `http://127.0.0.1:${safePort}${MCP_HTTP_DEFAULT_PATH}`;
}

/**
 * Call a tool over the daemon's Streamable HTTP endpoint.
 *
 * A bearer token is attached only when `DASHBOARD_TOKEN` is set (the daemon's
 * auth gate). Every failure — connect refused, timeout, HTTP error, a daemon
 * that answers but is not an MCP server — becomes a {@link ToolTransportError}
 * that names the endpoint and the daemon commands to inspect, and never a
 * fallback to a local store.
 */
export const callToolOverHttp: ToolCaller = async (name, args, { timeoutMs, env }) => {
	const url = resolveDaemonMcpUrl(env);
	const token = env.DASHBOARD_TOKEN?.trim();

	let client: import("@modelcontextprotocol/client").Client;
	let transport: import("@modelcontextprotocol/client").StreamableHTTPClientTransport;
	try {
		const sdk = await import("@modelcontextprotocol/client");
		const { CAPABILITIES } = await import("../capabilities");
		client = new sdk.Client(
			{ name: "local-memory-mcp-cli", version: CAPABILITIES.serverInfo.version },
			{
				enforceStrictCapabilities: false
			}
		);
		transport = new sdk.StreamableHTTPClientTransport(
			new URL(url),
			token ? { requestInit: { headers: { Authorization: `Bearer ${token}` } } } : undefined
		);
		await client.connect(transport);
	} catch (error) {
		throw new ToolTransportError(
			`Could not reach the daemon's MCP endpoint at ${url}: ${describe(error)}`,
			daemonHint(url)
		);
	}

	try {
		const result = await client.callTool(
			{ name, arguments: args },
			timeoutMs !== null ? { timeout: timeoutMs } : undefined
		);
		return {
			transport: "http",
			isError: result.isError === true,
			structuredContent: result.structuredContent,
			text: extractText(result.content)
		};
	} catch (error) {
		throw new ToolTransportError(`The daemon at ${url} failed to answer ${name}: ${describe(error)}`, daemonHint(url));
	} finally {
		await client.close().catch(() => undefined);
		await transport.close().catch(() => undefined);
	}
};

/**
 * Call a tool in this process through the dashboard's in-process dispatcher.
 *
 * Reached only when no daemon holds the database, so this process is the single
 * writer for the duration of the command.
 */
export const callToolInProcess: ToolCaller = async (name, args) => {
	const { callLocalToolResponse } = await import("../../dashboard/lib/local-tools");
	try {
		const response = await callLocalToolResponse(name, args, { transport: "stdio", clientName: "cli" });
		return {
			transport: "in-process",
			isError: response.isError === true,
			structuredContent: response.structuredContent,
			text: extractText(response.content)
		};
	} catch (error) {
		throw new ToolTransportError(
			`${name} failed: ${describe(error)}`,
			"Run 'local-memory-mcp help " + name + "' for the accepted arguments."
		);
	}
};

/** Concatenate the `text` content blocks of an MCP result. */
function extractText(content: unknown): string {
	if (!Array.isArray(content)) return "";
	const texts: string[] = [];
	for (const block of content) {
		if (block && typeof block === "object" && (block as { type?: string }).type === "text") {
			const value = (block as { text?: string }).text;
			if (typeof value === "string") texts.push(value);
		}
	}
	return texts.join("\n");
}

/** One-line error description that never swallows a non-Error throw. */
function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** The actionable second line for a daemon-path failure (one-writer rule). */
function daemonHint(url: string): string {
	return (
		`The daemon is running but did not serve ${url}. Inspect it with 'local-memory-mcp daemon status' ` +
		"and the daemon log; the CLI will not open a second database while the daemon owns one. " +
		"Stop the daemon ('local-memory-mcp daemon stop') to run tools in-process."
	);
}
