/**
 * Unit tests for the dashboard's in-process tool dispatcher (FIX-013).
 *
 * `callLocalTool` is the replacement for the lazily-started embedded MCP child
 * that used to open a SECOND `SQLiteStore` + `WriteLock` over the dashboard's
 * own `memory.db`. It must behave like every other MCP transport: resolve the
 * legacy alias, run write tools under the write lock, run reads without it, and
 * surface failures as the canonical `ToolError` envelope (code + message).
 *
 * Pure unit — `db`, `vectors`, executor dispatch, arg normalization and the
 * runtime-capability registry are all stubbed; no store, no child process.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const executor = vi.fn();
	const executors = { "task-write": executor, "handoff-write": executor, "memory-read": executor } as Record<
		string,
		ReturnType<typeof vi.fn>
	>;
	return {
		executor,
		executors,
		// The dispatcher builds the executor map ONCE at module load (FIX-026),
		// so the factory must already return the map when the module evaluates —
		// a `beforeEach` return value would arrive after import.
		buildExecutors: vi.fn(() => executors),
		db: { withWrite: vi.fn((fn: () => unknown) => fn()), actions: { logAction: vi.fn() } },
		vectors: { search: vi.fn() },
		ensureSemantic: vi.fn(),
		reuseTelemetry: { recordTool: vi.fn(), flushIfNeeded: vi.fn() },
		metrics: { recordTool: vi.fn() }
	};
});

vi.mock("../../lib/context", () => ({ db: mocks.db, vectors: mocks.vectors }));

vi.mock("../../../mcp/tools", () => ({ buildExecutors: mocks.buildExecutors }));

vi.mock("../../../mcp/session", () => ({
	createSessionContext: () => ({ sessionId: "test-session", transport: "http" })
}));

vi.mock("../../../mcp/utils/normalize-args", () => ({
	// Passthrough: argument normalization has its own tests; here we assert the
	// dispatcher forwards the normalized result into the executor.
	normalizeToolArguments: (args: Record<string, unknown>) => args
}));

vi.mock("../../../mcp/runtime-capabilities", () => ({
	isSemanticToolDemand: () => false,
	getRuntimeCapabilities: () => ({ ensure: mocks.ensureSemantic })
}));

vi.mock("../../../mcp/utils/logger", () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

// FIX-025: the real action-log policy (gate + metadata derivation) runs against
// the spy sink `mocks.db.actions.logAction`; reuse-telemetry and metrics are
// stubbed at the module boundary (real flushIfNeeded needs a SQLiteStore).
vi.mock("../../../mcp/utils/reuse-telemetry", () => ({ reuseTelemetry: mocks.reuseTelemetry }));

vi.mock("../../../mcp/utils/metrics", () => ({ metrics: mocks.metrics }));

import { callLocalTool } from "../../lib/local-tools";
import { ToolError } from "../../../mcp/utils/mcp-error";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.executor.mockResolvedValue({ structuredContent: { ok: true }, isError: false });
});

describe("callLocalTool (FIX-013)", () => {
	it("resolves the legacy task-update alias to the task-write executor", async () => {
		const result = await callLocalTool("task-update", { id: "t-1", status: "completed" });

		expect(mocks.executor).toHaveBeenCalledWith(
			expect.objectContaining({ id: "t-1", status: "completed" }),
			mocks.db,
			mocks.vectors
		);
		expect(result).toEqual({ ok: true });
	});

	it("normalizes dotted names (memory.store → memory-store key)", async () => {
		mocks.executors["memory-store"] = mocks.executor;

		await callLocalTool("memory.store", { title: "x" });

		// The dot is normalized to a hyphen before the executor lookup; without
		// that normalization the hyphenated key would never be reached.
		expect(mocks.executor).toHaveBeenCalledWith(expect.objectContaining({ title: "x" }), mocks.db, mocks.vectors);
	});

	it("runs write tools under db.withWrite and reads without the lock", async () => {
		await callLocalTool("handoff-write", { summary: "s" });
		expect(mocks.db.withWrite).toHaveBeenCalledTimes(1);

		mocks.db.withWrite.mockClear();
		await callLocalTool("memory-read", { query: "q" });
		expect(mocks.db.withWrite).not.toHaveBeenCalled();
	});

	it("throws a NOT_FOUND ToolError for an unknown tool", async () => {
		await expect(callLocalTool("does-not-exist", {})).rejects.toMatchObject({
			name: "ToolError",
			code: "NOT_FOUND",
			message: "Unknown tool: does-not-exist"
		});
		expect(mocks.executor).not.toHaveBeenCalled();
	});

	it("surfaces a handler failure as the canonical ToolError envelope", async () => {
		mocks.executor.mockRejectedValue(new Error("Task not found"));

		let caught: unknown;
		try {
			await callLocalTool("task-update", { id: "ghost" });
		} catch (error) {
			caught = error;
		}

		expect(caught).toBeInstanceOf(ToolError);
		// Same classification the MCP transports apply ("… not found" → NOT_FOUND).
		expect((caught as ToolError).code).toBe("NOT_FOUND");
		expect((caught as ToolError).message).toBe("Task not found");
	});

	it("returns the tool's structured payload", async () => {
		mocks.executor.mockResolvedValue({ structuredContent: { id: "h-9" }, isError: false });

		await expect(callLocalTool("handoff-write", { summary: "s" })).resolves.toEqual({ id: "h-9" });
	});

	// FIX-025: the dispatcher must emit the same audit/telemetry side effects as
	// both MCP transports (tools/index.ts:287-338) — action_log row for
	// mutations, reuse telemetry, per-tool latency with the transport's outcome
	// derivation. The real logToolAction gate (ACTION_LOG_TOOLS) runs against
	// the spy sink, so a pass here proves the dashboard mutation path writes
	// through the ONE shared audit policy again.

	it("audits a write-tool success: action row + telemetry + success outcome", async () => {
		const response = { structuredContent: { id: "h-9" }, isError: false };
		mocks.executor.mockResolvedValue(response);

		await callLocalTool("handoff-write", { owner: "acme", repo: "demo", summary: "s" });

		// The action_log row: real logToolAction → db.actions.logAction with the
		// mutation action, effective repo, and the response metadata.
		expect(mocks.db.actions.logAction).toHaveBeenCalledTimes(1);
		expect(mocks.db.actions.logAction).toHaveBeenCalledWith(
			"write",
			"acme",
			"demo",
			expect.objectContaining({ response })
		);
		// Reuse telemetry recorded against the dispatcher's store + flushed.
		expect(mocks.reuseTelemetry.recordTool).toHaveBeenCalledWith(
			expect.objectContaining({ toolName: "handoff-write", owner: "acme", repo: "demo", result: response })
		);
		expect(mocks.reuseTelemetry.flushIfNeeded).toHaveBeenCalledWith(mocks.db);
		// Per-tool latency with the transport's outcome derivation.
		expect(mocks.metrics.recordTool).toHaveBeenCalledWith("handoff-write", expect.any(Number), "success");
	});

	it("skips the action row for read tools (ACTION_LOG_TOOLS gate)", async () => {
		await callLocalTool("memory-read", { query: "q" });

		expect(mocks.db.actions.logAction).not.toHaveBeenCalled();
		// Telemetry still records read usage — only the audit write is gated.
		expect(mocks.reuseTelemetry.recordTool).toHaveBeenCalledWith(expect.objectContaining({ toolName: "memory-read" }));
		expect(mocks.metrics.recordTool).toHaveBeenCalledWith("memory-read", expect.any(Number), "success");
	});

	it("logs the error envelope on handler failure and still throws ToolError", async () => {
		mocks.executor.mockRejectedValue(new Error("Task not found"));

		let caught: unknown;
		try {
			await callLocalTool("task-update", { id: "ghost" });
		} catch (error) {
			caught = error;
		}

		// Return contract unchanged: canonical ToolError envelope.
		expect(caught).toBeInstanceOf(ToolError);
		expect((caught as ToolError).code).toBe("NOT_FOUND");

		// The error envelope is audited and timed, mirroring tools/index.ts:287-306.
		expect(mocks.db.actions.logAction).toHaveBeenCalledTimes(1);
		expect(mocks.db.actions.logAction).toHaveBeenCalledWith(
			"write",
			"",
			"unknown",
			expect.objectContaining({ response: expect.objectContaining({ isError: true }) })
		);
		expect(mocks.metrics.recordTool).toHaveBeenCalledWith("task-write", expect.any(Number), "error");
		// Reuse telemetry is success-path only, exactly like the transports.
		expect(mocks.reuseTelemetry.recordTool).not.toHaveBeenCalled();
	});
});
