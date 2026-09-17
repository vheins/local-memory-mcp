import { TaskStatus } from "../../types";

// ---------------------------------------------------------------------------
// Status state machine validation
// ---------------------------------------------------------------------------

/**
 * Validates that a status transition is allowed.
 * Returns a directive error message or null if valid.
 *
 * A comment is REQUIRED on ANY status change — `force` no longer bypasses this
 * gate (TASK-061). `_force` is retained in the signature for API/back-compat
 * with existing callers but is intentionally inert.
 */
export function validateStatusTransition(
	existingStatus: TaskStatus,
	newStatus: TaskStatus,
	comment: string | undefined,
	_force: boolean | undefined,
	_estTokens: number | undefined,
	taskCode?: string
): string | null {
	if (existingStatus === newStatus) return null; // no-op

	// Directive retry shape — keep the leading substring stable for existing
	// tests/consumers, append the exact task-write call to unblock the caller.
	const codeArg = taskCode ? `code: "${taskCode}"` : 'code: "<CODE>"';

	// Comment required on ANY status change (no force bypass).
	if (!comment || comment.trim() === "") {
		return `comment is required when changing task status — retry with task-write(${codeArg}, status: "${newStatus}", comment: "<what changed>")`;
	}

	// Validate transition paths
	const isStartable = existingStatus === "backlog" || existingStatus === "pending" || existingStatus === "blocked";

	if (isStartable && newStatus === "completed") {
		return `Cannot transition from '${existingStatus}' directly to 'completed'. Must go through 'in_progress' first. — call task-write(${codeArg}, status: "in_progress", comment: "...") first, then status: "completed"`;
	}

	return null;
}

/**
 * Validates that a bulk task status is one of the allowed initial values.
 */
export function validateBulkStatus(status: string | undefined): string | null {
	if (!status) return null;
	if (status !== "backlog" && status !== "pending") {
		return `New tasks must be 'backlog' or 'pending'. Got '${status}'.`;
	}
	return null;
}
