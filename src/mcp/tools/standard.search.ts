import { StandardSearchSchema } from "./schemas";
import { SQLiteStore } from "../storage/sqlite";
import { CodingStandardEntry, VectorResult, VectorStore } from "../types";
import { logger } from "../utils/logger";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";
import { expandQuery } from "../utils/query-expander";

const HYBRID_WEIGHTS_STANDARD = {
	similarity: 0.55,
	vector: 0.35,
	usage: 0.1
};

export async function handleStandardSearch(
	params: Record<string, unknown>,
	db: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	const validated = StandardSearchSchema.parse(params);
	const searchQuery = expandQuery(validated.query || "", undefined);

	const fetchLimit = (validated.offset + validated.limit) * 3;
	const similarityResults = searchQuery
		? db.standards.searchBySimilarity(searchQuery, {
				context: validated.context,
				version: validated.version,
				language: validated.language,
				stack: validated.stack,
				tags: validated.tags,
				repo: validated.repo,
				is_global: validated.is_global,
				limit: fetchLimit
			})
		: db.standards
				.search({
					context: validated.context,
					version: validated.version,
					language: validated.language,
					stack: validated.stack?.[0],
					tag: validated.tags?.[0],
					repo: validated.repo,
					is_global: validated.is_global,
					limit: fetchLimit,
					offset: 0
				})
				.map((standard) => ({ ...standard, similarity: 0.5 }));

	let scoredStandards: Array<{
		standard: CodingStandardEntry;
		similarityScore: number;
		vectorScore: number;
		finalScore: number;
	}> = [];

	try {
		const vectorResults = searchQuery
			? await vectors.search(searchQuery, similarityResults.length || validated.limit, validated.repo, "standard")
			: [];
		const vectorScoreMap = new Map(vectorResults.map((row) => [row.id, row.score]));

		if (similarityResults.length > 0) {
			scoredStandards = similarityResults.map((candidate) => {
				const vectorScore = vectorScoreMap.get(candidate.id) ?? 0;
				const usageScore = Math.min(1, candidate.hit_count / 10);
				const finalScore =
					candidate.similarity * HYBRID_WEIGHTS_STANDARD.similarity +
					vectorScore * HYBRID_WEIGHTS_STANDARD.vector +
					usageScore * HYBRID_WEIGHTS_STANDARD.usage;
				return {
					standard: candidate,
					similarityScore: candidate.similarity,
					vectorScore,
					finalScore
				};
			});
		} else if (vectorResults.length > 0) {
			const fetched = db.standards.getByIds(vectorResults.map((row: VectorResult) => row.id));
			const standardMap = new Map(fetched.map((standard) => [standard.id, standard]));
			scoredStandards = vectorResults.flatMap((row) => {
				const standard = standardMap.get(row.id);
				if (!standard) return [];
				const usageScore = Math.min(1, standard.hit_count / 10);
				return [
					{
						standard,
						similarityScore: 0,
						vectorScore: row.score,
						finalScore: row.score * 0.9 + usageScore * 0.1
					}
				];
			});
		}
	} catch (error) {
		logger.warn("Standard vector search failed, using similarity only", { error: String(error) });
		scoredStandards = similarityResults.map((candidate) => ({
			standard: candidate,
			similarityScore: candidate.similarity,
			vectorScore: 0,
			finalScore: candidate.similarity * 0.9 + Math.min(1, candidate.hit_count / 10) * 0.1
		}));
	}

	scoredStandards.sort((a, b) => b.finalScore - a.finalScore);
	const threshold = scoredStandards.length <= 5 ? 0.08 : 0.2;
	let results = scoredStandards.filter((candidate) => candidate.finalScore >= threshold).map((candidate) => candidate.standard);
	if (results.length === 0 && scoredStandards.length > 0) {
		results = [scoredStandards[0].standard];
	}

	const paginatedResults = results.slice(validated.offset, validated.offset + validated.limit);
	db.standards.incrementHitCounts(paginatedResults.map((standard) => standard.id));

	logger.info("[Tool] standard.search - searched coding standards", {
		resultCount: paginatedResults.length,
		stack: validated.stack,
		language: validated.language,
		context: validated.context,
		version: validated.version
	});

	const COLUMNS = ["code", "id", "title", "context", "language", "scope", "tags", "updated_at"] as const;
	const rows = paginatedResults.map((standard) => [
		standard.code ?? "-",
		standard.id,
		standard.title,
		standard.context,
		standard.language || "-",
		standard.is_global ? "global" : standard.repo || "-",
		standard.tags.join(", "),
		standard.updated_at
	]);

	let contentSummary: string;
	if (paginatedResults.length > 0) {
		const parts = [
			"Standards:",
			"- code|title|context|language|scope",
			...paginatedResults.map(
				(standard) =>
					`- ${standard.code ?? "-"}|${standard.title}|${standard.context}|${standard.language || "-"}|${
						standard.is_global ? "global" : standard.repo || "-"
					}`
			),
			"",
			"Use standard-detail with code for full content."
		];
		contentSummary = parts.join("\n");
	} else {
		contentSummary = "No matching coding standards found.";
	}

	return createMcpResponse(
		{
			schema: "standard-search" as const,
			query: validated.query || "",
			count: paginatedResults.length,
			total: results.length,
			offset: validated.offset,
			limit: validated.limit,
			results: {
				columns: [...COLUMNS],
				rows
			}
		},
		`Found ${results.length} coding standards matching your query`,
		{
			contentSummary,
			structuredContentPathHint: "results",
			includeSerializedStructuredContent: true
		}
	);
}
