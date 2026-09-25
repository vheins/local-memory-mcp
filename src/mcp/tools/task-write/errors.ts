import { Task } from "../../types";
import { looksLikeTaskCode } from "../../utils/code-shape";

// Re-export the short-code shape detector so task-write consumers (and tests)
// have a single import surface; the implementation lives in utils/code-shape.ts.
export { looksLikeTaskCode };

// ---------------------------------------------------------------------------
// Caller-actionable task-write error messages (FIX-027)
// ---------------------------------------------------------------------------
//
// Live task-write friction showed opaque rejections that never told the caller
// WHICH item failed or HOW to fix the shape:
//   - "No updatable fields provided for update item"
//   - "Could not infer operation"
//   - "Missing required fields for create"
//   - "Invalid id format: 'TASK-431'"
//   - "Task code 'TASK-463' already exists"
//
// Every builder below keeps the leading directive token that
// `classifyExpectedError` (utils/mcp-error.ts) uses to map the failure to a
// stable VALIDATION_ERROR/CONFLICT code, while adding the item scope
// (index/code) and the corrective retry shape — mirroring the FIX-024
// "… which does not exist … Create the referenced task first or remove the
// reference." style and the TASK-061 exact-call directive style.

/** The fields of the CREATE contract (used to report exactly which are absent). */
export const CREATE_REQUIRED_FIELDS = ["phase", "title", "description"] as const;

/** Minimal shape needed to detect absent create fields (single or bulk item). */
export type CreateFieldSource = { phase?: unknown; title?: unknown; description?: unknown };

/** Returns the subset of phase/title/description that the item does not supply. */
export function missingCreateFields(item: CreateFieldSource): string[] {
	return CREATE_REQUIRED_FIELDS.filter((field) => !item[field]);
}

/**
 * "Missing required fields" message that names EXACTLY the absent fields.
 * Keeps the leading `Missing` token so `classifyExpectedError` maps it to
 * VALIDATION_ERROR. `scope` selects the single-write vs tasks[] retry shape.
 */
export function missingCreateFieldsMessage(missing: string[], scope: "bulk" | "single"): string {
	const list = missing.join(", ");
	if (scope === "single") {
		return `Missing required fields for single task creation — missing: ${list}. Retry with task-write(phase: "...", title: "...", description: "...") supplying every absent field.`;
	}
	return `Missing required fields for create — missing: ${list}. Every tasks[] create item needs phase, title, and description; retry with tasks: [{ phase: "...", title: "...", description: "..." }].`;
}

/**
 * "No updatable fields" message listing the fields an update item MAY carry so
 * the caller can see what was expected. Keeps the leading `No … provided`
 * token (VALIDATION_ERROR classification).
 */
export function noUpdatableFieldsMessage(fields: readonly string[]): string {
	const base = "No updatable fields provided for update item.";
	return fields.length > 0 ? `${base} Provide at least one of: ${fields.join(", ")}.` : base;
}

/**
 * "Invalid id format" message. When the offending value looks like a task code,
 * emit the explicit `use 'code' instead of 'id'` hint (the live friction:
 * `Invalid id format: 'TASK-431'` where TASK-431 was a real short code). Both
 * branches keep the leading `Invalid` token (VALIDATION_ERROR classification).
 */
export function invalidIdFormatMessage(id: string): string {
	if (looksLikeTaskCode(id)) {
		return `Invalid id format: '${id}' looks like a task code; use 'code' instead of 'id'. Retry with task-write(code: "${id}", ...) or pass the task UUID as 'id'.`;
	}
	return `Invalid id format: '${id}'. Use a UUID or use 'code' for code-based lookup — retry with task-write(code: "<CODE>", ...) or pass a UUID id`;
}

/**
 * "Task code already exists" message that names the EXISTING task (id + status)
 * so the caller can switch to an update instead of retrying the create.
 * `existing` is null when the code was taken by a sibling in the same request
 * (not yet persisted); the message still names the code and the retry shape.
 */
export function duplicateCodeMessage(code: string, existing?: Task | null): string {
	const base = `Task code '${code}' already exists`;
	const retry = `To modify it, update instead of create: task-write(code: "${code}", ...).`;
	if (existing) {
		return `${base} (existing task id "${existing.id}", status "${existing.status}"). ${retry}`;
	}
	return `${base}. ${retry}`;
}

/**
 * Appends the bulk-item scope to an item-level failure so EVERY rejection names
 * the failing item. `label` is the stable label from `describeBulkItem`
 * (`[TASK-431]` / `[id 0000…]` / `#2`) — the item index/code is otherwise lost
 * once the message is thrown on the all-items-failed path.
 */
export function scopeBulkItemError(message: string, label: string): string {
	return `${message} — item ${label}`;
}
