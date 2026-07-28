/**
 * memory.read — Unified memory-read handler
 *
 * Replaces 3 existing tools (memory-search, memory-detail, memory-recap)
 * with a single handler that auto-infers mode from parameter presence:
 *
 *   query present         → SEARCH  (hybrid vector + keyword scoring)
 *   id/code/ids/codes     → DETAIL  (full MemoryEntry, single or bulk)
 *   none of the above     → RECAP   (stats + top memories)
 *
 * SPEC-001 hybrid scoring: 0.40 similarity + 0.30 keyword + 0.15 recency + 0.15 domain
 * No hit_count increments on read.
 */

import { MemoryReadSchema } from "./schemas";
import type { MemoryEntry, VectorStore } from "../types";
import type { SQLiteStore } from "../storage/sqlite";
import type { McpResponse } from "../utils/mcp-response";
import { createMcpResponse } from "../utils/mcp-response";
import { logger } from "../utils/logger";
import { expandQuery } from "../utils/query-expander";
import { parseRelativeDate, TimeTunnelResult } from "./time-tunnel";
import { kgQuery, fetchKgContext, fetchAggregatedKgContext } from "./kg-archivist/query";

// ── Types ───────────────────────────────────────────────────────────────

type MemoryReadParams = {
	query?: string;
	id?: string;
	code?: string;
	ids?: string[];
	codes?: string[];
	owner?: string;
	repo: string;
	current_tags?: string[];
	current_file_path?: string;
	scope?: { owner?: string; repo?: string; branch?: string; folder?: string; language?: string };
	include_archived: boolean;
	limit: number;
	offset: number;
	json: boolean;
};

// ── Constants ───────────────────────────────────────────────────────────

const SEARCH_COLUMNS = ["id", "code", "title", "type", "importance"] as const;
const TOP_COLUMNS = ["id", "code", "title", "type", "importance"] as const;

const HYBRID_WEIGHTS = {
	similarity: 0.4,
	keyword: 0.3,
	recency: 0.15,
	domain: 0.15
} as const;

const RECENCY_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;

// ── Helpers ─────────────────────────────────────────────────────────────

function capitalize(str: string): string {
	return str.charAt(0).toUpperCase() + str.slice(1);
}

function computeRecencyScore(createdAt: string): number {
	const ageMs = Date.now() - new Date(createdAt).getTime();
	if (ageMs <= 0) return 1;
	return Math.max(0, Math.min(1, Math.pow(2, -ageMs / RECENCY_HALF_LIFE_MS)));
}

function computeDomainScore(memory: MemoryEntry, queryTerms: string[]): number {
	if (queryTerms.length === 0 || memory.tags.length === 0) return 0;
	const querySet = new Set(queryTerms.map((t: string) => t.toLowerCase()));
	const matches = memory.tags.filter((t: string) => querySet.has(t.toLowerCase())).length;
	return matches / Math.max(memory.tags.length, 1);
}

function applyTimeFilter(memories: MemoryEntry[], tunnel: TimeTunnelResult): MemoryEntry[] {
	const sinceMs = tunnel.since ? new Date(tunnel.since).getTime() : 0;
	const untilMs = tunnel.until ? new Date(tunnel.until).getTime() : Infinity;
	return memories.filter((m: MemoryEntry) => {
		const createdAtMs = new Date(m.created_at).getTime();
		if (sinceMs > 0 && createdAtMs < sinceMs) return false;
		if (untilMs < Infinity && createdAtMs >= untilMs) return false;
		return true;
	});
}

function buildGroupedTable(rows: MemoryEntry[]): string {
	const byType: Record<string, MemoryEntry[]> = {};
	for (const m of rows) {
		const t = m.type || "unknown";
		if (!byType[t]) byType[t] = [];
		byType[t].push(m);
	}
	const parts: string[] = [];
	for (const [memType, items] of Object.entries(byType)) {
		parts.push(`### ${capitalize(memType)}`, "");
		parts.push("| code | importance | title |", "|------|------------|-------|");
		for (const m of items) {
			parts.push(`| ${m.code || "-"} | ${m.importance} | ${m.title} |`);
		}
		parts.push("");
	}
	return parts.join("\n").trim();
}

// =====================================================================
//  MAIN HANDLER — Auto-infer mode from params
// =====================================================================

export async function handleMemoryRead(params: unknown, db: SQLiteStore, vectors: VectorStore): Promise<McpResponse> {
	const validated = MemoryReadSchema.parse(params) as MemoryReadParams;
	const { query, id, code, ids, codes } = validated;

	if (query !== undefined) {
		return handleSearch(validated, db, vectors);
	}
	if (id !== undefined || code !== undefined || ids !== undefined || codes !== undefined) {
		return handleDetail(validated, db);
	}
	return handleRecap(validated, db);
}

// =====================================================================
//  SEARCH MODE — Hybrid vector + keyword + recency + domain scoring
// =====================================================================

async function handleSearch(params: MemoryReadParams, db: SQLiteStore, vectors: VectorStore): Promise<McpResponse> {
	const query = params.query!;

	// Time Tunnel: extract relative date phrases
	const timeTunnel = parseRelativeDate(query);
	const effectiveQuery = timeTunnel ? timeTunnel.cleanedQuery : query;
	const searchQuery = expandQuery(effectiveQuery);

	// 1. Get candidates from SQLite similarity
	const fetchLimit = (params.offset + params.limit) * 3;
	const similarityResults = db.memoryVectors.searchBySimilarity(
		searchQuery,
		params.owner!,
		params.repo,
		fetchLimit,
		params.include_archived,
		params.current_tags ?? []
	);

	interface Candidate {
		memory: MemoryEntry;
		similarityScore: number;
	}

	let candidates: Candidate[] = similarityResults.map((r: MemoryEntry & { similarity: number }) => ({
		memory: r as MemoryEntry,
		similarityScore: r.similarity
	}));

	// 2. Workspace & Tag Affinity Boost
	if (candidates.length > 0) {
		const currentPath = params.current_file_path?.toLowerCase();
		const currentTags = (params.current_tags || []).map((tag: string) => tag.toLowerCase());
		const currentBranch = params.scope?.branch;

		candidates = candidates.map((c: Candidate) => {
			let boost = 0;
			if (currentBranch && c.memory.scope.branch === currentBranch) boost += 0.1;
			if (currentPath && c.memory.scope.folder && currentPath.includes(c.memory.scope.folder.toLowerCase()))
				boost += 0.15;
			if (currentPath && c.memory.scope.language) {
				const ext = currentPath.split(".").pop();
				if (ext && ext.includes(c.memory.scope.language.toLowerCase())) boost += 0.1;
			}
			if (currentTags.length > 0 && c.memory.tags.some((tag: string) => currentTags.includes(tag.toLowerCase())))
				boost += 0.2;
			return { ...c, similarityScore: Math.min(1.0, c.similarityScore + boost) };
		});
	}

	// 3. Vector re-ranking (keyword)
	interface ScoredMemory {
		memory: MemoryEntry;
		similarityScore: number;
		keywordScore: number;
		recencyScore: number;
		domainScore: number;
		finalScore: number;
	}

	const queryTerms = searchQuery.split(/\s+/).filter(Boolean);
	let scoredMemories: ScoredMemory[] = [];

	try {
		const vectorResults = await vectors.search(searchQuery, candidates.length || 10, params.repo);
		const vectorScoreMap = new Map(vectorResults.map((vr) => [vr.id, vr.score]));

		if (candidates.length > 0) {
			scoredMemories = candidates.map((c: Candidate) => {
				const keywordScore = vectorScoreMap.get(c.memory.id) ?? 0;
				const recencyScore = computeRecencyScore(c.memory.created_at);
				const domainScore = computeDomainScore(c.memory, queryTerms);
				const finalScore =
					c.similarityScore * HYBRID_WEIGHTS.similarity +
					keywordScore * HYBRID_WEIGHTS.keyword +
					recencyScore * HYBRID_WEIGHTS.recency +
					domainScore * HYBRID_WEIGHTS.domain;
				return {
					memory: c.memory,
					similarityScore: c.similarityScore,
					keywordScore,
					recencyScore,
					domainScore,
					finalScore
				};
			});
		} else if (vectorResults.length > 0) {
			const memoryMap = new Map(
				db.memories.getByIds(vectorResults.map((vr) => vr.id)).map((m: MemoryEntry) => [m.id, m])
			);
			for (const vr of vectorResults) {
				const mem = memoryMap.get(vr.id);
				if (mem) {
					const recencyScore = computeRecencyScore(mem.created_at);
					const domainScore = computeDomainScore(mem, queryTerms);
					scoredMemories.push({
						memory: mem,
						similarityScore: 0,
						keywordScore: vr.score,
						recencyScore,
						domainScore,
						finalScore:
							vr.score * (HYBRID_WEIGHTS.keyword + HYBRID_WEIGHTS.similarity) +
							recencyScore * HYBRID_WEIGHTS.recency +
							domainScore * HYBRID_WEIGHTS.domain
					});
				}
			}
		}
	} catch (error) {
		logger.warn("Vector search failed, using similarity only", { error: String(error) });
		scoredMemories = candidates.map((c: Candidate) => {
			const recencyScore = computeRecencyScore(c.memory.created_at);
			const domainScore = computeDomainScore(c.memory, queryTerms);
			return {
				memory: c.memory,
				similarityScore: c.similarityScore,
				keywordScore: 0,
				recencyScore,
				domainScore,
				finalScore:
					c.similarityScore * (HYBRID_WEIGHTS.similarity + HYBRID_WEIGHTS.keyword) +
					recencyScore * HYBRID_WEIGHTS.recency +
					domainScore * HYBRID_WEIGHTS.domain
			};
		});
	}

	// 4. Threshold & Final Selection
	scoredMemories.sort((a: ScoredMemory, b: ScoredMemory) => b.finalScore - a.finalScore);
	const threshold = scoredMemories.length <= 5 ? 0.1 : 0.4;
	let allMatches = scoredMemories
		.filter((sm: ScoredMemory) => sm.finalScore >= threshold)
		.map((sm: ScoredMemory) => sm.memory);
	if (allMatches.length === 0 && scoredMemories.length > 0) allMatches = [scoredMemories[0].memory];

	// 4a. Time Tunnel post-filter
	if (timeTunnel) {
		allMatches = applyTimeFilter(allMatches, timeTunnel);
	}

	const total = allMatches.length;
	const paginatedResults = allMatches.slice(params.offset, params.offset + params.limit);

	// CRITICAL: No hit_count increment on search

	logger.info("[Tool] memory.read (search)", {
		repo: params.repo,
		query: params.query,
		total,
		offset: params.offset,
		returned: paginatedResults.length
	});

	// 5. Prepare Output
	const rows = paginatedResults.map((m: MemoryEntry) => [
		m.id,
		m.code || "-",
		m.title ?? "Untitled",
		m.type,
		m.importance
	]);

	let contentSummary: string;
	if (paginatedResults.length > 0) {
		const grouped = buildGroupedTable(paginatedResults);
		contentSummary = grouped + "\n\nUse memory-read with id (or code) for full content.";
	} else {
		contentSummary = `No memories found for "${params.query}" in repo "${params.repo}".`;
	}

	const structuredData: Record<string, unknown> = {
		columns: [...SEARCH_COLUMNS],
		rows,
		count: paginatedResults.length,
		total,
		offset: params.offset,
		limit: params.limit
	};

	// Best-effort KG context (REFACTOR-KG-003)
	if (paginatedResults.length > 0) {
		const kgData = fetchAggregatedKgContext(
			db,
			params.repo,
			paginatedResults.map((m: MemoryEntry) => m.title),
			"memory"
		);
		if (kgData) structuredData.kg = kgData;
	}

	return createMcpResponse(structuredData, contentSummary, {
		contentSummary,
		structuredContentPathHint: "rows",
		includeJson: params.json
	});
}

// =====================================================================
//  GET DETAIL MODE — single or bulk by id/code
// =====================================================================

async function handleDetail(params: MemoryReadParams, db: SQLiteStore): Promise<McpResponse> {
	const { id, code, ids, codes, owner, repo } = params;

	// Bulk detail via ids array
	if (ids !== undefined && ids.length > 0) {
		const memories = db.memories.getByIds(ids);
		const contentSummary =
			memories.length > 0 ? `Found ${memories.length} memory/memories by ids.` : "No memories found for given ids.";
		const kgContext = fetchAggregatedKgContext(
			db,
			repo,
			memories.map((m: MemoryEntry) => m.title),
			"memory"
		);
		const data: Record<string, unknown> = { memories };
		if (kgContext) data.kg = kgContext;
		return createMcpResponse(data, contentSummary, {
			contentSummary,
			includeJson: params.json
		});
	}

	// Bulk detail via codes array
	if (codes !== undefined && codes.length > 0) {
		const memories: MemoryEntry[] = codes
			.map((c: string) => db.memories.getByCode(c, owner, repo))
			.filter((m: MemoryEntry | null): m is MemoryEntry => m !== null);
		const contentSummary =
			memories.length > 0 ? `Found ${memories.length} memory/memories by codes.` : "No memories found for given codes.";
		const kgContext = fetchAggregatedKgContext(
			db,
			repo,
			memories.map((m: MemoryEntry) => m.title),
			"memory"
		);
		const data: Record<string, unknown> = { memories };
		if (kgContext) data.kg = kgContext;
		return createMcpResponse(data, contentSummary, {
			contentSummary,
			includeJson: params.json
		});
	}

	// Single detail by id or code
	let memory: MemoryEntry | null = null;
	if (id) {
		memory = db.memories.getById(id) ?? db.memories.getByCode(id, owner, repo);
	} else if (code) {
		memory = db.memories.getByCode(code, owner, repo);
	}

	if (!memory) {
		throw new Error(`Memory not found: ${id || code}`);
	}

	const lines: string[] = [
		`Code: ${memory.code || "-"}`,
		`ID: ${memory.id}`,
		`Title: ${memory.title}`,
		`Type: ${memory.type}`,
		`Importance: ${memory.importance}`,
		`Created: ${memory.created_at}`
	];
	if (memory.scope?.repo) lines.push(`Repo: ${memory.scope.repo}`);
	if (memory.scope?.folder) lines.push(`Folder: ${memory.scope.folder}`);
	if (memory.content) lines.push("", "--- Content ---", memory.content);

	const content = lines.join("\n");

	const kgContext = fetchKgContext(db, repo, memory.title, "memory");
	const data: Record<string, unknown> = { memory };
	if (kgContext) data.kg = kgContext;

	return createMcpResponse(data, content, {
		contentSummary: content,
		includeJson: params.json
	});
}

// =====================================================================
//  RECAP MODE — stats + top memories
// =====================================================================

async function handleRecap(params: MemoryReadParams, db: SQLiteStore): Promise<McpResponse> {
	// Recap uses its own limit cap (1-50)
	const recapLimit = Math.min(params.limit, 50);

	logger.info("[Tool] memory.read (recap)", { repo: params.repo, limit: recapLimit, offset: params.offset });

	// Aggregate stats (counts by type)
	const stats = db.memories.getStats(params.owner!, params.repo);

	// Total active memories (excluding task_archive)
	const total = db.memories.getTotalCount(params.owner!, params.repo, false, ["task_archive"]);

	// Top memories ordered by importance DESC, created_at DESC
	const rows = db.memories.getRecentMemories(params.owner!, params.repo, recapLimit, params.offset, false, [
		"task_archive"
	]);

	// by_type excluding task_archive
	const byType: Record<string, number> = {};
	for (const [type, count] of Object.entries(stats.byType)) {
		if (type !== "task_archive") {
			byType[type] = count;
		}
	}

	// Build pointer table
	const topRows = rows.map((row: MemoryEntry) => [
		row.id,
		row.code || "-",
		row.title ?? "Untitled",
		row.type,
		row.importance
	]);

	let contentSummary: string;
	if (total > 0) {
		const parts: string[] = [];

		// Stats by type
		for (const [memType, count] of Object.entries(byType)) {
			if (count > 0) {
				parts.push(`${capitalize(memType)}: ${count}`);
			}
		}
		parts.push("");

		// Grouped table
		const grouped = buildGroupedTable(rows);
		if (grouped) parts.push(grouped);

		parts.push("Use memory-read with id (or code) for full content.");
		contentSummary = parts.join("\n").trim();
	} else {
		contentSummary = `No memories found for repo "${params.repo}".`;
	}

	const structuredData: Record<string, unknown> = {
		stats: { byType },
		top: {
			columns: [...TOP_COLUMNS],
			rows: topRows
		},
		count: rows.length,
		total,
		offset: params.offset,
		limit: recapLimit
	};

	// Best-effort KG context (REFACTOR-KG-003)
	if (rows.length > 0) {
		const kgData = fetchAggregatedKgContext(
			db,
			params.repo,
			rows.map((m: MemoryEntry) => m.title),
			"memory"
		);
		if (kgData) structuredData.kg = kgData;
	}

	return createMcpResponse(structuredData, contentSummary, {
		contentSummary,
		includeJson: params.json
	});
}
