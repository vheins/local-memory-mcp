/**
 * standard-write — orchestrator + re-exports.
 *
 * Auto-infer logic:
 * - `standards[]` → BULK
 * - `id`/`code` + fields → UPDATE
 * - `content` + `name` → CREATE
 */

import { StandardWriteSchema } from "../schemas/index.js";
import { SQLiteStore } from "../../storage/sqlite.js";
import { VectorStore } from "../../types/index.js";
import { McpResponse } from "../../utils/mcp-response.js";
import { handleCreateSingle } from "./create.js";
import { handleUpdateSingle } from "./update.js";
import { handleBulk } from "./bulk.js";

// Re-export types and sub-modules
export type { StandardWriteParams, BulkResult } from "./shared.js";
export { handleCreateSingle } from "./create.js";
export { handleUpdateSingle } from "./update.js";
export { handleBulk } from "./bulk.js";

// ── Main entry point ─────────────────────────────────────────────────────

export async function handleStandardWrite(
	params: Record<string, unknown>,
	db: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	const validated = StandardWriteSchema.parse(params) as unknown as Parameters<typeof handleCreateSingle>[0];

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
}
