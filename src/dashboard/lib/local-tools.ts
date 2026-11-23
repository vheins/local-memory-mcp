/**
 * In-process MCP tool dispatch for the dashboard (FIX-013).
 *
 * A standalone dashboard (`src/dashboard/server.ts`) is the single owner of its
 * `SQLiteStore` (FIX-008). Its MCP-dependent routes — task update, bulk status,
 * handoff create, the raw tool runner — used to call `mcpClient.start()`, which
 * spawns a `node <mcp server>` child that opens a SECOND `SQLiteStore` and
 * `WriteLock` over the same `memory.db`. Once a standalone dashboard was started
 * WITHOUT `DASHBOARD_ENABLE_MCP=true`, that second writer appeared lazily on the
 * first such request and both processes then contended for `memory.db.lock`
 * (~50s stall, then "Failed to acquire exclusive write lock").
 *
 * Instead of refusing those routes — which would kill task update / handoff
 * create / the tool runner on a supported entry point — they now dispatch the
 * SAME tool executor through this process's own store. The dispatch core is the
 * one `buildExecutors` (src/mcp/tools/index.ts) produces for every transport,
 * so behaviour stays identical while the second process disappears entirely.
 * The combined daemon mounts these same dashboard routes and inherits the fix
 * with no change to `src/mcp/cli/combined-server.ts`.
 *
 * Lock scope mirrors both transports (`router.ts`, `tools/index.ts`): write
 * tools run under `db.withWrite`, reads do not. That fast path takes no
 * proper-lockfile target for a single mutation, so this process remains the one
 * and only writer.
 *
 * What this dispatch mirrors is the SDK transport's audit / telemetry / outcome
 * semantics (FIX-025). What it does NOT do is resolve http-scope context —
 * see the session note below.
 */
import type { McpResponse } from "../../mcp/utils/mcp-response";
import { createSessionContext } from "../../mcp/session";
import type { SessionContext } from "../../mcp/session";
import { buildExecutors } from "../../mcp/tools";
import { logToolAction } from "../../mcp/utils/action-log";
import { logger } from "../../mcp/utils/logger";
import { metrics } from "../../mcp/utils/metrics";
import { reuseTelemetry } from "../../mcp/utils/reuse-telemetry";
import { toErrorResponse, ToolError } from "../../mcp/utils/mcp-error";
import { normalizeToolArguments } from "../../mcp/utils/normalize-args";
import { TOOL_ALIASES, WRITE_TOOLS } from "../../mcp/utils/tool-plumbing";
import { getRuntimeCapabilities, isSemanticToolDemand } from "../../mcp/runtime-capabilities";
import { db, vectors } from "./context";

/**
 * The dashboard acts as ONE local MCP client, so it gets one session for the
 * process's lifetime.
 *
 * `transport: "http"` is a LOCAL GUARD LABEL, not a scope resolver: there is no
 * HTTP request here, no client-declared MCP roots, and no per-request session.
 * It only switches `normalizeToolArguments` to the HTTP write fail-loud rule —
 * a write whose owner/repo cannot be determined refuses to fall back to the
 * process CWD instead of silently targeting the dashboard's directory. The
 * dashboard mutates rows by id/code, never by an inferred CWD scope.
 *
 * In-process dispatch mirrors ONLY the SDK transport's audit / telemetry /
 * outcome semantics (FIX-025: `logToolAction`, `reuseTelemetry`, `metrics`).
 * It does NOT resolve http-scope context: a call's scope is what the caller
 * passes (explicit owner/repo), with the local session's CWD-derived owner/repo
 * only as a fallback.
 */
const session: SessionContext = { ...createSessionContext("http"), clientName: "dashboard" };

/**
 * The executor map, built ONCE for the process lifetime.
 *
 * `buildExecutors` is a pure factory: it closes over the session and returns
 * the same handlers every transport dispatches, with no per-call state. Building
 * it once at module load keeps executor identity stable and stops every call
 * from paying for a rebuild.
 */
const executors = buildExecutors(session);

/**
 * Dispatch a canonical MCP tool name in-process against the dashboard store.
 *
 * Legacy names are normalized first (`task-update` → `task-write`,
 * `claim-release` → `claim-manage`, dots → hyphens), matching the router, so
 * callers keep the historic argument shapes unchanged.
 *
 * Failures are surfaced as a thrown {@link ToolError} carrying the canonical
 * envelope's `code` + `message` and the sanitized (non-secret) message, so a
 * caller can map the failure to its own error shape.
 *
 * @param toolName Canonical or legacy tool name (`memory-read`, `task-update`, …).
 * @param args     Raw tool arguments, normalized exactly as an MCP client would.
 * @returns The tool's structured payload (`McpResponse.structuredContent`).
 * @throws {ToolError} When the tool is unknown or the handler fails.
 */
export async function callLocalTool(toolName: string, args: Record<string, unknown> = {}): Promise<unknown> {
	const rawName = toolName.replace(/\./g, "-");
	const name = TOOL_ALIASES[rawName] ?? rawName;
	const executor = executors[name];
	if (!executor) {
		throw new ToolError("NOT_FOUND", `Unknown tool: ${toolName}`);
	}

	const normalizedArgs = normalizeToolArguments(args, session, { toolName: name });
	if (isSemanticToolDemand(name, normalizedArgs)) {
		void getRuntimeCapabilities().ensure("semantic");
	}

	const run = () => executor(normalizedArgs, db, vectors);
	const toolStartMs = performance.now();
	let response: McpResponse;
	try {
		// Write tools hold the write lock exactly as both MCP transports do;
		// the fast-path single mutation takes no file lock.
		response = WRITE_TOOLS.has(name) ? await db.withWrite(run) : await run();
	} catch (err) {
		// Same canonical envelope the MCP transports emit, so the dashboard
		// reports the same code/message it would have received over the wire.
		const envelope = toErrorResponse(err);
		// Error-path instrumentation mirrors tools/index.ts:287-306: a
		// fast-failing tool must still show up in per-tool latency stats and
		// produce its (gated) action_log row for the error envelope.
		metrics.recordTool(name, performance.now() - toolStartMs, "error");
		logToolAction(db, name, normalizedArgs, envelope, String(normalizedArgs.owner ?? ""));
		const structured = envelope.structuredContent as { code?: string; message?: string } | undefined;
		if (err instanceof ToolError) throw err;
		throw new ToolError(structured?.code ?? "INTERNAL_ERROR", structured?.message ?? "Internal tool error");
	}

	const durationMs = performance.now() - toolStartMs;
	// Outcome derivation mirrors the SDK transport exactly (tools/index.ts:310-319):
	// PARTIAL_FAILURE → "partial", any other error envelope → "error",
	// degraded payload → "degraded", otherwise "success".
	const structured = response.structuredContent as { code?: unknown; degraded?: unknown } | undefined;
	const outcome = response.isError
		? structured?.code === "PARTIAL_FAILURE"
			? "partial"
			: "error"
		: structured?.degraded === true
			? "degraded"
			: "success";
	metrics.recordTool(name, durationMs, outcome);

	if (response.isError) {
		const structured = response.structuredContent as { code?: string; message?: string } | undefined;
		logger.warn("[local-tools] tool returned an error envelope", { toolName: name, code: structured?.code });
	}

	// Action logging + reuse telemetry — the same ONE shared policy the two MCP
	// transports use (utils/action-log.ts). The ACTION_LOG_TOOLS gate inside
	// logToolAction skips read tools entirely; POLICY 1 holds (logToolAction
	// takes no file lock), so the FIX-013 single-writer guarantee is unchanged.
	logToolAction(db, name, normalizedArgs, response, String(normalizedArgs.owner ?? ""));
	reuseTelemetry.recordTool({
		owner: String(normalizedArgs.owner ?? ""),
		repo: String(normalizedArgs.repo ?? "unknown"),
		session: [session.sessionId, normalizedArgs.task_code ?? normalizedArgs.task_id ?? ""].join(":"),
		toolName: name,
		args: normalizedArgs,
		result: response
	});
	reuseTelemetry.flushIfNeeded(db);

	return response.structuredContent;
}
