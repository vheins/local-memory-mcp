import { AgentContextSchema } from "./schemas/index";
import { SQLiteStore } from "../storage/sqlite";
import type { MemoryEntry, VectorStore } from "../types";
import { TASK_STATUS_IN_PROGRESS, TASK_STATUS_PENDING, TASK_STATUS_BACKLOG, TASK_STATUS_BLOCKED } from "../types";
import {
	AGENT_CONTEXT_SOURCE_ORDER,
	codeCandidate,
	handoffCandidate,
	memoryCandidate,
	observationCandidate,
	rankAndPackContext,
	standardCandidate,
	taskCandidate,
	type AgentContextSource,
	type ContextCandidate
} from "./agent-context-compiler";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";
import { logger } from "../utils/logger";

const ACTIVE_TASK_STATUSES = [TASK_STATUS_IN_PROGRESS, TASK_STATUS_PENDING, TASK_STATUS_BACKLOG, TASK_STATUS_BLOCKED];

/**
 * Deliberate divergence from SPEC-001 hybrid weights (see utils/scoring.ts).
 *
 * agent-context ranks context memories by RELEVANCE (vector score) + IMPORTANCE,
 * not by the search-oriented keyword/recency/domain blend used by the three
 * search engines. Kept as an explicit named constant so the divergence is
 * visible and cannot silently drift; do NOT fold into HYBRID_WEIGHTS.
 */
const AGENT_CONTEXT_BLEND = {
	vector: 0.3,
	importance: 0.7
} as const;

export async function handleAgentContext(
	args: Record<string, unknown>,
	db: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	const validated = AgentContextSchema.parse(args);
	const { owner, repo, type_filter, limit, json: isJsonRequest } = validated;
	const objective = validated.objective ?? validated.query ?? "";
	const enabled = new Set<AgentContextSource>(validated.sources);
	const candidateLimit = Math.min(100, Math.max(limit, validated.budget.max_items * 2));
	let memories: MemoryEntry[] = [];
	let decisionMemories: MemoryEntry[] = [];

	if (enabled.has("memories")) {
		if (objective) {
			try {
				const vectorResults = await vectors.search(objective, candidateLimit, repo);
				const vectorScores = new Map(vectorResults.map((result) => [result.id, result.score]));
				const byId = new Map(
					db.memories.getByIds(vectorResults.map((result) => result.id)).map((memory) => [memory.id, memory])
				);
				memories = vectorResults
					.map((result) => byId.get(result.id))
					.filter((item): item is MemoryEntry => Boolean(item));
				if (type_filter) memories = memories.filter((memory) => memory.type === type_filter);
				memories.sort((a, b) => {
					const score = (memory: MemoryEntry) =>
						(vectorScores.get(memory.id) ?? 0) * AGENT_CONTEXT_BLEND.vector +
						((memory.importance ?? 3) / 5) * AGENT_CONTEXT_BLEND.importance;
					return score(b) - score(a) || a.id.localeCompare(b.id);
				});
				if (memories.length === 0)
					memories = db.memories.searchByRepo(owner, repo, objective, type_filter, candidateLimit);
			} catch {
				logger.warn("[Tool] agent-context vector search failed, falling back to keyword", { repo });
				memories = db.memories.searchByRepo(owner, repo, objective, type_filter, candidateLimit);
			}
		} else {
			const excludeTypes: string[] = type_filter ? [] : ["decision"];
			memories = db.memories.getRecentMemories(owner, repo, candidateLimit, 0, false, excludeTypes);
			if (type_filter) memories = memories.filter((memory) => memory.type === type_filter);
		}
	}
	if (enabled.has("decisions") && (!type_filter || type_filter === "decision")) {
		decisionMemories = db.memories.searchByRepo(owner, repo, objective, "decision", candidateLimit);
	}

	const activeTasks = enabled.has("tasks")
		? db.tasks.getTasksByMultipleStatuses(owner, repo, ACTIVE_TASK_STATUSES, candidateLimit, 0, objective || undefined)
		: [];
	if (
		enabled.has("tasks") &&
		validated.task_code &&
		!activeTasks.some((task) => task.task_code === validated.task_code)
	) {
		const requested = db.tasks.getTaskByCode(owner, repo, validated.task_code);
		if (requested) activeTasks.unshift(requested);
	}
	const handoffs = enabled.has("handoffs")
		? db.handoffs.listHandoffs({ owner, repo, status: "pending", limit: candidateLimit, offset: 0 })
		: [];
	const standards = enabled.has("standards")
		? db.standards.search({ query: objective || undefined, owner, repo, limit: candidateLimit, offset: 0 })
		: [];
	const observations = enabled.has("observations")
		? db.explorationObservations.list({
				owner,
				repo,
				include_stale: validated.include_stale,
				limit: candidateLimit,
				offset: 0
			})
		: [];
	const codeSymbols =
		enabled.has("code") && validated.current_file_path
			? db.codebaseSymbols.getSymbolsByFile(repo, validated.current_file_path).slice(0, candidateLimit)
			: [];
	if (enabled.has("code") && validated.current_file_path && validated.budget.code_depth > 0) {
		const symbolIds = new Set(codeSymbols.map((symbol) => symbol.id));
		let frontier = [validated.current_file_path];
		for (let depth = 0; depth < validated.budget.code_depth && frontier.length > 0; depth++) {
			const nextFiles = new Set<string>();
			for (const filePath of frontier.sort()) {
				for (const reference of db.codebaseReferences.getReferencesByFile(repo, filePath).slice(0, candidateLimit)) {
					const targetSymbols = reference.target_file
						? db.codebaseSymbols.getSymbolsByFile(repo, reference.target_file)
						: db.codebaseSymbols.getSymbolByName(repo, reference.symbol_name);
					const referenced = reference.target_symbol_id
						? targetSymbols.find((symbol) => symbol.id === reference.target_symbol_id)
						: targetSymbols.find((symbol) => symbol.name === reference.symbol_name);
					if (referenced && !symbolIds.has(referenced.id)) {
						codeSymbols.push(referenced);
						symbolIds.add(referenced.id);
					}
					if (reference.target_file) nextFiles.add(reference.target_file);
					if (codeSymbols.length >= candidateLimit) break;
				}
				if (codeSymbols.length >= candidateLimit) break;
			}
			frontier = [...nextFiles];
		}
	}

	const memoryIds = new Set(memories.map((memory) => memory.id));
	const uniqueDecisions = decisionMemories.filter((decision) => !memoryIds.has(decision.id));
	const candidates: ContextCandidate[] = [];
	memories.forEach((memory) => candidates.push(memoryCandidate(memory, "memories")));
	uniqueDecisions.forEach((decision) => candidates.push(memoryCandidate(decision, "decisions")));
	activeTasks.forEach((task) => candidates.push(taskCandidate(task, validated.task_code)));
	handoffs.forEach((handoff) => candidates.push(handoffCandidate(handoff)));
	standards.forEach((standard) => candidates.push(standardCandidate(standard)));
	observations.forEach((observation) => candidates.push(observationCandidate(observation)));
	codeSymbols.forEach((symbol) => candidates.push(codeCandidate(symbol)));
	const packed = rankAndPackContext(candidates, objective, validated.budget);
	// Keep the legacy projections independent from compiler packing so existing
	// consumers do not lose rows merely because another source won the budget.
	const selectedMemories = memories.slice(0, limit);
	const selectedDecisions = uniqueDecisions.slice(0, limit);
	const selectedTasks = activeTasks.slice(0, 10);

	const sections = [`--- Active Context for "${repo}" ---`, "", "== Relevant Memories =="];
	sections.push(
		...(selectedMemories.length
			? selectedMemories.map((memory) => `- [${memory.code || "-"}] ${memory.title}: ${memory.content.slice(0, 120)}`)
			: ["(No relevant memories selected)"])
	);
	sections.push("", "== Compiled Context ==");
	sections.push(
		...(packed.included.length
			? packed.included.map((item) => `- [${item.source}/${item.id}] ${item.title}: ${item.text.slice(0, 180)}`)
			: ["(No candidates fit the requested budget)"])
	);
	sections.push(
		"",
		`Estimated ${packed.estimatedTokens}/${validated.budget.tokens} tokens across ${packed.included.length} items.`
	);
	const contentSummary = sections.join("\n").trim();
	const sourceAllocation = Object.fromEntries(
		AGENT_CONTEXT_SOURCE_ORDER.map((source) => [
			source,
			{
				included: packed.included.filter((item) => item.source === source).length,
				excluded: packed.exclusions.filter((item) => item.source === source).length,
				estimated_tokens: packed.included
					.filter((item) => item.source === source)
					.reduce((sum, item) => sum + item.estimated_tokens, 0)
			}
		])
	);
	const structuredData = {
		schema: "agent-context" as const,
		mode: "compiled" as const,
		repo,
		query: objective || null,
		objective: objective || null,
		memories: selectedMemories.map((memory) => ({
			id: memory.id,
			code: memory.code || null,
			title: memory.title,
			type: memory.type,
			importance: memory.importance
		})),
		decisions: selectedDecisions.map((decision) => ({
			id: decision.id,
			code: decision.code || null,
			title: decision.title,
			importance: decision.importance
		})),
		tasks: selectedTasks.map((task) => ({
			task_code: task.task_code,
			title: task.title,
			status: task.status,
			priority: task.priority
		})),
		context: packed.included.map(({ priority: _priority, critical: _critical, ...item }) => item),
		estimated_tokens: packed.estimatedTokens,
		budget: validated.budget,
		allocation: {
			included_items: packed.included.length,
			excluded_items: packed.exclusions.length,
			sources: sourceAllocation
		},
		exclusions: packed.exclusions
	};

	logger.info("[Tool] agent-context", {
		repo,
		included: packed.included.length,
		excluded: packed.exclusions.length,
		estimatedTokens: packed.estimatedTokens
	});
	return createMcpResponse(structuredData, contentSummary, { contentSummary, includeJson: isJsonRequest });
}
