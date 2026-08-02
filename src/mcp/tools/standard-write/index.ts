/**
 * standard-write — orchestrator + re-exports.
 *
 * Auto-infer logic:
 * - `standards[]` → BULK
 * - `id`/`code` + fields → UPDATE
 * - `content` + `name` → CREATE
 */

import { StandardWriteSchema } from "../schemas";
import { SQLiteStore } from "../../storage/sqlite";
import { VectorStore } from "../../types";
import { McpResponse } from "../../utils/mcp-response";
import { handleCreateSingle } from "./create";
import { handleUpdateSingle } from "./update";
import { handleBulk } from "./bulk";

// Re-export types and sub-modules
export type { StandardWriteParams, BulkResult } from "./shared";
export { handleCreateSingle } from "./create";
export { handleUpdateSingle } from "./update";
export { handleBulk } from "./bulk";

// ── Main entry point ─────────────────────────────────────────────────────

export async function handleStandardWrite(
	params: Record<string, unknown>,
	db: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	const validated = StandardWriteSchema.parse(params) as unknown as Parameters<typeof handleCreateSingle>[0];

	// Read-modify-write atomicity (TASK-159 / OPT-PERF-09 review): standard-write
	// create/update run a conflict check (DB read), code allocation
	// (generateNextCode) and INSERT in separate transactions. The fast-path
	// withWrite no longer serializes the whole body, so concurrent processes
	// could bypass the STANDARD_CONFLICT gate or collide on codes. Route the
	// whole body through the exclusive lock.
	return db.withExclusiveWrite(async () => {
		// ── Bulk mode ──
		if (validated.standards && validated.standards.length > 0) {
			return handleBulk(validated, db, vectors);
		}

		// ── Update mode: id or code + any fields ──
		if (validated.id || validated.code) {
			return handleUpdateSingle(validated, db, vectors);
		}

		// ── Create mode: content present (no id/code) ──
		if (validated.content && validated.name) {
			return handleCreateSingle(validated, db, vectors);
		}

		// ── Nothing matched ──
		throw new Error(
			"Could not infer operation. Provide:\n" +
				"  - `standards[]` for BULK CREATE\n" +
				"  - `name` + `content` + `tags` + `metadata` for single CREATE\n" +
				"  - `id`/`code` + fields for UPDATE"
		);
	});
}
