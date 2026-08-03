import { SQLiteStore } from "../../storage/sqlite";
import { Task, VectorStore, TASK_STATUSES } from "../../types";
import { buildTableResult, createMcpResponse, McpResponse } from "../../utils/mcp-response";
import { TaskStatusValues } from "../schemas/index";
import { logger } from "../../utils/logger";
import { fetchAggregatedTaskKgContext } from "../kg-archivist/query";
import { capitalize } from "./shared";
import { TASK_SCORING } from "../../utils/scoring";
import { HybridSearchEngine } from "../../utils/hybrid-search";
import { SEARCH_THRESHOLDS } from "../../utils/constants";
import { renderGroupedSummary, enumOrderComparator } from "../../utils/summary";

// ── Task-specific scoring helpers ─────────────────────────────────────
// Task domain/recency/confidence live in TASK_SCORING (utils/scoring.ts,
// OPT-DRY-04) — see its docblock for the task-specific semantics
// (query-coverage domain denominator, 30-day recency half-life, 0.7/0.4
// confidence buckets).

// ── ScoredTask internal type ───────────────────────────────────────────

interface ScoredTask {
	task: Task;
	similarityScore: number;
	keywordScore: number;
	recencyScore: number;
	domainScore: number;
	finalScore: number;
}

// ── SEARCH mode — Hybrid vector + keyword + recency + domain scoring ──────

export async function handleSearchMode(
	owner: string,
	repo: string,
	query: string,
	status: string | undefined,
	phase: string | undefined,
	priority: number | undefined,
	limit: number,
	offset: number,
	isJsonRequest: boolean,
	storage: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	// 1. Get keyword candidates from SQL (existing approach)
	let keywordTasks: Task[];
	if (status) {
		if (status === "all") {
			keywordTasks = storage.tasks.getTasksByMultipleStatuses(owner, repo, [], undefined, undefined, query);
		} else {
			const statuses = status
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean);
			if (statuses.length > 1) {
				keywordTasks = storage.tasks.getTasksByMultipleStatuses(owner, repo, statuses, undefined, undefined, query);
			} else {
				keywordTasks = storage.tasks.getTasksByRepo(owner, repo, status, undefined, undefined, query);
			}
		}
	} else {
		keywordTasks = storage.tasks.getTasksByMultipleStatuses(
			owner,
			repo,
			[...TaskStatusValues],
			undefined,
			undefined,
			query
		);
	}

	// 2. Hybrid vector scoring through the shared engine (OPT-DRY-01).
	// The engine owns vector+keyword merge, sort, threshold, guarantee,
	// the FTS5 supplement + phase/priority filters (postFilter), and
	// pagination. This file keeps ONLY the candidate fetch + domain/recency
	// signal computation (EntityScorer below).
	const queryTerms = query.split(/\s+/).filter(Boolean);
	const fetchLimit = (offset + limit) * 3;

	// A failed vector search falls back to keyword-only scoring (engine
	// fallback path via vectorResults = null).
	const vectorResults = await vectors.search(query, fetchLimit, repo, "task").catch((error) => {
		logger.warn("[Tool] task-read/search vector search failed, using keyword-only fallback", { error: String(error) });
		return null;
	});
	const vectorScoreMap = new Map((vectorResults ?? []).map((vr) => [vr.id, vr.score]));

	// Vector-only results (semantic matches not caught by SQL LIKE) are
	// fetched here and merged in by the engine (merge: "supplement"). A DB
	// failure fetching them (SQLITE_BUSY/corruption) must NOT reject the whole
	// search — degrade to an empty map: vector scores still apply to keyword
	// candidates, only the vector-only supplement is dropped.
	let vectorEntities: ReadonlyMap<string, Task> = new Map();
	if (vectorResults) {
		const keywordIdSet = new Set(keywordTasks.map((t: Task) => t.id));
		const vectorOnlyIds = vectorResults.filter((vr) => !keywordIdSet.has(vr.id)).map((vr) => vr.id);
		if (vectorOnlyIds.length > 0) {
			try {
				const vectorOnlyTasks = storage.tasks.getTasksByIds(vectorOnlyIds);
				vectorEntities = new Map(vectorOnlyTasks.map((t: Task) => [t.id, t]));
			} catch (error) {
				logger.warn("[Tool] task-read/search vector-entity fetch failed, dropping vector-only supplement", {
					error: String(error)
				});
			}
		}
	}

	const { items, total } = HybridSearchEngine.run<Task>({
		candidates: keywordTasks.map((t: Task) => ({ entity: t, similarity: vectorScoreMap.get(t.id) ?? 0 })),
		queryTerms,
		vectorResults,
		vectorEntities,
		scorer: {
			idOf: (task) => task.id,
			scoreCandidate: (task, similarity) => ({
				similarity,
				keyword: 1.0, // Task matched the SQL LIKE query
				recency: TASK_SCORING.recency(task),
				domain: TASK_SCORING.domain(task, { queryTerms })
			}),
			scoreVectorOnly: (task, hit) => ({
				similarity: hit.score,
				keyword: 0,
				recency: TASK_SCORING.recency(task),
				domain: TASK_SCORING.domain(task, { queryTerms })
			}),
			scoreFallback: (task, _similarity) => ({
				similarity: 0,
				keyword: 1.0,
				recency: TASK_SCORING.recency(task),
				domain: TASK_SCORING.domain(task, { queryTerms })
			})
		},
		thresholds: SEARCH_THRESHOLDS.task,
		merge: "supplement",
		offset,
		limit,
		postFilter: (eligible, context) => {
			let list = eligible;
			// 5. FTS5 fallback — if eligible results are fewer than requested
			// limit, supplement with keyword-only scored results (tasks that
			// matched SQL LIKE)
			if (list.length < offset + limit) {
				const eligibleIdSet = new Set(list.map((st) => st.entity.id));
				const fallbackTasks = context.allScored
					.filter((st) => !eligibleIdSet.has(st.entity.id) && st.keywordScore > 0)
					.slice(0, offset + limit - list.length);
				list = [...list, ...fallbackTasks];
			}
			// 6. In-memory phase filter
			if (phase) {
				const phaseLower = phase.toLowerCase();
				list = list.filter((st) => st.entity.phase && st.entity.phase.toLowerCase() === phaseLower);
			}
			// 7. In-memory priority filter
			if (priority !== undefined) {
				list = list.filter((st) => st.entity.priority === priority);
			}
			return list;
		}
	});

	const paginated: ScoredTask[] = items.map((st) => ({
		task: st.entity,
		similarityScore: st.similarityScore,
		keywordScore: st.keywordScore,
		recencyScore: st.recencyScore,
		domainScore: st.domainScore,
		finalScore: st.finalScore
	}));

	const COLUMNS = [
		"id",
		"task_code",
		"title",
		"status",
		"priority",
		"score",
		"confidence",
		"updated_at",
		"phase"
	] as const;
	const rows = paginated.map((st: ScoredTask) => [
		st.task.id,
		st.task.task_code,
		st.task.title,
		st.task.status,
		st.task.priority,
		Number(st.finalScore.toFixed(4)),
		TASK_SCORING.confidence({ finalScore: st.finalScore, keywordScore: st.keywordScore }),
		st.task.updated_at,
		st.task.phase
	]);

	const structuredData = buildTableResult(COLUMNS, rows, {
		schema: "task-read/search",
		key: "results",
		count: paginated.length,
		total,
		offset,
		limit,
		extra: { query }
	});

	// Best-effort KG context (REFACTOR-KG-004)
	if (paginated.length > 0) {
		const kgData = fetchAggregatedTaskKgContext(
			storage,
			repo,
			paginated.map((st: ScoredTask) => st.task)
		);
		if (kgData) structuredData.kg = kgData;
	}

	let contentSummary: string | undefined;
	if (!isJsonRequest) {
		if (paginated.length > 0) {
			const lines: string[] = [];
			lines.push(`### Results: ${total} tasks for "${query}"`);
			lines.push("");

			// Fused grouped by status (enum order), with global rank #N
			const STATUS_ORDER = [...TASK_STATUSES];
			lines.push(
				renderGroupedSummary<ScoredTask>({
					items: paginated,
					getGroup: (st) => st.task.status,
					groupOrder: enumOrderComparator(STATUS_ORDER),
					formatGroupLabel: (key) => (key === "in_progress" ? "In Progress" : capitalize(key)),
					formatLine: (st, rank) => `#${rank} ${st.task.task_code} [${st.finalScore.toFixed(2)}] ${st.task.title}`,
					footer: "Use task-detail with task_code for full details."
				})
			);
			contentSummary = lines.join("\n");
		} else {
			contentSummary = `No tasks found for "${query}" in repo "${repo}".`;
		}
	}

	logger.info("[Tool] task-read/search", {
		repo,
		query,
		total,
		offset,
		returned: paginated.length
	});

	return createMcpResponse(structuredData, contentSummary || `Found ${total} tasks for "${query}".`, {
		contentSummary,
		structuredContentPathHint: "results",
		includeJson: isJsonRequest
	});
}
