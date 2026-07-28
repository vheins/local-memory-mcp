/**
 * standard-read/detail — single or bulk detail by id/code.
 *
 * Handles:
 * - Single standard by `id` or `code`
 * - Bulk standards by `ids[]` or `codes[]`
 */

import { CodingStandardEntry } from "../../types/index.js";
import { SQLiteStore } from "../../storage/sqlite.js";
import { createMcpResponse, McpResponse } from "../../utils/mcp-response.js";
import { UUID_REGEX } from "../../utils/uuid.js";
import { fetchKgContext, fetchAggregatedKgContext } from "../kg-archivist/query.js";
import { StandardReadInput } from "../schemas/standard-read.js";

// ── Detail handler ──────────────────────────────────────────────────────

export async function handleDetailMode(validated: StandardReadInput, db: SQLiteStore): Promise<McpResponse> {
	const { id, code, ids, codes, owner, repo } = validated;

	// Bulk by IDs
	if (ids && ids.length > 0) {
		const standards = db.standards.getByIds(ids);
		// NOTE: hit_count intentionally NOT incremented on read

		const lines =
			standards.length > 0 ? `Found ${standards.length} standards by IDs` : "No standards found for the given IDs";

		const kgContext = fetchAggregatedKgContext(
			db,
			repo ?? "",
			standards.map((s) => s.title),
			"standard"
		);
		const data: Record<string, unknown> = { standards, count: standards.length };
		if (kgContext) data.kg = kgContext;

		return createMcpResponse(
			{
				schema: "standard-read" as const,
				mode: "detail" as const,
				...data
			},
			lines,
			{ includeJson: validated.json, contentSummary: lines }
		);
	}

	// Bulk by codes
	if (codes && codes.length > 0) {
		const standards = codes
			.map((c) => db.standards.getByCode(c, owner, repo))
			.filter((s): s is CodingStandardEntry => s !== null);
		// NOTE: hit_count intentionally NOT incremented on read

		const lines =
			standards.length > 0 ? `Found ${standards.length} standards by codes` : "No standards found for the given codes";

		const kgContext = fetchAggregatedKgContext(
			db,
			repo ?? "",
			standards.map((s) => s.title),
			"standard"
		);
		const data: Record<string, unknown> = { standards, count: standards.length };
		if (kgContext) data.kg = kgContext;

		return createMcpResponse(
			{
				schema: "standard-read" as const,
				mode: "detail" as const,
				...data
			},
			lines,
			{ includeJson: validated.json, contentSummary: lines }
		);
	}

	// Single by ID or code
	let standard: CodingStandardEntry | null = null;
	if (id) {
		standard = UUID_REGEX.test(id) ? db.standards.getById(id) : db.standards.getByCode(id, owner, repo);
	} else if (code) {
		standard = db.standards.getByCode(code, owner, repo);
	}

	if (!standard) {
		const identifier = id ?? code;
		throw new Error(`Coding standard not found: ${identifier}`);
	}

	// NOTE: hit_count intentionally NOT incremented on read

	const lines: string[] = [
		`ID: ${standard.id}`,
		...(standard.code ? [`Code: ${standard.code}`] : []),
		`Title: ${standard.title}`,
		`Parent ID: ${standard.parent_id || "-"}`,
		`Context: ${standard.context}`,
		`Version: ${standard.version}`,
		`Language: ${standard.language || "-"}`,
		`Scope: ${standard.is_global ? "global" : standard.repo || "-"}`,
		`Created: ${standard.created_at}`,
		`Updated: ${standard.updated_at}`
	];

	if (standard.stack.length > 0) lines.push(`Stack: ${standard.stack.join(", ")}`);
	if (standard.tags.length > 0) lines.push(`Tags: ${standard.tags.join(", ")}`);
	if (Object.keys(standard.metadata).length > 0) lines.push(`Metadata: ${JSON.stringify(standard.metadata)}`);
	if (standard.content) {
		lines.push("", "--- Content ---", standard.content);
	}

	const content = lines.join("\n");

	const kgContext = fetchKgContext(db, repo ?? "", standard.title, "standard");
	const data: Record<string, unknown> = { standard };
	if (kgContext) data.kg = kgContext;

	return createMcpResponse(
		{
			schema: "standard-read" as const,
			mode: "detail" as const,
			...data
		},
		content,
		{
			contentSummary: content,
			includeJson: validated.json
		}
	);
}
