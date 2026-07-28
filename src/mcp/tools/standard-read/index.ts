/**
 * standard-read — orchestrator + re-exports.
 *
 * Auto-infer logic:
 * - `query` present → SEARCH  (hybrid scoring per SPEC-001)
 * - `id`/`code`/`ids`/`codes` → DETAIL (single or bulk)
 * - none                    → LIST   (paginated list of all standards)
 */

import { StandardReadSchema, StandardReadInput } from "../schemas/standard.read.js";
import { SQLiteStore } from "../../storage/sqlite.js";
import { VectorStore } from "../../types/index.js";
import { McpResponse, createMcpResponse } from "../../utils/mcp-response.js";
import { fetchAggregatedKgContext } from "../kg-archivist/query.js";
import { handleSearchMode } from "./search.js";
import { handleDetailMode } from "./detail.js";

// Re-export sub-modules for direct access
export { handleDetailMode } from "./detail.js";
export { handleSearchMode } from "./search.js";

// ── List columns ────────────────────────────────────────────────────────

const LIST_COLUMNS = ["code", "id", "title", "context", "language", "scope", "tags", "version", "updated_at"] as const;

// ── List handler ─────────────────────────────────────────────────────────

async function handleListMode(validated: StandardReadInput, db: SQLiteStore): Promise<McpResponse> {
	const filterParams: Record<string, unknown> = {};

	if (validated.context) filterParams.context = validated.context;
	if (validated.version) filterParams.version = validated.version;
	if (validated.language) filterParams.language = validated.language;
	if (validated.stack && validated.stack.length > 0) filterParams.stack = validated.stack[0];
	if (validated.tags && validated.tags.length > 0) filterParams.tag = validated.tags[0];
	if (validated.repo) filterParams.repo = validated.repo;
	if (validated.is_global !== undefined) filterParams.is_global = validated.is_global;

	const standards = db.standards.search({
		...filterParams,
		limit: validated.limit,
		offset: validated.offset
	} as Parameters<typeof db.standards.search>[0]);

	const rows = standards.map((s) => [
		s.code ?? "-",
		s.id,
		s.title,
		s.context,
		s.language || "-",
		s.is_global ? "global" : s.repo || "-",
		s.tags.join(", "),
		s.version,
		s.updated_at
	]);

	const contentSummary =
		standards.length > 0 ? `Listed ${standards.length} coding standards` : "No coding standards found.";

	const responseData: Record<string, unknown> = {
		schema: "standard-read",
		mode: "list",
		standards: {
			columns: [...LIST_COLUMNS],
			rows
		},
		count: standards.length,
		offset: validated.offset
	};

	// Best-effort KG context (REFACTOR-KG-005)
	if (standards.length > 0) {
		const kgData = fetchAggregatedKgContext(
			db,
			validated.repo ?? "",
			standards.map((s) => s.title),
			"standard"
		);
		if (kgData) responseData.kg = kgData;
	}

	return createMcpResponse(responseData, contentSummary, {
		contentSummary,
		structuredContentPathHint: "standards",
		includeJson: true
	});
}

// ── Main entry point ─────────────────────────────────────────────────────

/**
 * Unified standard-read handler.
 *
 * Auto-infer logic:
 * - `query` present → SEARCH  (hybrid scoring per SPEC-001)
 * - `id`/`code`/`ids`/`codes` → DETAIL (single or bulk)
 * - none                    → LIST   (paginated list of all standards)
 */
export async function handleStandardRead(
	params: Record<string, unknown>,
	db: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	const validated = StandardReadSchema.parse(params);

	// Auto-infer mode
	if (validated.query) {
		return handleSearchMode(validated, db, vectors);
	}
	if (
		validated.id !== undefined ||
		validated.code !== undefined ||
		validated.ids !== undefined ||
		validated.codes !== undefined
	) {
		return handleDetailMode(validated, db);
	}
	return handleListMode(validated, db);
}
