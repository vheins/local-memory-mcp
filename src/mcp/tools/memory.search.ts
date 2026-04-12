import { MemorySearchSchema } from "./schemas.js";
import { SQLiteStore } from "../storage/sqlite.js";
import { VectorStore, MemoryEntry } from "../types.js";
import { normalize } from "../utils/normalize.js";
import { logger } from "../utils/logger.js";
import { createMcpResponse, McpResponse } from "../utils/mcp-response.js";
import { expandQuery } from "../utils/query-expander.js";

const HYBRID_WEIGHTS_VECTOR = {
	similarity: 0.4,
	vector: 0.4,
	importance: 0.2
};

const HYBRID_WEIGHTS_NO_VECTOR = {
	similarity: 0.8,
	importance: 0.2
};

export async function handleMemorySearch(params: any, db: SQLiteStore, vectors: VectorStore): Promise<McpResponse> {
	const validated = MemorySearchSchema.parse(params);

	const searchQuery = expandQuery(validated.query, validated.prompt);

	// 1. Get Candidates from SQLite
	// Fetch more than limit to support offset slicing after scoring
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
		similarityScore: (r as any).similarity as number
	}));

	// 2. Workspace & Tag Affinity Boost
	if (candidates.length > 0) {
		const currentPath = validated.current_file_path?.toLowerCase();
		const currentTags = (validated.current_tags || []).map((t) => t.toLowerCase());
		const currentBranch = validated.scope?.branch;

		candidates = candidates.map((c) => {
			let boost = 0;

			// Branch boost (+0.1)
			if (currentBranch && c.memory.scope.branch === currentBranch) {
				boost += 0.1;
			}

			// Folder boost (+0.15)
			if (currentPath && c.memory.scope.folder && currentPath.includes(c.memory.scope.folder.toLowerCase())) {
				boost += 0.15;
			}

			// Language boost (+0.1)
			if (currentPath && c.memory.scope.language) {
				const ext = currentPath.split(".").pop();
				if (ext && ext.includes(c.memory.scope.language.toLowerCase())) boost += 0.1;
			}

			// Tag affinity boost (+0.2)
			if (currentTags.length > 0 && c.memory.tags.some((t) => currentTags.includes(t.toLowerCase()))) {
				boost += 0.2;
			}

			return { ...c, similarityScore: Math.min(1.0, c.similarityScore + boost) };
		});
	}

	// 3. Vector Re-ranking
	let scoredMemories: any[] = [];
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
			const vectorIds = vectorResults.map((vr: any) => vr.id);
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

	// Absolute fallback: if repo has data but search failed threshold, return top 1
	if (allMatches.length === 0 && scoredMemories.length > 0) {
		allMatches = [scoredMemories[0].memory];
	}

	// Total count of all matches (before pagination)
	const total = allMatches.length;

	// Apply pagination (offset + limit)
	const paginatedResults = allMatches.slice(validated.offset, validated.offset + validated.limit);

	// 5. Post-processing — increment hit count only for pages actually returned
	db.memories.incrementHitCounts(paginatedResults.map((m) => m.id));
	logger.info("[MCP] memory.search", {
		repo: validated.repo,
		query: validated.query,
		total,
		offset: validated.offset,
		returned: paginatedResults.length
	});

	// 6. Build pointer table — columns: [id, title, type, importance]
	const COLUMNS = ["id", "title", "type", "importance"] as const;
	const rows = paginatedResults.map((m) => [m.id, m.title ?? "Untitled", m.type, m.importance]);

	const structuredContent = {
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

	const memoryList = paginatedResults.map((m) => `"${m.title}" (ID: ${m.id})`).join(", ");
	const contentSummary =
		paginatedResults.length > 0
			? `Found ${total} memories for "${validated.query}" (showing ${paginatedResults.length} at offset ${validated.offset}): ${memoryList}. Use memory-detail to read full content.`
			: `No memories found for "${validated.query}" in repo "${validated.repo}".`;

	return createMcpResponse(structuredContent, contentSummary, {
		contentSummary,
		includeSerializedStructuredContent: false
	});
}
