import { MemorySearchSchema } from "./schemas";
import { SQLiteStore } from "../storage/sqlite";
import { VectorStore, MemoryEntry, VectorResult } from "../types";
import { logger } from "../utils/logger";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";
import { expandQuery } from "../utils/query-expander";

const HYBRID_WEIGHTS_VECTOR = {
	similarity: 0.4,
	vector: 0.4,
	importance: 0.2
};

export async function handleMemorySearch(params: unknown, db: SQLiteStore, vectors: VectorStore): Promise<McpResponse> {
	const validated = MemorySearchSchema.parse(params);

	const searchQuery = expandQuery(validated.query, validated.prompt);

	// 1. Get Candidates from SQLite
	const fetchLimit = (validated.offset + validated.limit) * 3;
	const similarityResults = db.memories.searchBySimilarity(
		searchQuery,
		validated.repo,
		fetchLimit,
		validated.include_archived,
		validated.current_tags ?? []
	);

	let candidates = similarityResults.map((r) => ({
		memory: r as MemoryEntry,
		similarityScore: (r as MemoryEntry & { similarity: number }).similarity
	}));

	// 2. Workspace & Tag Affinity Boost
	if (candidates.length > 0) {
		const currentPath = validated.current_file_path?.toLowerCase();
		const currentTags = (validated.current_tags || []).map((t) => t.toLowerCase());
		const currentBranch = validated.scope?.branch;

		candidates = candidates.map((c) => {
			let boost = 0;
			if (currentBranch && c.memory.scope.branch === currentBranch) boost += 0.1;
			if (currentPath && c.memory.scope.folder && currentPath.includes(c.memory.scope.folder.toLowerCase()))
				boost += 0.15;
			if (currentPath && c.memory.scope.language) {
				const ext = currentPath.split(".").pop();
				if (ext && ext.includes(c.memory.scope.language.toLowerCase())) boost += 0.1;
			}
			if (currentTags.length > 0 && c.memory.tags.some((t) => currentTags.includes(t.toLowerCase()))) boost += 0.2;
			return { ...c, similarityScore: Math.min(1.0, c.similarityScore + boost) };
		});
	}

	// 3. Vector Re-ranking
	interface ScoredMemory {
		memory: MemoryEntry;
		similarityScore: number;
		vectorScore: number;
		finalScore: number;
	}
	let scoredMemories: ScoredMemory[] = [];
	try {
		const vectorResults = await vectors.search(searchQuery, candidates.length || 10, validated.repo);
		const vectorScoreMap = new Map(vectorResults.map((vr) => [vr.id, vr.score]));

		if (candidates.length > 0) {
			scoredMemories = candidates.map((c) => {
				const vScore = vectorScoreMap.get(c.memory.id) ?? 0;
				const impBoost = c.memory.importance / 5;
				const finalScore =
					c.similarityScore * HYBRID_WEIGHTS_VECTOR.similarity +
					vScore * HYBRID_WEIGHTS_VECTOR.vector +
					impBoost * HYBRID_WEIGHTS_VECTOR.importance;
				return { ...c, vectorScore: vScore, finalScore };
			});
		} else if (vectorResults.length > 0) {
			const vectorIds = vectorResults.map((vr: VectorResult) => vr.id);
			const fetchedMemories = db.memories.getByIds(vectorIds);
			const memoryMap = new Map(fetchedMemories.map((m) => [m.id, m]));

			for (const vr of vectorResults) {
				const mem = memoryMap.get(vr.id);
				if (mem) {
					const impBoost = mem.importance / 5;
					scoredMemories.push({
						memory: mem,
						similarityScore: 0,
						vectorScore: vr.score,
						finalScore: vr.score * 0.8 + impBoost * 0.2
					});
				}
			}
		}
	} catch (error) {
		logger.warn("Vector search failed, using similarity only", { error: String(error) });
		scoredMemories = candidates.map((c) => ({
			...c,
			vectorScore: 0,
			finalScore: c.similarityScore * 0.8 + (c.memory.importance / 5) * 0.2
		}));
	}

	// 4. Threshold & Final Selection
	scoredMemories.sort((a, b) => b.finalScore - a.finalScore);
	const threshold = scoredMemories.length <= 5 ? 0.1 : 0.4;
	let allMatches = scoredMemories.filter((sm) => sm.finalScore >= threshold).map((sm) => sm.memory);
	if (allMatches.length === 0 && scoredMemories.length > 0) allMatches = [scoredMemories[0].memory];

	const total = allMatches.length;
	const paginatedResults = allMatches.slice(validated.offset, validated.offset + validated.limit);

	db.memories.incrementHitCounts(paginatedResults.map((m) => m.id));
	logger.info("[Tool] memory.search", {
		repo: validated.repo,
		query: validated.query,
		total,
		offset: validated.offset,
		returned: paginatedResults.length
	});

	// 5. Prepare Output
	const COLUMNS = ["id", "code", "title", "type", "importance"] as const;
	const rows = paginatedResults.map((m) => [m.id, m.code || "-", m.title ?? "Untitled", m.type, m.importance]);

	// Group memories by type for tabular text output
	const memoriesByType: Record<string, MemoryEntry[]> = {};
	for (const m of paginatedResults) {
		const typeLabel = m.type || "unknown";
		if (!memoriesByType[typeLabel]) memoriesByType[typeLabel] = [];
		memoriesByType[typeLabel].push(m);
	}

	let contentSummary: string | undefined;
	if (paginatedResults.length > 0) {
		const parts: string[] = [];
		for (const [memType, items] of Object.entries(memoriesByType)) {
			parts.push(`${capitalize(memType)}:`);
			parts.push("- code|importance|title");
			for (const m of items) {
				const code = m.code || "-";
				parts.push(`- ${code}|${m.importance}|${m.title}`);
			}
			parts.push("");
		}
		parts.push("Use memory-detail with memory_id (or code) for full content.");
		contentSummary = parts.join("\n").trim();
	} else {
		contentSummary = `No memories found for "${validated.query}" in repo "${validated.repo}".`;
	}

	const structuredData = {
		schema: "memory-search" as const,
		query: validated.query,
		count: paginatedResults.length,
		total,
		offset: validated.offset,
		limit: validated.limit,
		results: {
			columns: [...COLUMNS],
			rows
		}
	};

	return createMcpResponse(structuredData, contentSummary || `Found ${total} memories for "${validated.query}".`, {
		contentSummary,
		structuredContentPathHint: "results",
		includeSerializedStructuredContent: validated.structured
	});
}

function capitalize(str: string): string {
	return str.charAt(0).toUpperCase() + str.slice(1);
}
