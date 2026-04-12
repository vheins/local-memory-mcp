import { MemoryRecapSchema } from "./schemas";
import { SQLiteStore } from "../storage/sqlite";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";
import { logger } from "../utils/logger";
import { MemoryEntry } from "../types";

export async function handleMemoryRecap(params: unknown, db: SQLiteStore): Promise<McpResponse> {
	const validated = MemoryRecapSchema.parse(params);

	logger.info("[MCP] memory.recap", { repo: validated.repo, limit: validated.limit, offset: validated.offset });

	// Fetch aggregate stats (counts by type, total)
	const stats = db.memories.getStats(validated.repo);

	// Total active memories (excluding task_archive)
	const total = db.memories.getTotalCount(validated.repo, false, ["task_archive"]);

	// Fetch top memories ordered by importance DESC, created_at DESC
	const rows = db.memories.getRecentMemories(validated.repo, validated.limit, validated.offset, false, [
		"task_archive"
	]);

	// Build pointer table — columns: [id, code, title, type, importance]
	const COLUMNS = ["id", "code", "title", "type", "importance"] as const;
	const topRows = rows.map((row) => [row.id, row.code || "-", row.title ?? "Untitled", row.type, row.importance]);

	// Build by_type stats, excluding task_archive
	const byType: Record<string, number> = {};
	for (const [type, count] of Object.entries(stats.byType)) {
		if (type !== "task_archive") {
			byType[type] = count;
		}
	}

	let contentSummary: string | undefined;
	if (!validated.structured) {
		if (total > 0) {
			const parts: string[] = [];

			// Show stats by type
			for (const [memType, count] of Object.entries(byType)) {
				if (count > 0) {
					parts.push(`${capitalize(memType)}: ${count}`);
				}
			}

			// Group top memories by type
			const memoriesByType: Record<string, typeof rows> = {};
			for (const row of rows) {
				const typeLabel = row.type || "unknown";
				if (!memoriesByType[typeLabel]) {
					memoriesByType[typeLabel] = [];
				}
				memoriesByType[typeLabel].push(row);
			}

			for (const [memType, items] of Object.entries(memoriesByType)) {
				parts.push("");
				parts.push(`${capitalize(memType)}:`);
				parts.push("- code|importance|title");
				for (const row of items) {
					const code = row.code || "-";
					parts.push(`- ${code}|${row.importance}|${row.title}`);
				}
			}
			parts.push("");
			parts.push("Use memory-detail with memory_id (or code) for full content.");
			contentSummary = parts.join("\n").trim();
		} else {
			contentSummary = `No memories found for repo "${validated.repo}".`;
		}
	}

	const structuredData = {
		schema: "memory-recap" as const,
		repo: validated.repo,
		count: rows.length,
		total,
		offset: validated.offset,
		limit: validated.limit,
		stats: { byType },
		top: {
			columns: [...COLUMNS],
			rows: topRows
		}
	};

	return createMcpResponse(structuredData, contentSummary || "", {
		contentSummary,
		includeSerializedStructuredContent: false
	});
}

function capitalize(str: string): string {
	return str.charAt(0).toUpperCase() + str.slice(1);
}
