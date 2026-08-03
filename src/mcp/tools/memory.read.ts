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

import { MemoryReadSchema, type MemoryReadInput } from "./schemas";
import type { MemoryEntry, VectorStore, VectorResult } from "../types";
import type { SQLiteStore } from "../storage/sqlite";
import type { McpResponse } from "../utils/mcp-response";
import { buildTableResult, createMcpResponse } from "../utils/mcp-response";
import { parseArgs } from "../utils/mcp-error";
import { inferReadMode } from "../utils/auto-infer";
import { logger } from "../utils/logger";
import { UUID_REGEX } from "../utils/uuid";
import { expandQuery } from "../utils/query-expander";
import { parseRelativeDate, TimeTunnelResult } from "./time-tunnel";
import { fetchKgContext, fetchAggregatedKgContext } from "./kg-archivist/query";
import { MEMORY_SCORING } from "../utils/scoring";
import { HybridSearchEngine } from "../utils/hybrid-search";
import { SEARCH_THRESHOLDS } from "../utils/constants";
import { renderGroupedSummary, enumOrderComparator } from "../utils/summary";
import { FTS_CANDIDATE_CAP } from "../utils/fts";

// ── Types ───────────────────────────────────────────────────────────────

// Derived from the Zod schema (OPT-CODE-03) — the hand-written interface was a
// drift-prone duplicate (owner was optional here but required in the schema)
// that forced `Schema.parse(...) as MemoryReadParams`. `owner` is required by
// the schema (normalizeToolArguments injects it), so the old `params.owner!`
// assertions below are now plain property accesses.
type MemoryReadParams = MemoryReadInput;

// ── Constants ───────────────────────────────────────────────────────────

const SEARCH_COLUMNS = ["id", "code", "title", "type", "importance"] as const;
const TOP_COLUMNS = ["id", "code", "title", "type", "importance"] as const;
const TYPE_ORDER = ["code_fact", "decision", "mistake", "pattern", "task_archive"];

// ── Helpers ─────────────────────────────────────────────────────────────

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

// =====================================================================
//  MAIN HANDLER — Auto-infer mode from params
// =====================================================================

export async function handleMemoryRead(params: unknown, db: SQLiteStore, vectors: VectorStore): Promise<McpResponse> {
	// Centralized validation (OPT-CODE-01): throws the friendly owner/repo-aware
	// message instead of a raw ZodError; transport catch → toErrorResponse.
	const validated = parseArgs(MemoryReadSchema, params);

	// Auto-infer mode from field presence via the shared helper (OPT-DRY-06):
	//   query → SEARCH · id/code/ids/codes → DETAIL · none → RECAP
	const mode = inferReadMode(validated, {
		rules: [
			{ mode: "search", fields: ["query"] },
			{ mode: "detail", fields: ["id", "code", "ids", "codes"] }
		],
		fallback: "recap"
	});

	switch (mode) {
		case "search":
			return handleSearch(validated, db, vectors);
		case "detail":
			return handleDetail(validated, db);
		default:
			return handleRecap(validated, db);
	}
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
		params.owner,
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

	// 1a. FTS bm25 keyword signal (MEM-367 §6) — feeds the 0.30 keyword
	// hybrid weight with real lexical relevance instead of the ONNX rerank.
	// Uses the post-time-tunnel query (NOT the expanded one — injected
	// synonyms would wrongly restrict lexical matches). Raw bm25() is unitless
	// and non-positive (most negative = best); min-max normalization over the
	// top-k set maps best → 1.0, worst → ≈0 (self-contained per query, no
	// calibration drift). FTS-only hits are merged in as extra candidates
	// (similarity 0) so token-initial lexical recall surfaces even when vector
	// similarity misses. Any FTS failure only disables the bm25 feed — the
	// vector/similarity pipeline below is unaffected.
	const ftsScoreMap = new Map<string, number>();
	try {
		const ftsScored = db.memories.searchByFtsScored(effectiveQuery, params.owner, params.repo, {
			limit: FTS_CANDIDATE_CAP,
			includeArchived: params.include_archived
		});
		if (ftsScored.length > 0) {
			let minB = Number.POSITIVE_INFINITY;
			let maxB = Number.NEGATIVE_INFINITY;
			for (const r of ftsScored) {
				if (r.bm25 < minB) minB = r.bm25;
				if (r.bm25 > maxB) maxB = r.bm25;
			}
			const range = maxB - minB;
			for (const r of ftsScored) {
				const normalized = range === 0 ? 1.0 : 1 - (r.bm25 - minB) / range;
				ftsScoreMap.set(r.memory.id, normalized);
			}
			const knownIds = new Set(candidates.map((c) => c.memory.id));
			for (const r of ftsScored) {
				if (!knownIds.has(r.memory.id)) {
					knownIds.add(r.memory.id);
					candidates.push({ memory: r.memory, similarityScore: 0 });
				}
			}
		}
	} catch (error) {
		logger.warn("FTS keyword search failed, using vector keyword only", { error: String(error) });
	}

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

	// 3. Hybrid scoring through the shared engine (OPT-DRY-01). The engine
	// owns vector+keyword merge, sort by composite score, threshold,
	// guarantee-at-least-1, the time-tunnel post-filter, and pagination.
	// This file keeps ONLY the candidate fetch + domain/recency signal
	// computation (EntityScorer below).
	const queryTerms = searchQuery.split(/\s+/).filter(Boolean);

	// Vector re-rank only matters when the candidate pool is empty (vector-only
	// fallback). Skip the inference when similarity/FTS produced candidates —
	// its result would be discarded anyway, so this saves one full inference
	// per search (mirrors standard-read's needsVectorFallback).
	let vectorResults: VectorResult[] | null;
	let vectorEntities: ReadonlyMap<string, MemoryEntry> = new Map();
	if (candidates.length === 0) {
		try {
			vectorResults = await vectors.search(searchQuery, 10, params.repo);
			if (vectorResults.length > 0) {
				const fetched = db.memories.getByIds(vectorResults.map((vr) => vr.id));
				vectorEntities = new Map(fetched.map((m: MemoryEntry) => [m.id, m]));
			}
		} catch (error) {
			logger.warn("Vector search failed, using similarity only", { error: String(error) });
			vectorResults = null;
		}
	} else {
		vectorResults = [];
	}

	const { items: scoredResult, total } = HybridSearchEngine.run<MemoryEntry>({
		candidates: candidates.map((c: Candidate) => ({ entity: c.memory, similarity: c.similarityScore })),
		queryTerms,
		vectorResults,
		vectorEntities,
		scorer: {
			idOf: (memory) => memory.id,
			scoreCandidate: (memory, similarity, terms) => ({
				// bm25 (min-max normalized) feeds the 0.30 keyword weight
				// (MEM-367 §6.2): lexical relevance, not vector rerank, powers
				// the keyword signal.
				similarity,
				keyword: ftsScoreMap.get(memory.id) ?? 0,
				recency: MEMORY_SCORING.recency(memory),
				domain: MEMORY_SCORING.domain(memory, { queryTerms: terms })
			}),
			scoreVectorOnly: (memory, hit, terms) => ({
				similarity: hit.score,
				keyword: 0,
				recency: MEMORY_SCORING.recency(memory),
				domain: MEMORY_SCORING.domain(memory, { queryTerms: terms })
			}),
			scoreFallback: (memory, similarity, terms) => ({
				similarity,
				keyword: ftsScoreMap.get(memory.id) ?? 0,
				recency: MEMORY_SCORING.recency(memory),
				domain: MEMORY_SCORING.domain(memory, { queryTerms: terms })
			})
		},
		thresholds: SEARCH_THRESHOLDS.memory,
		merge: "fallback",
		offset: params.offset,
		limit: params.limit,
		// 4a. Time Tunnel post-filter (window check on created_at), applied
		// after threshold/guarantee and before pagination.
		postFilter: (eligible) => {
			if (!timeTunnel) return eligible;
			const kept = applyTimeFilter(
				eligible.map((s) => s.entity),
				timeTunnel
			);
			const keptIds = new Set(kept.map((m: MemoryEntry) => m.id));
			return eligible.filter((s) => keptIds.has(s.entity.id));
		}
	});

	const paginatedResults = scoredResult.map((s) => s.entity);

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
		const parts: string[] = [];

		// Header: query + pagination
		parts.push(`### Results: ${total} memories for "${params.query}" (showing ${paginatedResults.length})`);
		parts.push("");

		// Fused grouped by type (enum order), with global rank #N
		parts.push(
			renderGroupedSummary<MemoryEntry>({
				items: paginatedResults,
				getGroup: (m) => m.type || "unknown",
				groupOrder: enumOrderComparator(TYPE_ORDER),
				cap: (key) => (key === "task_archive" ? 2 : 5),
				formatLine: (m, rank) => `#${rank} ${m.code || "-"} [${m.importance}] ${m.title}`,
				footer: "Use memory-read with id (or code) for full content."
			})
		);
		contentSummary = parts.join("\n");
	} else {
		contentSummary = `No memories found for "${params.query}" in repo "${params.repo}".`;
	}

	const structuredData = buildTableResult(SEARCH_COLUMNS, rows, {
		count: paginatedResults.length,
		total,
		offset: params.offset,
		limit: params.limit
	});

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

// ── Helpers ─────────────────────────────────────────────────────────────

function formatMemoryDetail(memory: MemoryEntry, showId?: boolean): string {
	const lines: string[] = [`Code: ${memory.code || "-"}`];
	if (showId) lines.push(`ID: ${memory.id}`);
	lines.push(
		`Title: ${memory.title}`,
		`Type: ${memory.type}`,
		`Importance: ${memory.importance}`,
		`Status: ${memory.status}`,
		`Tags: ${memory.tags.length > 0 ? memory.tags.join(", ") : "-"}`,
		`Created: ${memory.created_at}`,
		`Updated: ${memory.updated_at}`
	);
	if (memory.scope?.repo) lines.push(`Repo: ${memory.scope.repo}`);
	if (memory.scope?.folder) lines.push(`Folder: ${memory.scope.folder}`);
	if (memory.scope?.language) lines.push(`Language: ${memory.scope.language}`);
	if (memory.content) lines.push("", "--- Content ---", memory.content);
	return lines.join("\n");
}

function formatBulkDetail(memories: MemoryEntry[]): string {
	const SEPARATOR = "━".repeat(44);
	const parts = memories.map((m) => SEPARATOR + "\n" + formatMemoryDetail(m, true));
	return `Bulk detail — ${memories.length} memories\n\n${parts.join("\n")}\n\nUse memory-read with id (or code) for full content.`;
}

// =====================================================================
//  GET DETAIL MODE — single or bulk by id/code
// =====================================================================

async function handleDetail(params: MemoryReadParams, db: SQLiteStore): Promise<McpResponse> {
	const { id, code, ids, codes, owner, repo } = params;

	// Bulk detail via ids array
	if (ids !== undefined && ids.length > 0) {
		const memories = db.memories.getByIds(ids);
		const contentSummary = memories.length > 0 ? formatBulkDetail(memories) : "No memories found for given ids.";
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
		const memories = db.memories.getMemoriesByCodes(codes, owner, repo);
		const contentSummary = memories.length > 0 ? formatBulkDetail(memories) : "No memories found for given codes.";
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

	// Single detail by id or code. Branch on UUID shape so a code-addressed
	// lookup runs EXACTLY one query (getById for ids, getByCode for codes) —
	// the old `getById(id) ?? getByCode(id, ...)` burned two queries whenever
	// a code was passed through `id` (OPT-FLOW-01). Mirrors the convention in
	// task-read/detail.ts and standard-read/detail.ts.
	let memory: MemoryEntry | null = null;
	if (id) {
		memory = UUID_REGEX.test(id) ? db.memories.getById(id) : db.memories.getByCode(id, owner, repo);
	} else if (code) {
		memory = db.memories.getByCode(code, owner, repo);
	}

	if (!memory) {
		throw new Error(`Memory not found: ${id || code}`);
	}

	const content = formatMemoryDetail(memory);

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
	const stats = db.memories.getStats(params.owner, params.repo);

	// Total active memories (excluding task_archive)
	const total = db.memories.getTotalCount(params.owner, params.repo, false, ["task_archive"]);

	// Top memories ordered by importance DESC, created_at DESC
	const rows = db.memories.getRecentMemories(params.owner, params.repo, recapLimit, params.offset, false, [
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

		// Header: total + inline stats
		const statsLine = Object.entries(byType)
			.filter(([, c]) => c > 0)
			.map(([t, c]) => `${t}: ${c}`)
			.join(" · ");
		parts.push(`Memory Timeline — ${total} total${rows.length < total ? ` (showing ${rows.length})` : ""}`);
		if (statsLine) parts.push(statsLine);
		parts.push("");

		// Timeline grouped by created_at date
		const dateGroups: Map<string, MemoryEntry[]> = new Map();
		const sortedByDate = [...rows].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
		for (const row of sortedByDate) {
			const dateKey = row.created_at.split("T")[0];
			const group = dateGroups.get(dateKey);
			if (group) {
				group.push(row);
			} else {
				dateGroups.set(dateKey, [row]);
			}
		}

		for (const [date, entries] of dateGroups) {
			parts.push(date);
			for (const entry of entries) {
				const code = (entry.code || "-").padEnd(8);
				const type = (entry.type || "").padEnd(10);
				parts.push(`  ${code} [${entry.importance}]  ${type}  ${entry.title}`);
			}
			parts.push("");
		}

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
