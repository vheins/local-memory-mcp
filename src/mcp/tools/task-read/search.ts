import { SQLiteStore } from "../../storage/sqlite";
import { Task, VectorStore, TASK_STATUSES } from "../../types";
import { createMcpResponse, McpResponse } from "../../utils/mcp-response";
import { TaskStatusValues } from "../schemas";
import { logger } from "../../utils/logger";
import { fetchAggregatedTaskKgContext } from "../kg-archivist/query";
import { capitalize } from "./shared";
import {
	scoreHybrid,
	computeRecencyScore,
	countTermOverlap,
	applyThreshold,
	HYBRID_WEIGHTS
} from "../../utils/scoring";
import { SEARCH_THRESHOLDS } from "../../utils/constants";
import { renderGroupedSummary, enumOrderComparator } from "../../utils/summary";

// ── Task-specific scoring helpers ─────────────────────────────────────

/**
 * Domain score for tasks: ratio of query terms found in the task's text
 * fields. Unlike the memory engine (tags overlap), tasks have no tag list,
 * so the denominator is the query term count (behavior preserved from the
 * original per-engine implementation).
 */
function computeDomainScore(task: Task, queryTerms: string[]): number {
	if (queryTerms.length === 0) return 0;
	const textFields = [task.title, task.description, task.task_code, task.phase].filter(Boolean).join(" ").toLowerCase();
	const words = textFields.split(/\s+/);
	return Math.min(1, countTermOverlap(queryTerms, words) / Math.max(queryTerms.length, 1));
}

function computeConfidence(score: number): "high" | "medium" | "low" {
	if (score >= 0.7) return "high";
	if (score >= 0.4) return "medium";
	return "low";
}

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

	// 2. Hybrid vector scoring
	const queryTerms = query.split(/\s+/).filter(Boolean);
	const fetchLimit = (offset + limit) * 3;
	let scoredTasks: ScoredTask[] = [];

	try {
		const vectorResults = await vectors.search(query, fetchLimit, repo, "task");
		const vectorScoreMap = new Map(vectorResults.map((vr) => [vr.id, vr.score]));

		// Score keyword-matched tasks
		scoredTasks = keywordTasks.map((t: Task) => {
			const similarity = vectorScoreMap.get(t.id) ?? 0;
			const keywordScore = 1.0; // Task matched the SQL LIKE query
			const recencyScore = computeRecencyScore(t.created_at);
			const domainScore = computeDomainScore(t, queryTerms);
			const finalScore = scoreHybrid({ similarity, keyword: keywordScore, recency: recencyScore, domain: domainScore });
			return { task: t, similarityScore: similarity, keywordScore, recencyScore, domainScore, finalScore };
		});

		// Add vector-only results (semantic matches not caught by SQL LIKE)
		if (vectorResults.length > 0) {
			const keywordIdSet = new Set(keywordTasks.map((t: Task) => t.id));
			const vectorOnlyIds = vectorResults.filter((vr) => !keywordIdSet.has(vr.id)).map((vr) => vr.id);
			if (vectorOnlyIds.length > 0) {
				const vectorOnlyTasks = storage.tasks.getTasksByIds(vectorOnlyIds);
				for (const t of vectorOnlyTasks) {
					const similarity = vectorScoreMap.get(t.id) ?? 0;
					const keywordScore = 0;
					const recencyScore = computeRecencyScore(t.created_at);
					const domainScore = computeDomainScore(t, queryTerms);
					const finalScore = scoreHybrid({
						similarity,
						keyword: keywordScore,
						recency: recencyScore,
						domain: domainScore
					});
					scoredTasks.push({
						task: t,
						similarityScore: similarity,
						keywordScore,
						recencyScore,
						domainScore,
						finalScore
					});
				}
			}
		}
	} catch (error) {
		// Graceful fallback: keyword-only with recency scoring.
		// Preserves the original formula (recency carries the combined
		// recency+domain weight; domain is deliberately not included here).
		logger.warn("[Tool] task-read/search vector search failed, using keyword-only fallback", { error: String(error) });
		scoredTasks = keywordTasks.map((t: Task) => {
			const recencyScore = computeRecencyScore(t.created_at);
			const domainScore = computeDomainScore(t, queryTerms);
			const fallbackScore =
				recencyScore * (HYBRID_WEIGHTS.recency + HYBRID_WEIGHTS.domain) +
				(HYBRID_WEIGHTS.similarity + HYBRID_WEIGHTS.keyword);
			return {
				task: t,
				similarityScore: 0,
				keywordScore: 1.0,
				recencyScore,
				domainScore,
				finalScore: fallbackScore
			};
		});
	}

	// 3. Sort by hybrid score
	scoredTasks.sort((a: ScoredTask, b: ScoredTask) => b.finalScore - a.finalScore);

	// 4. Adaptive threshold (SPEC-001)
	let eligible = scoredTasks.filter((st: ScoredTask) =>
		applyThreshold(st.finalScore, scoredTasks.length, SEARCH_THRESHOLDS.task)
	);
	// Guarantee at least 1 result
	if (eligible.length === 0 && scoredTasks.length > 0) {
		eligible = [scoredTasks[0]];
	}

	// 5. FTS5 fallback — if eligible results are fewer than requested limit,
	// supplement with keyword-only scored results (tasks that matched SQL LIKE)
	if (eligible.length < offset + limit) {
		const eligibleIdSet = new Set(eligible.map((st: ScoredTask) => st.task.id));
		const fallbackTasks = scoredTasks
			.filter((st: ScoredTask) => !eligibleIdSet.has(st.task.id) && st.keywordScore > 0)
			.slice(0, offset + limit - eligible.length);
		eligible = [...eligible, ...fallbackTasks];
	}

	// 6. In-memory phase filter
	if (phase) {
		const phaseLower = phase.toLowerCase();
		eligible = eligible.filter((st: ScoredTask) => st.task.phase && st.task.phase.toLowerCase() === phaseLower);
	}

	// 7. In-memory priority filter
	if (priority !== undefined) {
		eligible = eligible.filter((st: ScoredTask) => st.task.priority === priority);
	}

	const total = eligible.length;
	const paginated = eligible.slice(offset, offset + limit);

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
		computeConfidence(st.finalScore),
		st.task.updated_at,
		st.task.phase
	]);

	const structuredData: Record<string, unknown> = {
		schema: "task-read/search",
		query,
		count: paginated.length,
		total,
		offset,
		limit,
		results: {
			columns: [...COLUMNS],
			rows
		}
	};

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
