import { StandardSearchSchema } from "./schemas";
import { SQLiteStore } from "../storage/sqlite";
import { CodingStandardEntry, VectorResult, VectorStore } from "../types";
import { logger } from "../utils/logger";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";
import { expandQuery } from "../utils/query-expander";

const HYBRID_WEIGHTS_STANDARD = {
	similarity: 0.4,
	vector: 0.25,
	keyword: 0.3,
	usage: 0.05
};

type StandardConfidence = "high" | "medium" | "low";

function tokenizeSearchText(value: string): string[] {
	return value
		.toLowerCase()
		.split(/[^a-z0-9]+/g)
		.map((token) => token.trim())
		.filter((token) => token.length >= 2);
}

function scoreKeywordRelevance(query: string, standard: CodingStandardEntry): number {
	const queryTokens = Array.from(new Set(tokenizeSearchText(query)));
	if (queryTokens.length === 0) return 0;

	const titleText = standard.title.toLowerCase();
	const contextText = standard.context.toLowerCase();
	const tagText = standard.tags.join(" ").toLowerCase();
	const stackText = standard.stack.join(" ").toLowerCase();
	const contentText = standard.content.toLowerCase();
	const queryPhrase = query.trim().toLowerCase();

	let titleMatches = 0;
	let contextMatches = 0;
	let tagMatches = 0;
	let stackMatches = 0;
	let contentMatches = 0;

	for (const token of queryTokens) {
		if (titleText.includes(token)) titleMatches += 1;
		if (contextText.includes(token)) contextMatches += 1;
		if (tagText.includes(token)) tagMatches += 1;
		if (stackText.includes(token)) stackMatches += 1;
		if (contentText.includes(token)) contentMatches += 1;
	}

	const titleCoverage = titleMatches / queryTokens.length;
	const contextCoverage = contextMatches / queryTokens.length;
	const tagCoverage = tagMatches / queryTokens.length;
	const stackCoverage = stackMatches / queryTokens.length;
	const contentCoverage = contentMatches / queryTokens.length;
	const exactPhraseBonus =
		queryPhrase.length >= 6 &&
		(titleText.includes(queryPhrase) || contentText.includes(queryPhrase) || tagText.includes(queryPhrase))
			? 0.2
			: 0;

	return Math.min(
		1,
		titleCoverage * 0.45 +
			contextCoverage * 0.15 +
			tagCoverage * 0.15 +
			stackCoverage * 0.05 +
			contentCoverage * 0.2 +
			exactPhraseBonus
	);
}

function collectMatchedTerms(query: string, standard: CodingStandardEntry): string[] {
	const queryTokens = Array.from(new Set(tokenizeSearchText(query)));
	if (queryTokens.length === 0) return [];

	const searchableFields = [
		standard.title.toLowerCase(),
		standard.context.toLowerCase(),
		standard.tags.join(" ").toLowerCase(),
		standard.stack.join(" ").toLowerCase(),
		standard.content.toLowerCase()
	];

	return queryTokens.filter((token) => searchableFields.some((field) => field.includes(token)));
}

function toConfidence(finalScore: number, keywordScore: number): StandardConfidence {
	if (finalScore >= 0.72 || keywordScore >= 0.85) return "high";
	if (finalScore >= 0.42 || keywordScore >= 0.45) return "medium";
	return "low";
}

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
		keywordScore: number;
		matchedTerms: string[];
		finalScore: number;
		confidence: StandardConfidence;
	}> = [];

	try {
		const vectorResults = searchQuery
			? await vectors.search(searchQuery, similarityResults.length || validated.limit, validated.repo, "standard")
			: [];
		const vectorScoreMap = new Map(vectorResults.map((row) => [row.id, row.score]));

		if (similarityResults.length > 0) {
			scoredStandards = similarityResults.map((candidate) => {
				const vectorScore = vectorScoreMap.get(candidate.id) ?? 0;
				const keywordScore = scoreKeywordRelevance(validated.query || "", candidate);
				const matchedTerms = collectMatchedTerms(validated.query || "", candidate);
				const usageScore = Math.min(1, candidate.hit_count / 10);
				const finalScore =
					candidate.similarity * HYBRID_WEIGHTS_STANDARD.similarity +
					vectorScore * HYBRID_WEIGHTS_STANDARD.vector +
					keywordScore * HYBRID_WEIGHTS_STANDARD.keyword +
					usageScore * HYBRID_WEIGHTS_STANDARD.usage;
				return {
					standard: candidate,
					similarityScore: candidate.similarity,
					vectorScore,
					keywordScore,
					matchedTerms,
					finalScore,
					confidence: toConfidence(finalScore, keywordScore)
				};
			});
		} else if (vectorResults.length > 0) {
			const fetched = db.standards.getByIds(vectorResults.map((row: VectorResult) => row.id));
			const standardMap = new Map(fetched.map((standard) => [standard.id, standard]));
			scoredStandards = vectorResults.flatMap((row) => {
				const standard = standardMap.get(row.id);
				if (!standard) return [];
				const keywordScore = scoreKeywordRelevance(validated.query || "", standard);
				const matchedTerms = collectMatchedTerms(validated.query || "", standard);
				const usageScore = Math.min(1, standard.hit_count / 10);
				const finalScore =
					row.score * HYBRID_WEIGHTS_STANDARD.vector +
					keywordScore * HYBRID_WEIGHTS_STANDARD.keyword +
					usageScore * (1 - HYBRID_WEIGHTS_STANDARD.vector - HYBRID_WEIGHTS_STANDARD.keyword);
				return [
					{
						standard,
						similarityScore: 0,
						vectorScore: row.score,
						keywordScore,
						matchedTerms,
						finalScore,
						confidence: toConfidence(finalScore, keywordScore)
					}
				];
			});
		}
	} catch (error) {
		logger.warn("Standard vector search failed, using similarity only", { error: String(error) });
		scoredStandards = similarityResults.map((candidate) => {
			const keywordScore = scoreKeywordRelevance(validated.query || "", candidate);
			const matchedTerms = collectMatchedTerms(validated.query || "", candidate);
			const finalScore =
				candidate.similarity * (HYBRID_WEIGHTS_STANDARD.similarity + HYBRID_WEIGHTS_STANDARD.vector * 0.5) +
				keywordScore * HYBRID_WEIGHTS_STANDARD.keyword +
				Math.min(1, candidate.hit_count / 10) * HYBRID_WEIGHTS_STANDARD.usage;
			return {
				standard: candidate,
				similarityScore: candidate.similarity,
				vectorScore: 0,
				keywordScore,
				matchedTerms,
				finalScore,
				confidence: toConfidence(finalScore, keywordScore)
			};
		});
	}

	scoredStandards.sort((a, b) => b.finalScore - a.finalScore);
	const threshold = scoredStandards.length <= 5 ? 0.08 : 0.2;
	let results = scoredStandards.filter((candidate) => candidate.finalScore >= threshold);
	if (results.length === 0 && scoredStandards.length > 0) {
		results = [scoredStandards[0]];
	}

	const paginatedResults = results.slice(validated.offset, validated.offset + validated.limit);
	db.standards.incrementHitCounts(paginatedResults.map(({ standard }) => standard.id));

	logger.info("[Tool] standard.search - searched coding standards", {
		resultCount: paginatedResults.length,
		stack: validated.stack,
		language: validated.language,
		context: validated.context,
		version: validated.version,
		topConfidence: paginatedResults[0]?.confidence
	});

	const COLUMNS = ["code", "id", "title", "context", "language", "scope", "tags", "confidence", "score", "matched_terms", "updated_at"] as const;
	const rows = paginatedResults.map(({ standard, confidence, finalScore, matchedTerms }) => [
		standard.code ?? "-",
		standard.id,
		standard.title,
		standard.context,
		standard.language || "-",
		standard.is_global ? "global" : standard.repo || "-",
		standard.tags.join(", "),
		confidence,
		Number(finalScore.toFixed(3)),
		matchedTerms.join(", "),
		standard.updated_at
	]);

	let contentSummary: string;
	if (paginatedResults.length > 0) {
		const parts = [
			"Standards:",
			"- code|confidence|matched_terms|title|context|language|scope",
			...paginatedResults.map(
				({ standard, confidence, matchedTerms }) =>
					`- ${standard.code ?? "-"}|${confidence}|${matchedTerms.join(", ")}|${standard.title}|${standard.context}|${standard.language || "-"}|${
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
