import { SQLiteStore } from "../../storage/sqlite";
import { VectorStore } from "../../types";
import { logger } from "../../utils/logger";
import { McpResponse } from "../../utils/mcp-response";
import { inferWriteMode } from "./helpers";
import { handleCreate } from "./create";
import { handleUpdate, handleAcknowledge } from "./update";
import { handleBulk } from "./bulk";

// Re-export sub-module handlers
export { handleCreate } from "./create";
export { handleUpdate, handleAcknowledge } from "./update";
export { handleBulk } from "./bulk";
export {
	inferWriteMode,
	applyDecisionFields,
	applySessionFields,
	buildMemoryEntry,
	checkCreateConflict
} from "./helpers";

// ── Main handler ─────────────────────────────────────────────────────────

/**
 * Unified memory write handler.
 *
 * **Auto-infer logic:**
 * - `memories[]` present → BULK mode (mixed create/update/acknowledge)
 * - `acknowledge` + (`id` or `code`) → ACKNOWLEDGE
 * - `id` or `code` present → UPDATE
 * - `content` present → CREATE (single)
 *
 * **Convenience features:**
 * - `context`/`rationale`/`alternatives` with `type:"decision"` auto-formats content, sets importance=4
 * - `key_decisions`/`next_steps` with `type:"task_archive"` auto-formats content, sets importance=3
 */
export async function handleMemoryWrite(
	params: Record<string, unknown>,
	db: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	const mode = inferWriteMode(params);

	logger.info("[Tool] memory.write — inferred mode", { mode, hasMemories: Array.isArray(params.memories) });

	const json = (params.json as boolean) ?? false;

	switch (mode) {
		case "bulk":
			return handleBulk(params.memories as Record<string, unknown>[], db, vectors, json, params);
		case "acknowledge":
			return handleAcknowledge(params, db, json);
		case "update":
			return handleUpdate(params, db, vectors, json);
		case "create":
		default:
			return handleCreate(params, db, vectors, json);
	}
}
