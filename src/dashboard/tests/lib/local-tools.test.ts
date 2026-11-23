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
	return {
		executor,
		executors: { "task-write": executor, "handoff-write": executor, "memory-read": executor } as Record<
			string,
			ReturnType<typeof vi.fn>
		>,
		buildExecutors: vi.fn(),
		db: { withWrite: vi.fn((fn: () => unknown) => fn()) },
		vectors: { search: vi.fn() },
		ensureSemantic: vi.fn()
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

import { callLocalTool } from "../../lib/local-tools";
import { ToolError } from "../../../mcp/utils/mcp-error";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.buildExecutors.mockReturnValue(mocks.executors);
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
});
