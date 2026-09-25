import { describe, it, expect } from "vitest";
import {
	validateStatusTransition,
	validateBulkStatus,
	deriveDefaultTransitionComment,
	resolveTransitionComment
} from "../../../tools/task-write/state-machine";

// Unit coverage for the task-write status state machine (FIX-022).
// Mirrors src/mcp/tools/task-write/state-machine.ts per .agents/documents/testing.md §2.1.

describe("task-write state machine — validateStatusTransition", () => {
	it("returns null for a no-op transition (same status)", () => {
		expect(validateStatusTransition("in_progress", "in_progress", undefined, undefined, undefined)).toBeNull();
	});

	it("allows a valid transition with no comment (FIX-022: comment no longer required)", () => {
		// Positive: pending -> in_progress with an empty comment must NOT bounce.
		expect(validateStatusTransition("pending", "in_progress", undefined, undefined, undefined)).toBeNull();
		expect(validateStatusTransition("in_progress", "completed", undefined, undefined, undefined)).toBeNull();
	});

	it("rejects a direct backlog -> completed transition and names the required sequence", () => {
		const err = validateStatusTransition("backlog", "completed", "finishing", undefined, undefined, "TASK-001");
		expect(err).toBeTruthy();
		expect(err).toMatch(/Cannot transition from 'backlog' directly to 'completed'/);
		expect(err).toMatch(/Required sequence: backlog -> in_progress -> completed/);
		expect(err).toMatch(/Must go through 'in_progress' first/);
		// The directive retry shape names the exact task.
		expect(err).toContain('code: "TASK-001"');
	});

	it("rejects direct pending/blocked -> completed transitions (negative)", () => {
		for (const from of ["pending", "blocked"] as const) {
			const err = validateStatusTransition(from, "completed", "x", undefined, undefined, "TASK-002");
			expect(err).toMatch(new RegExp(`Cannot transition from '${from}' directly to 'completed'`));
			expect(err).toMatch(new RegExp(`Required sequence: ${from} -> in_progress -> completed`));
		}
	});
});

describe("task-write state machine — deriveDefaultTransitionComment", () => {
	it("formats a deterministic transition comment", () => {
		const comment = deriveDefaultTransitionComment("pending", "in_progress", "Agent-1", "2026-08-11T09:30:00.000Z");
		expect(comment).toBe("Status: pending -> in_progress (Agent-1, 2026-08-11T09:30:00.000Z)");
	});

	it("falls back to 'unknown' when the agent is missing", () => {
		expect(deriveDefaultTransitionComment("backlog", "pending", undefined, "2026-08-11T09:30:00.000Z")).toBe(
			"Status: backlog -> pending (unknown, 2026-08-11T09:30:00.000Z)"
		);
	});
});

describe("task-write state machine — resolveTransitionComment", () => {
	it("honors an explicit comment verbatim", () => {
		const comment = resolveTransitionComment(
			"Starting work now",
			"pending",
			"in_progress",
			"Agent-1",
			"2026-08-11T09:30:00.000Z"
		);
		expect(comment).toBe("Starting work now");
	});

	it("derives the default when the comment is undefined", () => {
		const comment = resolveTransitionComment(
			undefined,
			"pending",
			"in_progress",
			"Agent-1",
			"2026-08-11T09:30:00.000Z"
		);
		expect(comment).toBe("Status: pending -> in_progress (Agent-1, 2026-08-11T09:30:00.000Z)");
	});

	it("derives the default when the comment is empty or whitespace-only", () => {
		const ts = "2026-08-11T09:30:00.000Z";
		expect(resolveTransitionComment("", "pending", "completed", "Agent-1", ts)).toBe(
			"Status: pending -> completed (Agent-1, 2026-08-11T09:30:00.000Z)"
		);
		expect(resolveTransitionComment("   ", "pending", "completed", "Agent-1", ts)).toBe(
			"Status: pending -> completed (Agent-1, 2026-08-11T09:30:00.000Z)"
		);
	});

	it("never returns an empty string for a transition (audit trail stays non-empty)", () => {
		const comment = resolveTransitionComment("", "backlog", "pending", undefined, "2026-08-11T09:30:00.000Z");
		expect(comment.length).toBeGreaterThan(0);
		expect(comment.trim()).not.toBe("");
	});
});

describe("task-write state machine — validateBulkStatus", () => {
	it("accepts backlog/pending/undefined initial statuses (positive)", () => {
		expect(validateBulkStatus(undefined)).toBeNull();
		expect(validateBulkStatus("backlog")).toBeNull();
		expect(validateBulkStatus("pending")).toBeNull();
	});

	it("rejects non-initial statuses for new tasks (negative)", () => {
		const err = validateBulkStatus("in_progress");
		expect(err).toMatch(/New tasks must be 'backlog' or 'pending'/);
		expect(err).toContain("in_progress");
	});
});
