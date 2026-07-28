import { SQLiteStore } from "../storage/sqlite";
import { Task, VectorStore } from "../types";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";
import { UUID_REGEX } from "../utils/uuid";
import { TaskReadSchema, TaskStatusValues } from "./schemas";
import { logger } from "../utils/logger";

// ── Hybrid scoring constants ──────────────────────────────────────────────

const HYBRID_WEIGHTS = {
	similarity: 0.4,
	keyword: 0.3,
	recency: 0.15,
	domain: 0.15
} as const;

const RECENCY_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;

function computeRecencyScore(createdAt: string): number {
	const ageMs = Date.now() - new Date(createdAt).getTime();
	if (ageMs <= 0) return 1;
	return Math.max(0, Math.min(1, Math.pow(2, -ageMs / RECENCY_HALF_LIFE_MS)));
}

function computeDomainScore(task: Task, queryTerms: string[]): number {
	if (queryTerms.length === 0) return 0;
	const textFields = [task.title, task.description, task.task_code, task.phase].filter(Boolean).join(" ").toLowerCase();
	const querySet = new Set(queryTerms.map((t: string) => t.toLowerCase()));
	const words = textFields.split(/\s+/);
	const matches = words.filter((w: string) => querySet.has(w)).length;
	return Math.min(1, matches / Math.max(queryTerms.length, 1));
}

function computeConfidence(score: number): "high" | "medium" | "low" {
	if (score >= 0.7) return "high";
	if (score >= 0.4) return "medium";
	return "low";
}

// ── Helpers ───────────────────────────────────────────────────────────────

function capitalize(str: string): string {
	return str.charAt(0).toUpperCase() + str.slice(1);
}

function describeStatusFilter(status?: string): string {
	if (!status) return "active";
	if (status === "all") return "all";

	const labels = status
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean)
		.map((part) => {
			switch (part) {
				case "in_progress":
					return "in progress";
				default:
					return part;
			}
		});

	if (labels.length === 0) return "active";
	if (labels.length === 1) return labels[0];
	if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
	return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

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
		logger.warn("[Task.Read] KG query failed", { error: String(error), repo });
		return null;
	}
}

/**
 * Fetch KG entities + relations related to a task by matching task
 * title/description text against entity names. Best-effort — never throws.
 */
function fetchTaskKgContext(
	db: SQLiteStore,
	repo: string,
	taskTitle: string,
	taskDescription: string
): KgResult | null {
	try {
		const searchText = [taskTitle, taskDescription].filter(Boolean).join(" ");
		if (!searchText.trim()) return { entities: [], relations: [] };

		const entityRows = db.db
			.prepare<unknown[], { name: string }>(`SELECT name FROM entities WHERE repo = ? AND INSTR(?, name) > 0`)
			.all(repo, searchText) as { name: string }[];

		if (entityRows.length === 0) return { entities: [], relations: [] };

		return kgQuery(
			db,
			repo,
			entityRows.map((r) => r.name),
			"task"
		);
	} catch (error) {
		logger.warn("[Task.Read] KG context fetch failed", { error: String(error), title: taskTitle });
		return null;
	}
}

/**
 * Aggregate KG context across multiple task titles + descriptions.
 */
function fetchAggregatedTaskKgContext(
	db: SQLiteStore,
	repo: string,
	tasks: Array<{ title: string; description?: string | null }>
): KgResult | null {
	try {
		if (tasks.length === 0) return { entities: [], relations: [] };

		const searchText = tasks
			.map((t) => [t.title, t.description ?? ""].filter(Boolean).join(" "))
			.filter(Boolean)
			.join(" ");
		if (!searchText.trim()) return { entities: [], relations: [] };

		const entityRows = db.db
			.prepare<unknown[], { name: string }>(`SELECT DISTINCT name FROM entities WHERE repo = ? AND INSTR(?, name) > 0`)
			.all(repo, searchText) as { name: string }[];

		if (entityRows.length === 0) return { entities: [], relations: [] };

		return kgQuery(
			db,
			repo,
			entityRows.map((r) => r.name),
			"task"
		);
	} catch (error) {
		logger.warn("[Task.Read] Aggregated KG context fetch failed", {
			error: String(error),
			count: tasks.length
		});
		return null;
	}
}

// ── SEARCH mode — Hybrid vector + keyword + recency + domain scoring ──────

async function handleSearchMode(
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
	interface ScoredTask {
		task: Task;
		similarityScore: number;
		keywordScore: number;
		recencyScore: number;
		domainScore: number;
		finalScore: number;
	}

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
			const finalScore =
				similarity * HYBRID_WEIGHTS.similarity +
				keywordScore * HYBRID_WEIGHTS.keyword +
				recencyScore * HYBRID_WEIGHTS.recency +
				domainScore * HYBRID_WEIGHTS.domain;
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
					const finalScore =
						similarity * HYBRID_WEIGHTS.similarity +
						recencyScore * HYBRID_WEIGHTS.recency +
						domainScore * HYBRID_WEIGHTS.domain;
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
		// Graceful fallback: keyword-only with recency + domain scoring
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
	const threshold = scoredTasks.length <= 5 ? 0.08 : 0.2;
	let eligible = scoredTasks.filter((st: ScoredTask) => st.finalScore >= threshold);
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
		const statusLabel = describeStatusFilter(status);
		contentSummary =
			paginated.length > 0
				? `Found ${total} tasks matching "${query}" in repo "${repo}" (${statusLabel}). Use task-detail with task_code for full details.`
				: `No tasks found for "${query}" in repo "${repo}".`;
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

// ── DETAIL mode ───────────────────────────────────────────────────────────

async function handleDetailMode(
	owner: string,
	repo: string,
	id: string | undefined,
	code: string | undefined,
	ids: string[] | undefined,
	codes: string[] | undefined,
	isJsonRequest: boolean,
	storage: SQLiteStore
): Promise<McpResponse> {
	// ── Single detail ──
	if (id || code) {
		const identifier = id || code!;
		let task: Task | null;
		if (id) {
			task = UUID_REGEX.test(id) ? storage.tasks.getTaskById(id) : storage.tasks.getTaskByCode(owner, repo, id);
		} else {
			task = storage.tasks.getTaskByCode(owner, repo, code!);
		}

		if (!task) {
			throw new Error(`Task not found: ${identifier} in repo ${repo}`);
		}

		const comments = storage.taskComments.getTaskCommentsByTaskId(task.id);
		const children = storage.tasks.getChildrenByParentId(task.id);
		const depended_by = storage.tasks.getDependedByTaskId(task.id);

		let contentSummary: string | undefined;
		if (!isJsonRequest) {
			const lines: string[] = [
				`Task: ${task.title}`,
				`Code: ${task.task_code}`,
				`Repo: ${task.repo}`,
				`Status: ${task.status}`,
				`Priority: ${task.priority}`,
				`ID: ${task.id}`
			];

			if (task.phase) lines.push(`Phase: ${task.phase}`);
			if (task.parent_code) lines.push(`Parent: ${task.parent_code} (${task.parent_id || ""})`);
			if (task.depends_on_code) lines.push(`Depends On: ${task.depends_on_code} (${task.depends_on || ""})`);
			if (task.doc_path) lines.push(`Doc Path: ${task.doc_path}`);
			if (task.description) lines.push(`Description: ${task.description}`);
			if (task.tags && task.tags.length > 0) lines.push(`Tags: ${task.tags.join(", ")}`);
			if (task.suggested_skills && task.suggested_skills.length > 0)
				lines.push(`Suggested Skills: ${task.suggested_skills.join(", ")}`);
			if (task.est_tokens) lines.push(`Est Tokens: ${task.est_tokens}`);
			if (task.commit_id) lines.push(`Commit: ${task.commit_id}`);
			if (task.changed_files && task.changed_files.length > 0)
				lines.push(`Changed Files: ${task.changed_files.join(", ")}`);
			if (task.metadata) lines.push(`Metadata: ${JSON.stringify(task.metadata)}`);
			if (task.comments_count !== undefined) lines.push(`Comments: ${task.comments_count}`);
			if (task.coordination) {
				if (task.coordination.active_claim_count > 0) {
					lines.push(
						`Claim: ${task.coordination.active_claim_agent || "?"} (${task.coordination.active_claim_role || ""}) since ${task.coordination.active_claim_claimed_at || ""}`
					);
				}
				if (task.coordination.pending_handoff_count > 0) {
					lines.push(
						`Handoff: ${task.coordination.pending_handoff_summary || ""} → ${task.coordination.pending_handoff_to_agent || "?"}`
					);
				}
			}
			lines.push(`Created: ${task.created_at}`);
			if (task.updated_at) lines.push(`Updated: ${task.updated_at}`);
			if (task.in_progress_at) lines.push(`Started: ${task.in_progress_at}`);
			if (task.finished_at) lines.push(`Finished: ${task.finished_at}`);
			if (task.canceled_at) lines.push(`Canceled: ${task.canceled_at}`);

			if (children.length > 0) {
				lines.push("", "--- Children ---");
				for (const c of children) {
					lines.push(`- ${c.task_code}: ${c.title} (${c.status})`);
				}
			}

			if (depended_by.length > 0) {
				lines.push("", "--- Depended By ---");
				for (const d of depended_by) {
					lines.push(`- ${d.task_code}: ${d.title} (${d.status})`);
				}
			}

			if (comments.length > 0) {
				lines.push("", "--- History ---");
				for (const c of comments) {
					const statusChange =
						c.previous_status || c.next_status ? ` [${c.previous_status || "?"} → ${c.next_status || "?"}]` : "";
					const agentInfo = c.agent ? ` (${c.agent})` : "";
					lines.push(`- ${c.created_at}${statusChange}${agentInfo}: ${c.comment}`);
				}
			}
			contentSummary = lines.join("\n");
		}

		// Best-effort KG context fetch based on task title + description
		const kgContext = fetchTaskKgContext(storage, repo, task.title, task.description || "");

		const data: Record<string, unknown> = {
			...task,
			comments,
			children,
			depended_by
		};
		if (kgContext) data.kg = kgContext;

		return createMcpResponse(data, contentSummary || "", {
			contentSummary,
			includeJson: isJsonRequest
		});
	}

	// ── Bulk detail ──
	let tasks: Task[] = [];
	if (ids) {
		tasks = storage.tasks.getTasksByIds(ids);
	} else if (codes) {
		for (const code of codes) {
			const t = storage.tasks.getTaskByCode(owner, repo, code);
			if (t) tasks.push(t);
		}
	}

	if (tasks.length === 0) {
		throw new Error("No tasks found for the provided identifiers");
	}

	// Enrich each task with comments, children, depended_by
	const enriched = tasks.map((t) => {
		const comments = storage.taskComments.getTaskCommentsByTaskId(t.id);
		const children = storage.tasks.getChildrenByParentId(t.id);
		const depended_by = storage.tasks.getDependedByTaskId(t.id);
		return { ...t, comments, children, depended_by };
	});

	// Best-effort aggregated KG context from all task titles + descriptions
	const combinedTitle = enriched.map((t) => t.title).join(" ");
	const combinedDesc = enriched
		.map((t) => t.description || "")
		.filter(Boolean)
		.join(" ");
	const kgContext = fetchTaskKgContext(storage, repo, combinedTitle, combinedDesc);

	let contentSummary: string | undefined;
	if (!isJsonRequest) {
		contentSummary = `Found ${enriched.length} tasks in repo "${repo}".`;
	}

	logger.info("[Tool] task-read/detail", {
		repo,
		count: enriched.length,
		bulk: !(id || code)
	});

	const data: Record<string, unknown> = {
		schema: "task-read/detail" as const,
		count: enriched.length,
		tasks: enriched
	};
	if (kgContext) data.kg = kgContext;

	return createMcpResponse(data, contentSummary || `Found ${enriched.length} tasks.`, {
		contentSummary,
		includeJson: isJsonRequest
	});
}

// ── LIST mode ─────────────────────────────────────────────────────────────

async function handleListMode(
	owner: string,
	repo: string,
	status: string | undefined,
	phase: string | undefined,
	limit: number,
	offset: number,
	isJsonRequest: boolean,
	storage: SQLiteStore
): Promise<McpResponse> {
	// Default status filter matches existing task-list behaviour
	const effectiveStatus = status ?? "backlog,in_progress";

	let statuses: string[] = [];
	if (effectiveStatus !== "all") {
		statuses = effectiveStatus
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
	}

	const tasks = storage.tasks.getTasksByMultipleStatuses(owner, repo, statuses, limit, offset);
	const filteredTasks = phase
		? tasks.filter((t: Task) => t.phase && t.phase.toLowerCase() === phase.toLowerCase())
		: tasks;

	const COLUMNS = ["id", "task_code", "title", "status", "priority", "updated_at", "comments_count"] as const;
	const rows = filteredTasks.map((t: Task & { comments_count?: number }) => [
		t.id,
		t.task_code,
		t.title,
		t.status,
		t.priority,
		t.updated_at,
		t.comments_count || 0
	]);

	const structuredData: Record<string, unknown> = {
		schema: "task-read/list",
		tasks: {
			columns: [...COLUMNS],
			rows
		},
		count: rows.length,
		offset
	};

	// Best-effort KG context (REFACTOR-KG-004)
	if (filteredTasks.length > 0) {
		const kgData = fetchAggregatedTaskKgContext(storage, repo, filteredTasks);
		if (kgData) structuredData.kg = kgData;
	}

	let contentSummary: string | undefined;
	if (!isJsonRequest) {
		const statusLabel = describeStatusFilter(effectiveStatus);
		const taskLabel = rows.length === 1 ? "task" : "tasks";

		const parts: string[] = [];

		// Group by status for display
		const tasksByStatus: Record<string, Task[]> = {};
		for (const t of filteredTasks) {
			const statusLabel = t.status === "in_progress" ? "In Progress" : capitalize(t.status);
			if (!tasksByStatus[statusLabel]) {
				tasksByStatus[statusLabel] = [];
			}
			tasksByStatus[statusLabel].push(t);
		}

		if (Object.keys(tasksByStatus).length > 0) {
			parts.push("Current Available Tasks:");
			for (const [sts, items] of Object.entries(tasksByStatus)) {
				if (items.length > 0) {
					parts.push("");
					parts.push(`### ${sts}`);
					parts.push("");
					parts.push("| code | status | priority | phase | last_updated | title |");
					parts.push("|------|--------|----------|-------|--------------|-------|");
					for (const t of items) {
						const lastUpdated = t.updated_at ? t.updated_at.slice(0, 16).replace("T", " ") : "never";
						parts.push(`| ${t.task_code} | ${t.status} | ${t.priority} | ${t.phase} | ${lastUpdated} | ${t.title} |`);
					}
				}
			}
		} else {
			parts.push(`Found ${rows.length} ${statusLabel} ${taskLabel} in repo "${repo}".`);
		}

		if (phase) {
			parts.push("");
			parts.push(`Phase filter: ${phase}.`);
		}

		parts.push("");
		parts.push("See task-detail with task_code for details.");

		contentSummary = parts.join("\n").trim();
	}

	logger.info("[Tool] task-read/list", {
		repo,
		status: effectiveStatus,
		phase,
		count: rows.length,
		offset
	});

	return createMcpResponse(structuredData, contentSummary || "", {
		contentSummary,
		includeJson: isJsonRequest
	});
}

// ── Main handler ──────────────────────────────────────────────────────────

export async function handleTaskRead(args: unknown, storage: SQLiteStore, vectors: VectorStore): Promise<McpResponse> {
	const parsed = TaskReadSchema.safeParse(args);
	if (!parsed.success) {
		const missing = parsed.error.issues
			.filter((i) => i.path.some((p) => p === "owner" || p === "repo"))
			.map((i) => i.message)
			.filter(Boolean);
		const msg =
			missing.length > 0
				? `Missing required fields: ${missing.join("; ")}. Pass owner/repo explicitly or configure MCP workspace roots so they can be auto-inferred.`
				: `Validation error: ${parsed.error.message}`;
		return { content: [{ type: "text" as const, text: msg }], isError: true };
	}

	const validated = parsed.data;
	const {
		owner,
		repo,
		query,
		code,
		codes,
		id,
		task_code,
		ids,
		task_codes,
		status,
		phase,
		priority,
		json: isJsonRequest = false
	} = validated;
	const { offset = 0 } = validated;
	let { limit } = validated;

	// Resolve canonical code/codes — prefer code/codes over task_code/task_codes
	const effectiveCode = code ?? task_code;
	const effectiveCodes = codes ?? task_codes;

	// ── Auto-infer mode ──
	if (query !== undefined) {
		// SEARCH mode: query present — default limit 10
		limit = limit ?? 10;
		return handleSearchMode(
			owner,
			repo,
			query,
			status,
			phase,
			priority,
			limit,
			offset,
			isJsonRequest,
			storage,
			vectors
		);
	}

	if (
		effectiveCode !== undefined ||
		id !== undefined ||
		effectiveCodes !== undefined ||
		ids !== undefined ||
		task_codes !== undefined
	) {
		// DETAIL mode: identifier present
		return handleDetailMode(owner, repo, id, effectiveCode, ids, effectiveCodes, isJsonRequest, storage);
	}

	// LIST mode: no query, no identifier — default filtered listing, default limit 5
	limit = limit ?? 5;
	return handleListMode(owner, repo, status, phase, limit, offset, isJsonRequest, storage);
}
