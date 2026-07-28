import { StandardReadSchema, StandardReadInput } from "./schemas/standard.read";
import { SQLiteStore } from "../storage/sqlite";
import { CodingStandardEntry, VectorStore } from "../types";
import { logger } from "../utils/logger";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";
import { expandQuery } from "../utils/query-expander";
import { UUID_REGEX } from "../utils/uuid";

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

// ── Helpers ──────────────────────────────────────────────────────────────

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

const LIST_COLUMNS = ["code", "id", "title", "context", "language", "scope", "tags", "version", "updated_at"] as const;

// ── KG Context Types & Helpers ──────────────────────────────────────────

interface KgEntityResult {
	name: string;
	type: string;
	source_domain: string;
}

interface KgRelationResult {
	from: string;
	to: string;
	type: string;
}

interface KgResult {
	entities: KgEntityResult[];
	relations: KgRelationResult[];
}

/**
 * Query entities + relations for a given set of entity names.
 * Best-effort — never throws.
 */
function kgQuery(db: SQLiteStore, repo: string, entityNames: string[], sourceDomain: string): KgResult | null {
	try {
		if (entityNames.length === 0) return { entities: [], relations: [] };

		const uniqueNames = [...new Set(entityNames)];
		const placeholders = uniqueNames.map(() => "?").join(",");

		const entities = db.db
			.prepare<unknown[], KgEntityResult>(
				`SELECT name, type, ? AS source_domain FROM entities WHERE name IN (${placeholders}) AND repo = ?`
			)
			.all(sourceDomain, ...uniqueNames, repo) as KgEntityResult[];

		const relations = db.db
			.prepare<unknown[], KgRelationResult>(
				`SELECT from_entity AS "from", to_entity AS "to", relation_type AS type
				 FROM relations WHERE (from_entity IN (${placeholders}) OR to_entity IN (${placeholders})) AND repo = ?`
			)
			.all(...uniqueNames, ...uniqueNames, repo) as KgRelationResult[];

		return { entities, relations };
	} catch (error) {
		logger.warn("[Standard.Read] KG query failed", { error: String(error), repo });
		return null;
	}
}

/**
 * Fetch KG entities + relations related to a standard by matching
 * observation text `"Mentioned in standard: {title}"`.
 */
function fetchKgContext(db: SQLiteStore, repo: string | undefined, standardTitle: string): KgResult | null {
	try {
		const entityRows = db.db
			.prepare<unknown[], { entity_name: string }>(
				`SELECT DISTINCT entity_name FROM observations WHERE observation = ? AND repo = ?`
			)
			.all(`Mentioned in standard: ${standardTitle}`, repo) as { entity_name: string }[];

		if (entityRows.length === 0) return { entities: [], relations: [] };

		return kgQuery(
			db,
			repo ?? "",
			entityRows.map((r) => r.entity_name),
			"standard"
		);
	} catch (error) {
		logger.warn("[Standard.Read] KG context fetch failed", { error: String(error), title: standardTitle });
		return null;
	}
}

/**
 * Aggregate KG context across multiple standard titles.
 */
function fetchAggregatedKgContext(db: SQLiteStore, repo: string | undefined, titles: string[]): KgResult | null {
	try {
		if (titles.length === 0) return { entities: [], relations: [] };

		const patterns = titles.map((t) => `Mentioned in standard: ${t}`);
		const patternPlaceholders = patterns.map(() => "?").join(",");

		const entityRows = db.db
			.prepare<unknown[], { entity_name: string }>(
				`SELECT DISTINCT entity_name FROM observations WHERE observation IN (${patternPlaceholders}) AND repo = ?`
			)
			.all(...patterns, repo) as { entity_name: string }[];

		if (entityRows.length === 0) return { entities: [], relations: [] };

		return kgQuery(db, repo ?? "", [...new Set(entityRows.map((r) => r.entity_name))], "standard");
	} catch (error) {
		logger.warn("[Standard.Read] Aggregated KG context fetch failed", {
			error: String(error),
			count: titles.length
		});
		return null;
	}
}

// ── Mode handlers ────────────────────────────────────────────────────────

async function handleSearchMode(
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
			validated.repo,
			paginatedResults.map((r) => r.standard.title)
		);
		if (kgData) responseData.kg = kgData;
	}

	return createMcpResponse(responseData, `Found ${results.length} coding standards matching your query`, {
		contentSummary,
		structuredContentPathHint: "results",
		includeJson: true
	});
}

async function handleDetailMode(validated: StandardReadInput, db: SQLiteStore): Promise<McpResponse> {
	const { id, code, ids, codes, owner, repo } = validated;

	// Bulk by IDs
	if (ids && ids.length > 0) {
		const standards = db.standards.getByIds(ids);
		// NOTE: hit_count intentionally NOT incremented on read

		const lines =
			standards.length > 0 ? `Found ${standards.length} standards by IDs` : "No standards found for the given IDs";

		const kgContext = fetchAggregatedKgContext(
			db,
			repo,
			standards.map((s) => s.title)
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
			repo,
			standards.map((s) => s.title)
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

	const kgContext = fetchKgContext(db, repo, standard.title);
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

async function handleListMode(validated: StandardReadInput, db: SQLiteStore): Promise<McpResponse> {
	const filterParams: Record<string, unknown> = {};

	if (validated.context) filterParams.context = validated.context;
	if (validated.version) filterParams.version = validated.version;
	if (validated.language) filterParams.language = validated.language;
	if (validated.stack && validated.stack.length > 0) filterParams.stack = validated.stack[0];
	if (validated.tags && validated.tags.length > 0) filterParams.tag = validated.tags[0];
	if (validated.repo) filterParams.repo = validated.repo;
	if (validated.is_global !== undefined) filterParams.is_global = validated.is_global;

	const standards = db.standards.search({
		...filterParams,
		limit: validated.limit,
		offset: validated.offset
	} as Parameters<typeof db.standards.search>[0]);

	const rows = standards.map((s) => [
		s.code ?? "-",
		s.id,
		s.title,
		s.context,
		s.language || "-",
		s.is_global ? "global" : s.repo || "-",
		s.tags.join(", "),
		s.version,
		s.updated_at
	]);

	const contentSummary =
		standards.length > 0 ? `Listed ${standards.length} coding standards` : "No coding standards found.";

	logger.info("[Tool] standard-read - listed coding standards", {
		resultCount: standards.length
	});

	const responseData: Record<string, unknown> = {
		schema: "standard-read",
		mode: "list",
		standards: {
			columns: [...LIST_COLUMNS],
			rows
		},
		count: standards.length,
		offset: validated.offset
	};

	// Best-effort KG context (REFACTOR-KG-005)
	if (standards.length > 0) {
		const kgData = fetchAggregatedKgContext(
			db,
			validated.repo,
			standards.map((s) => s.title)
		);
		if (kgData) responseData.kg = kgData;
	}

	return createMcpResponse(responseData, contentSummary, {
		contentSummary,
		structuredContentPathHint: "standards",
		includeJson: true
	});
}

// ── Main entry point ─────────────────────────────────────────────────────

/**
 * Unified standard-read handler.
 *
 * Auto-infer logic:
 * - `query` present → SEARCH  (hybrid scoring per SPEC-001)
 * - `id`/`code`/`ids`/`codes` → DETAIL (single or bulk)
 * - none                    → LIST   (paginated list of all standards)
 */
export async function handleStandardRead(
	params: Record<string, unknown>,
	db: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	const validated = StandardReadSchema.parse(params);

	// Auto-infer mode
	if (validated.query) {
		return handleSearchMode(validated, db, vectors);
	}
	if (
		validated.id !== undefined ||
		validated.code !== undefined ||
		validated.ids !== undefined ||
		validated.codes !== undefined
	) {
		return handleDetailMode(validated, db);
	}
	return handleListMode(validated, db);
}
