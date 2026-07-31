import { TaskStatus } from "../../types";

// ---------------------------------------------------------------------------
// Status state machine validation
// ---------------------------------------------------------------------------

/**
 * Validates that a status transition is allowed.
 * Returns the error message or null if valid.
 */
export function validateStatusTransition(
	existingStatus: TaskStatus,
	newStatus: TaskStatus,
	comment: string | undefined,
	force: boolean | undefined,
	_estTokens: number | undefined
): string | null {
	if (existingStatus === newStatus) return null; // no-op

	// Comment required unless force bypass
	if (!force && (!comment || comment.trim() === "")) {
		return "comment is required when changing task status";
	}

	// Validate transition paths
	const isStartable = existingStatus === "backlog" || existingStatus === "pending" || existingStatus === "blocked";

	if (isStartable && newStatus === "completed") {
		return `Cannot transition from '${existingStatus}' directly to 'completed'. Must go through 'in_progress' first.`;
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
