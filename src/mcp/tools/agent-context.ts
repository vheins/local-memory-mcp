import { AgentContextSchema } from "./schemas";
import { SQLiteStore } from "../storage/sqlite";
import { MemoryEntry, Task, VectorStore } from "../types";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";
import { logger } from "../utils/logger";

const ACTIVE_TASK_STATUSES = ["in_progress", "pending", "backlog", "blocked"];

export async function handleAgentContext(
	args: Record<string, unknown>,
	db: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	const validated = AgentContextSchema.parse(args);
	const { owner, repo, query, type_filter, limit, json: isJsonRequest } = validated;

	// 1. Search for relevant memories
	let memories: MemoryEntry[];
	let decisionMemories: MemoryEntry[] = [];

	const shouldFetchDecisions = !type_filter || type_filter === "decision";

	if (query) {
		// Primary: vector search with hybrid scoring per SPEC-001
		try {
			const vectorResults = await vectors.search(query, limit, repo);
			if (vectorResults.length > 0) {
				const ids = vectorResults.map((r) => r.id);
				const idSet = new Set(ids);
				// Build vector score map for hybrid scoring
				const vectorScoreMap = new Map<string, number>();
				for (const vr of vectorResults) {
					vectorScoreMap.set(vr.id, vr.score);
				}
				memories = ids
					.map((id) => db.memories.getById(id))
					.filter((m): m is MemoryEntry => m !== null && idSet.has(m.id));
				// Apply type_filter post-hoc if set
				if (type_filter) {
					memories = memories.filter((m) => m.type === type_filter);
				}
				// Apply hybrid scoring: final = (vector × 0.30) + (importance/5 × 0.70)
				memories.sort((a, b) => {
					const vecA = vectorScoreMap.get(a.id) ?? 0;
					const vecB = vectorScoreMap.get(b.id) ?? 0;
					const importanceA = (a.importance ?? 3) / 5;
					const importanceB = (b.importance ?? 3) / 5;
					const blendedA = vecA * 0.3 + importanceA * 0.7;
					const blendedB = vecB * 0.3 + importanceB * 0.7;
					return blendedB - blendedA;
				});
			} else {
				memories = db.memories.searchByRepo(owner, repo, query, type_filter, limit);
			}
		} catch {
			logger.warn("[Tool] agent-context vector search failed, falling back to keyword", { repo });
			memories = db.memories.searchByRepo(owner, repo, query, type_filter, limit);
		}
		if (shouldFetchDecisions) {
			decisionMemories = db.memories.searchByRepo(owner, repo, "", "decision", limit);
		}
	} else {
		const excludeTypes: string[] = type_filter ? [] : ["decision"];
		memories = db.memories.getRecentMemories(owner, repo, limit, 0, false, excludeTypes);
		if (type_filter) {
			memories = memories.filter((m) => m.type === type_filter);
		}
		if (shouldFetchDecisions) {
			decisionMemories = db.memories.searchByRepo(owner, repo, "", "decision", limit);
		}
	}

	// 2. Get active tasks
	const activeTasks = db.tasks.getTasksByMultipleStatuses(owner, repo, ACTIVE_TASK_STATUSES, 10, 0);

	// 3. Deduplicate: remove any decision memories already in the general memories list
	const memoryIds = new Set(memories.map((m) => m.id));
	const uniqueDecisions = decisionMemories.filter((d) => !memoryIds.has(d.id));

	// 4. Build formatted context block
	const sections: string[] = [];
	sections.push(`--- Active Context for ${repo} ---`);
	sections.push("");

	// Memories section
	sections.push("== Relevant Memories ==");
	if (memories.length === 0) {
		sections.push("(No relevant memories found)");
	} else {
		for (const m of memories) {
			const code = m.code || "-";
			const snippet = m.content.length > 120 ? m.content.slice(0, 120) + "..." : m.content;
			sections.push(`- [${code}] (${m.type}, importance: ${m.importance}) ${m.title}`);
			sections.push(`  ${snippet}`);
		}
	}
	sections.push("");

	// Active Tasks section
	sections.push("== Active Tasks ==");
	if (activeTasks.length === 0) {
		sections.push("(No active tasks)");
	} else {
		for (const t of activeTasks) {
			sections.push(`- ${t.task_code} | ${t.status} | priority: ${t.priority} | ${t.title}`);
		}
	}
	sections.push("");

	// Recent Decisions section
	sections.push("== Recent Decisions ==");
	if (uniqueDecisions.length === 0) {
		sections.push("(No recent decision memories)");
	} else {
		for (const d of uniqueDecisions) {
			const code = d.code || "-";
			const snippet = d.content.length > 150 ? d.content.slice(0, 150) + "..." : d.content;
			sections.push(`- [${code}] (importance: ${d.importance}) ${d.title}`);
			sections.push(`  ${snippet}`);
		}
	}
	sections.push("");
	sections.push("Use memory-detail with a memory code for full content.");

	const contentSummary = sections.join("\n").trim();

	const structuredData = {
		schema: "agent-context" as const,
		repo,
		query: query || null,
		memories: memories.map((m) => ({
			id: m.id,
			code: m.code || null,
			title: m.title,
			type: m.type,
			importance: m.importance
		})),
		decisions: uniqueDecisions.map((d) => ({
			id: d.id,
			code: d.code || null,
			title: d.title,
			importance: d.importance
		})),
		tasks: activeTasks.map((t: Task) => ({
			task_code: t.task_code,
			title: t.title,
			status: t.status,
			priority: t.priority
		}))
	};

	logger.info("[Tool] agent-context", {
		repo,
		memories: memories.length,
		decisions: uniqueDecisions.length,
		tasks: activeTasks.length
	});

	return createMcpResponse(structuredData, contentSummary, {
		contentSummary,
		includeJson: isJsonRequest
	});
}
