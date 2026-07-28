/**
 * standard-read/search — hybrid search (vector + keyword + recency + domain).
 *
 * Implements hybrid scoring per SPEC-001:
 *   0.40 similarity + 0.30 keyword + 0.15 recency + 0.15 domain
 */

import { CodingStandardEntry, VectorStore } from "../../types/index.js";
import { SQLiteStore } from "../../storage/sqlite.js";
import { logger } from "../../utils/logger.js";
import { createMcpResponse, McpResponse } from "../../utils/mcp-response.js";
import { expandQuery } from "../../utils/query-expander.js";
import { fetchAggregatedKgContext } from "../kg-archivist/query.js";
import { StandardReadInput } from "../schemas/standard.read.js";

// ── SPEC-001 Hybrid weights ──────────────────────────────────────────────
// All 3 scoring paths (similarity main, vector-only fallback, error fallback)
// now consistently use: 0.40 similarity + 0.30 keyword + 0.15 recency + 0.15 domain
const HYBRID_WEIGHTS_SPEC001 = {
	similarity: 0.4,
	keyword: 0.3,
	recency: 0.15,
	domain: 0.15
};

type StandardConfidence = "high" | "medium" | "low";

// ── Search Result columns ────────────────────────────────────────────────

const SEARCH_COLUMNS = [
	"code",
	"id",
	"title",
	"context",
	"language",
	"scope",
	"tags",
	"confidence",
	"score",
	"matched_terms",
	"updated_at"
] as const;

// ── Scoring helpers ──────────────────────────────────────────────────────

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

/**
 * Recency score based on last_used_at or updated_at.
 * Exponential decay: score = e^(-age_days / 180) — half-life ≈ 125 days.
 */
function scoreRecency(standard: CodingStandardEntry): number {
	const dateStr = standard.last_used_at ?? standard.updated_at;
	if (!dateStr) return 0.5;
	const ageMs = Date.now() - new Date(dateStr).getTime();
	const ageDays = ageMs / (1000 * 60 * 60 * 24);
	return Math.max(0, Math.exp(-ageDays / 180));
}

/**
 * Domain score: how well the standard's domain metadata matches the request filters.
 * Neutral (0.5) when no filters are present.
 */
function scoreDomain(
	standard: CodingStandardEntry,
	filters: { stack?: string[]; tags?: string[]; language?: string; context?: string }
): number {
	let matches = 0;
	let total = 0;

	const normalizedCtx = filters.context?.toLowerCase();
	const stdContext = standard.context?.toLowerCase() ?? "";

	if (filters.stack && filters.stack.length > 0) {
		total++;
		if (filters.stack.some((s) => standard.stack.includes(s))) matches++;
	}
	if (filters.tags && filters.tags.length > 0) {
		total++;
		if (filters.tags.some((t) => standard.tags.includes(t))) matches++;
	}
	if (filters.language) {
		total++;
		if (standard.language === filters.language) matches++;
	}
	if (normalizedCtx) {
		total++;
		if (stdContext.includes(normalizedCtx)) matches++;
	}

	if (total === 0) return 0.5;
	return matches / total;
}

function toConfidence(finalScore: number, keywordScore: number): StandardConfidence {
	if (finalScore >= 0.72 || keywordScore >= 0.85) return "high";
	if (finalScore >= 0.42 || keywordScore >= 0.45) return "medium";
	return "low";
}

// ── Search handler ──────────────────────────────────────────────────────

export async function handleSearchMode(
	validated: StandardReadInput,
	db: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
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
		keywordScore: number;
		recencyScore: number;
		domainScore: number;
		matchedTerms: string[];
		finalScore: number;
		confidence: StandardConfidence;
	}> = [];

	const domainFilters = {
		stack: validated.stack,
		tags: validated.tags,
		language: validated.language,
		context: validated.context
	};

	try {
		const vectorResults = searchQuery
			? await vectors.search(searchQuery, similarityResults.length || validated.limit, validated.repo, "standard")
			: [];
		const vectorScoreMap = new Map(vectorResults.map((row) => [row.id, row.score]));

		if (similarityResults.length > 0) {
			scoredStandards = similarityResults.map((candidate) => {
				const simFromVector = vectorScoreMap.get(candidate.id) ?? 0;
				const keywordScore = scoreKeywordRelevance(validated.query || "", candidate);
				const matchedTerms = collectMatchedTerms(validated.query || "", candidate);
				const recencyScore = scoreRecency(candidate);
				const domainScoreVal = scoreDomain(candidate, domainFilters);
				const finalScore =
					candidate.similarity * HYBRID_WEIGHTS_SPEC001.similarity +
					simFromVector * 0 + // vector similarity already reflected in candidate.similarity
					keywordScore * HYBRID_WEIGHTS_SPEC001.keyword +
					recencyScore * HYBRID_WEIGHTS_SPEC001.recency +
					domainScoreVal * HYBRID_WEIGHTS_SPEC001.domain;
				return {
					standard: candidate,
					similarityScore: candidate.similarity,
					keywordScore,
					recencyScore,
					domainScore: domainScoreVal,
					matchedTerms,
					finalScore,
					confidence: toConfidence(finalScore, keywordScore)
				};
			});
		} else if (vectorResults.length > 0) {
			const fetched = db.standards.getByIds(vectorResults.map((row) => row.id));
			const standardMap = new Map(fetched.map((standard) => [standard.id, standard]));
			scoredStandards = vectorResults.flatMap((row) => {
				const standard = standardMap.get(row.id);
				if (!standard) return [];
				const keywordScore = scoreKeywordRelevance(validated.query || "", standard);
				const matchedTerms = collectMatchedTerms(validated.query || "", standard);
				const recencyScore = scoreRecency(standard);
				const domainScoreVal = scoreDomain(standard, domainFilters);
				const remainingWeight =
					1 - HYBRID_WEIGHTS_SPEC001.keyword - HYBRID_WEIGHTS_SPEC001.recency - HYBRID_WEIGHTS_SPEC001.domain;
				const finalScore =
					row.score * remainingWeight +
					keywordScore * HYBRID_WEIGHTS_SPEC001.keyword +
					recencyScore * HYBRID_WEIGHTS_SPEC001.recency +
					domainScoreVal * HYBRID_WEIGHTS_SPEC001.domain;
				return [
					{
						standard,
						similarityScore: 0,
						keywordScore,
						recencyScore,
						domainScore: domainScoreVal,
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
			const recencyScore = scoreRecency(candidate);
			const domainScoreVal = scoreDomain(candidate, domainFilters);
			const finalScore =
				candidate.similarity * HYBRID_WEIGHTS_SPEC001.similarity +
				keywordScore * HYBRID_WEIGHTS_SPEC001.keyword +
				recencyScore * HYBRID_WEIGHTS_SPEC001.recency +
				domainScoreVal * HYBRID_WEIGHTS_SPEC001.domain;
			return {
				standard: candidate,
				similarityScore: candidate.similarity,
				keywordScore,
				recencyScore,
				domainScore: domainScoreVal,
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
	// NOTE: hit_count intentionally NOT incremented on read/search

	logger.info("[Tool] standard-read - searched coding standards", {
		resultCount: paginatedResults.length,
		stack: validated.stack,
		language: validated.language,
		context: validated.context,
		version: validated.version,
		topConfidence: paginatedResults[0]?.confidence
	});

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
			"### Standards",
			"",
			"| code | confidence | matched_terms | title | context | language | scope |",
			"|------|------------|---------------|-------|---------|----------|-------|",
			...paginatedResults.map(
				({ standard, confidence, matchedTerms }) =>
					`| ${standard.code ?? "-"} | ${confidence} | ${matchedTerms.join(", ")} | ${standard.title} | ${standard.context} | ${standard.language || "-"} | ${
						standard.is_global ? "global" : standard.repo || "-"
					} |`
			),
			"",
			"Use standard-read with code for full content."
		];
		contentSummary = parts.join("\n");
	} else {
		contentSummary = "No matching coding standards found.";
	}

	const responseData: Record<string, unknown> = {
		schema: "standard-read",
		mode: "search",
		query: validated.query || "",
		count: paginatedResults.length,
		total: results.length,
		offset: validated.offset,
		limit: validated.limit,
		results: {
			columns: [...SEARCH_COLUMNS],
			rows
		}
	};

	// Best-effort KG context (REFACTOR-KG-005)
	if (paginatedResults.length > 0) {
		const kgData = fetchAggregatedKgContext(
			db,
			validated.repo ?? "",
			paginatedResults.map((r) => r.standard.title),
			"standard"
		);
		if (kgData) responseData.kg = kgData;
	}

	return createMcpResponse(responseData, `Found ${results.length} coding standards matching your query`, {
		contentSummary,
		structuredContentPathHint: "results",
		includeJson: true
	});
}
