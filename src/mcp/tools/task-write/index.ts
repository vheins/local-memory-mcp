import { SQLiteStore } from "../../storage/sqlite";
import { VectorStore } from "../../types";
import { McpResponse } from "../../utils/mcp-response";
import { TaskWriteSchema } from "../schemas";
import { handleCreateSingle } from "./create";
import { handleUpdate, handleBulkUpdateByIds } from "./update";
import { handleBulk } from "./bulk";
import { handleInteractive } from "./bulk"; // handleInteractive lives in bulk.ts
import { TaskWriteOptions, TaskWriteParams } from "./types";

// Re-export write-parameter types (renamed WriteParams → TaskWriteParams for
// cross-tool naming consistency; TaskWriteOptions is unchanged)
export type { TaskWriteOptions, TaskWriteParams } from "./types";
export type { ItemInfer } from "./types";

// Re-export individual handler functions for direct consumption
export { handleCreateSingle } from "./create";
export { handleUpdate, handleBulkUpdateByIds } from "./update";
export { handleBulk, inferItemMode } from "./bulk";

// Re-export shared helpers
export { validateStatusTransition, validateBulkStatus } from "./state-machine";
export { applyDecisionRefs, tryVectorEmbedding } from "./effects";

// ---------------------------------------------------------------------------
// Main handler entry point
// ---------------------------------------------------------------------------

/**
 * Unified task write handler.
 *
 * **Auto-infer logic (in order of precedence):**
 *   1. `tasks: [...]`            → BULK  — each item infers independently
 *   2. `interactive: true`       → INTERACTIVE — elicit missing fields from user (via form)
 *   3. `phase`+`title`+`desc`    → CREATE (optionally with `code`/`task_code` for custom code)
 *   4. `id` or `code` present    → UPDATE (id=UUID, code=string code)
 *
 * **Status state machine:** backlog ↔ pending ↔ in_progress ↔ completed/canceled/blocked
 *   - comment required on status change
 *   - completed: children MUST be completed first (gate)
 *   - completed: auto-release claims + expire linked handoffs
 *   - canceled: auto-release claims + expire handoffs
 *   - Completed tasks are archived to memory under the write lock, awaited
 *     before the response resolves (deterministic for all bulk/update paths)
 *
 * **Bulk partial execution:** items that fail are skipped, errors returned in response.
 */
export async function handleTaskWrite(
	args: Record<string, unknown>,
	storage: SQLiteStore,
	vectors: VectorStore,
	options: TaskWriteOptions = {}
): Promise<McpResponse> {
	const parsed = TaskWriteSchema.parse(args) as unknown as TaskWriteParams;

	// ── 1. BULK mode ──
	if (parsed.tasks && parsed.tasks.length > 0) {
		return handleBulk(parsed, storage, vectors);
	}

	// ── 2. INTERACTIVE mode ──
	if (parsed.interactive) {
		return handleInteractive(parsed, storage, vectors, options);
	}

	// ── 2b. BULK UPDATE by ids (array of UUIDs) ──
	if (parsed.ids && parsed.ids.length > 0) {
		return handleBulkUpdateByIds(parsed, storage, vectors);
	}

	// ── 3. CREATE mode: phase + title + description (optionally with code/task_code) ──
	// Check CREATE before code-only UPDATE since task_code is now aliased to code
	if (parsed.phase && parsed.title && parsed.description) {
		return handleCreateSingle(parsed, storage, vectors);
	}

	// ── 4. UPDATE mode: id or code present ──
	if (parsed.id || parsed.code) {
		return handleUpdate(parsed, storage, vectors);
	}

	// ── Nothing matched ──
	throw new Error(
		"Could not infer operation. Provide:\n" +
			"  - `phase` + `title` + `description` for CREATE\n" +
			"  - `id` (UUID) or `code` + fields for UPDATE\n" +
			"  - `id` or `code` + `status` for STATUS UPDATE\n" +
			"  - `interactive: true` for guided creation\n" +
			"  - `tasks[]` for BULK create/update"
	);
}
