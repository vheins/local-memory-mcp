/**
 * task-read orchestrator — auto-infers detail/search/list mode from field presence:
 *   - query → SEARCH (hybrid vector + keyword)
 *   - id/task_code/ids/task_codes/code/codes → DETAIL (single or bulk)
 *   - none → LIST (filtered by status/phase with pagination)
 */

import { SQLiteStore } from "../../storage/sqlite";
import { VectorStore } from "../../types";
import { McpResponse } from "../../utils/mcp-response";
import { TaskReadSchema } from "../schemas";
import { handleDetailMode } from "./detail";
import { handleSearchMode } from "./search";
import { handleListMode } from "./list";

// Re-export sub-modules for direct imports
export { handleDetailMode } from "./detail";
export { handleSearchMode } from "./search";
export { handleListMode } from "./list";

// ── Main handler ──────────────────────────────────────────────────────────

export async function handleTaskRead(args: unknown, storage: SQLiteStore, vectors: VectorStore): Promise<McpResponse> {
	const parsed = TaskReadSchema.safeParse(args);
	if (!parsed.success) {
		const missing = parsed.error.issues
			.filter((i) => i.path.some((p) => p === "owner" || p === "repo"))
			.map((i) => i.message)
			.filter(Boolean);
		const msg =
			missing.length > 0
				? `Missing required fields: ${missing.join("; ")}. Pass owner/repo explicitly or configure MCP workspace roots so they can be auto-inferred.`
				: `Validation error: ${parsed.error.message}`;
		return { content: [{ type: "text" as const, text: msg }], isError: true };
	}

	const validated = parsed.data;
	const {
		owner,
		repo,
		query,
		code,
		codes,
		id,
		task_code,
		ids,
		task_codes,
		status,
		phase,
		priority,
		json: isJsonRequest = false
	} = validated;
	const { offset = 0 } = validated;
	let { limit } = validated;

	// Resolve canonical code/codes — prefer code/codes over task_code/task_codes
	const effectiveCode = code ?? task_code;
	const effectiveCodes = codes ?? task_codes;

	// ── Auto-infer mode ──
	if (query !== undefined) {
		// SEARCH mode: query present — default limit 10
		limit = limit ?? 10;
		return handleSearchMode(
			owner,
			repo,
			query,
			status,
			phase,
			priority,
			limit,
			offset,
			isJsonRequest,
			storage,
			vectors
		);
	}

	if (
		effectiveCode !== undefined ||
		id !== undefined ||
		effectiveCodes !== undefined ||
		ids !== undefined ||
		task_codes !== undefined
	) {
		// DETAIL mode: identifier present
		return handleDetailMode(owner, repo, id, effectiveCode, ids, effectiveCodes, isJsonRequest, storage);
	}

	// LIST mode: no query, no identifier — default filtered listing, default limit 5
	limit = limit ?? 5;
	return handleListMode(owner, repo, status, phase, limit, offset, isJsonRequest, storage);
}
