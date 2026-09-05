/**
 * standard-read/detail — single or bulk detail by id/code.
 *
 * Handles:
 * - Single standard by `id` or `code`
 * - Bulk standards by `ids[]` or `codes[]`
 */

import { CodingStandardEntry } from "../../types";
import { SQLiteStore } from "../../storage/sqlite";
import { createMcpResponse, McpResponse } from "../../utils/mcp-response";
import { UUID_REGEX } from "../../utils/uuid";
import { fetchKgContext, fetchAggregatedKgContext } from "../kg-archivist/query";
import { StandardReadInput } from "../schemas/index";

// ── Helpers ─────────────────────────────────────────────────────────────

function formatStandardDetail(s: CodingStandardEntry): string[] {
	const lines: string[] = [
		...(s.code ? [`Code: ${s.code}`] : [`ID: ${s.id}`]),
		`Title: ${s.title}`,
		`Parent ID: ${s.parent_id || "-"}`,
		`Context: ${s.context}`,
		`Version: ${s.version}`,
		`Language: ${s.language || "-"}`,
		`Scope: ${s.is_global ? "global" : s.repo || "-"}`,
		`Created: ${s.created_at}`,
		`Updated: ${s.updated_at}`
	];

	if (s.stack.length > 0) lines.push(`Stack: ${s.stack.join(", ")}`);
	if (s.tags.length > 0) lines.push(`Tags: ${s.tags.join(", ")}`);
	if (Object.keys(s.metadata).length > 0) lines.push(`Metadata: ${JSON.stringify(s.metadata)}`);
	if (s.content) {
		lines.push("", "--- Content ---", s.content);
	}
	return lines;
}

function formatBulkDetail(standards: CodingStandardEntry[]): string {
	const SEPARATOR = "\n" + "━".repeat(46) + "\n";
	return (
		standards.length +
		" standard details\n" +
		SEPARATOR +
		standards.map((s) => formatStandardDetail(s).join("\n")).join(SEPARATOR)
	);
}

// ── Detail handler ──────────────────────────────────────────────────────

export async function handleDetailMode(validated: StandardReadInput, db: SQLiteStore): Promise<McpResponse> {
	const { id, code, ids, codes, owner, repo } = validated;

	// Bulk by IDs
	if (ids && ids.length > 0) {
		const standards = db.standards.getByIds(ids);
		// NOTE: hit_count intentionally NOT incremented on read

		const summary = standards.length > 0 ? formatBulkDetail(standards) : "No standards found for the given IDs";

		// KG context only ships inside `structuredContent` (audit F3).
		const kgContext = validated.json
			? fetchAggregatedKgContext(
					db,
					repo ?? "",
					standards.map((s) => s.title),
					"standard"
				)
			: null;
		const data: Record<string, unknown> = { standards, count: standards.length };
		if (kgContext) data.kg = kgContext;

		return createMcpResponse(
			{
				schema: "standard-read" as const,
				mode: "detail" as const,
				...data
			},
			summary,
			{ includeJson: validated.json, contentSummary: summary }
		);
	}

	// Bulk by codes
	if (codes && codes.length > 0) {
		const standards = codes
			.map((c) => db.standards.getByCode(c, owner, repo))
			.filter((s): s is CodingStandardEntry => s !== null);
		// NOTE: hit_count intentionally NOT incremented on read

		const summary = standards.length > 0 ? formatBulkDetail(standards) : "No standards found for the given codes";

		const kgContext = validated.json
			? fetchAggregatedKgContext(
					db,
					repo ?? "",
					standards.map((s) => s.title),
					"standard"
				)
			: null;
		const data: Record<string, unknown> = { standards, count: standards.length };
		if (kgContext) data.kg = kgContext;

		return createMcpResponse(
			{
				schema: "standard-read" as const,
				mode: "detail" as const,
				...data
			},
			summary,
			{ includeJson: validated.json, contentSummary: summary }
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

	const content = formatStandardDetail(standard).join("\n");

	const kgContext = validated.json ? fetchKgContext(db, repo ?? "", standard.title, "standard") : null;
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
