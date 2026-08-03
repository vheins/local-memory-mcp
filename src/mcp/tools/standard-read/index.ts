/**
 * standard-read — orchestrator + re-exports.
 *
 * Auto-infer logic:
 * - `query` present → SEARCH  (hybrid scoring per SPEC-001)
 * - `id`/`code`/`ids`/`codes` → DETAIL (single or bulk)
 * - none                    → LIST   (paginated list of all standards)
 */

import { StandardReadSchema, StandardReadInput } from "../schemas/index";
import { SQLiteStore } from "../../storage/sqlite";
import { VectorStore } from "../../types";
import { McpResponse, createMcpResponse } from "../../utils/mcp-response";
import { inferReadMode } from "../../utils/auto-infer";
import { fetchAggregatedKgContext } from "../kg-archivist/query";
import { handleSearchMode } from "./search";
import { handleDetailMode } from "./detail";

// Re-export sub-modules for direct access
export { handleDetailMode } from "./detail";
export { handleSearchMode } from "./search";

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

	let contentSummary: string;
	if (standards.length > 0) {
		const parts = ["### Standards", ""];

		// Grouped bullets by language (fallback "-" for null)
		const grouped = new Map<string, typeof standards>();
		const groupOrder: string[] = [];
		for (const s of standards) {
			const lang = s.language || "-";
			if (!grouped.has(lang)) {
				grouped.set(lang, []);
				groupOrder.push(lang);
			}
			grouped.get(lang)!.push(s);
		}

		// Sort group keys: "-" last, others alphabetically
		groupOrder.sort((a, b) => {
			if (a === "-" && b === "-") return 0;
			if (a === "-") return 1;
			if (b === "-") return -1;
			return a.localeCompare(b);
		});

		for (const lang of groupOrder) {
			const items = grouped.get(lang)!;
			parts.push(`**${lang} (${items.length})**`);
			for (const s of items) {
				const scopePart = s.is_global ? "" : ` — ${s.repo || "-"}`;
				parts.push(`- ${s.code ?? "-"} ${s.title} — ${s.context}${scopePart}`);
			}
			parts.push("");
		}

		parts.push("Use standard-read with code for full content.");
		contentSummary = parts.join("\n");
	} else {
		contentSummary = "No coding standards found.";
	}

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

	// Auto-infer mode via the shared helper (OPT-DRY-06):
	//   query → SEARCH · id/code/ids/codes → DETAIL · none → LIST
	// `query` uses "defined" presence — an explicit empty-string query routes
	// to SEARCH like the other read tools (previously truthy here, so
	// `query: ""` fell through to LIST).
	const mode = inferReadMode(validated, {
		rules: [
			{ mode: "search", fields: ["query"] },
			{ mode: "detail", fields: ["id", "code", "ids", "codes"] }
		],
		fallback: "list"
	});

	switch (mode) {
		case "search":
			return handleSearchMode(validated, db, vectors);
		case "detail":
			return handleDetailMode(validated, db);
		default:
			return handleListMode(validated, db);
	}
}
