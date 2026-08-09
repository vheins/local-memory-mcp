import type {
	Memory,
	Task,
	CodingStandard,
	RepoMeta,
	DashboardStats,
	RecentAction,
	TaskClaim,
	TaskTimeStats,
	HealthData,
	Pagination,
	ReferenceDataState,
	StandardsExport,
	StandardsImportResult,
	KGNode,
	KGEdge,
	KGEntity,
	Handoff
} from "./stores";

// ─── API helpers ─────────────────────────────────────────────────────────────

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
	const res = await fetch(url, options);
	if (!res.ok) {
		const err: { error?: string; errors?: Array<{ detail?: string }> } = await res
			.json()
			.catch(() => ({ error: res.statusText }));
		throw new Error(err.error || err.errors?.[0]?.detail || `HTTP ${res.status}`);
	}
	const body = await res.json();
	return deserialize(body) as T;
}

interface JsonApiItem {
	id: string;
	type: string;
	attributes?: Record<string, unknown>;
}

interface JsonApiBody {
	data: JsonApiItem | JsonApiItem[];
	meta?: Record<string, unknown>;
}

function deserialize(body: JsonApiBody | unknown): unknown {
	if (!body || typeof body !== "object" || !("data" in body)) return body;
	const { data, meta } = body as JsonApiBody;

	const processItem = (item: JsonApiItem) => {
		const attr = (item.attributes || {}) as Record<string, unknown>;
		// Inject success for status responses
		if (item.type === "status" && attr.success === undefined) {
			attr.success = true;
		}
		// Return flat object (preserving ID except for generic 'system' IDs)
		if (item.id === "system") return attr;
		return { id: item.id, ...attr };
	};

	if (Array.isArray(data)) {
		const items = data.map(processItem);
		const result: Record<string, unknown> = {};
		if (meta) result.pagination = meta;

		const firstType = data[0]?.type;
		// Map JSON:API types to legacy field names
		if (firstType === "repository") return { repos: items };
		if (firstType === "recent-action") return { ...result, actions: items };
		if (firstType === "memory") return { ...result, memories: items };
		if (firstType === "task") return { ...result, tasks: items };
		if (firstType === "queue-job") return { ...result, jobs: items };

		const rootKey = firstType ? `${firstType}s` : "data";
		result[rootKey] = items;
		return result;
	}

	// Handle capability type - wrap each nested item with {data} for UI compatibility
	if ((data as JsonApiItem).type === "capability") {
		const attr = (data as JsonApiItem).attributes as Record<string, unknown>;
		const wrapWithData = (arr: unknown[]) =>
			(arr as Array<JsonApiItem>).map((item) => ({
				data: { id: item.id, ...(item.attributes || {}) }
			}));
		return {
			tools: wrapWithData((attr.tools as unknown[]) || []),
			prompts: wrapWithData((attr.prompts as unknown[]) || []),
			resources: wrapWithData((attr.resources as unknown[]) || [])
		};
	}

	const processed = processItem(data as JsonApiItem);
	return meta ? { ...processed, pagination: meta } : processed;
}

// ─── Codebase Search ─────────────────────────────────────────────────────────

export interface CodeSymbol {
	name: string;
	kind: "function" | "class" | "interface" | "type" | "enum" | "variable";
	signature?: string;
	filePath?: string;
	line?: number;
}

/**
 * Innermost symbol whose [start_line, end_line] span encloses a code match
 * (TASK-316 CODE mode enrichment).
 */
export interface EnclosingSymbol {
	name: string;
	kind: string;
	startLine: number;
	endLine: number;
}

/** A single content grep hit as served by GET /api/codebase/code-search. */
export interface CodeSearchMatch {
	filePath: string;
	language: string | null;
	line: number;
	snippet: string;
	matchIndex: number;
	enclosingSymbol: EnclosingSymbol | null;
}

/** CODE mode response shape (mirrors handleCodeSearchMode structuredContent). */
export interface CodeSearchResult {
	mode: "code";
	content: string;
	regex: boolean;
	language: string | null;
	matches: CodeSearchMatch[];
	total: number;
	hasMore: boolean;
	filesScanned: number;
	fileCount: number;
	indexedFiles: number;
	offset: number;
	limit: number;
}

// ─── Codebase Dead-Code Analysis (TASK-319/320) ─────────────────────────────
// Mirrors the ARCHITECTURE-mode `deadCode` block served by the MCP backend
// (src/mcp/codebase-index/services/dead-code.ts). Field names must match the
// wire shape EXACTLY — additive only.

/** Entry-point exclusion classifications for zero-ref candidates. */
export type EntryPointType = "bin" | "manifest" | "shebang" | "public-api";

/** Why a zero-ref candidate is excluded from the dead list (TASK-319). */
export interface EntryPointTag {
	type: EntryPointType;
	/** Human-readable why (e.g. "listed in package.json (bin)"). */
	reason: string;
}

/** A zero-reference top-level symbol in the unreferenced report. */
export interface UnreferencedSymbol {
	name: string;
	kind: string;
	file_path: string;
	/** Declaration start line (symbol.start_line), when known. */
	line: number | null;
	/** Per-kind reference breakdown — every kind is 0 for a true candidate. */
	kinds: Record<string, number>;
	/** Present ONLY when the candidate was excluded as an entry point. */
	entryPoint?: EntryPointTag;
}

/** A top in-degree symbol in the hotspots report. */
export interface HotspotSymbol {
	name: string;
	kind: string;
	file_path: string;
	refCount: number;
	/** Per-kind reference breakdown (call/instantiation/import/extends/implements). */
	topKinds: Record<string, number>;
}

/** Languages with trustworthy reference data vs declaration-only/unobserved. */
export interface LanguageCoverage {
	reliable: string[];
	unreliable: string[];
}

/** Totals for the dead-code analysis — full counts, NOT capped like the lists. */
export interface DeadCodeTotals {
	scanned: number;
	dead: number;
	entryExcluded: number;
	truncated: boolean;
}

/** The `deadCode` block appended to an ARCHITECTURE response (TASK-319). */
export interface DeadCodeBlock {
	unreferenced: UnreferencedSymbol[];
	hotspots: HotspotSymbol[];
	languageCoverage: LanguageCoverage;
	totals: DeadCodeTotals;
	/** Honesty note: which languages are trustworthy and why, plus any skipped exclusions. */
	coverageNote: string;
}

// ─── API ─────────────────────────────────────────────────────────────────────

export const api = {
	health: () => apiFetch<HealthData>("/api/health"),

	repos: () => apiFetch<{ repos: RepoMeta[] }>("/api/repos"),

	stats: (repo?: string) => {
		const q = repo ? `?repo=${encodeURIComponent(repo)}` : "";
		return apiFetch<DashboardStats>(`/api/stats${q}`);
	},

	recentActions: (repo: string | null, page: number, pageSize: number) => {
		let url = `/api/recent-actions?page=${page}&pageSize=${pageSize}`;
		if (repo) url += `&repo=${encodeURIComponent(repo)}`;
		return apiFetch<{ actions: RecentAction[]; pagination: Pagination }>(url);
	},

	memories: (params: {
		repo: string;
		type?: string;
		search?: string;
		minImportance?: number | null;
		maxImportance?: number | null;
		sortBy?: string;
		sortOrder?: string;
		page?: number;
		pageSize?: number;
	}) => {
		const q = new URLSearchParams({ repo: params.repo });
		if (params.type) q.set("type", params.type);
		if (params.search) q.set("search", params.search);
		if (params.minImportance != null) q.set("minImportance", String(params.minImportance));
		if (params.maxImportance != null) q.set("maxImportance", String(params.maxImportance));
		if (params.sortBy) q.set("sortBy", params.sortBy);
		if (params.sortOrder) q.set("sortOrder", params.sortOrder);
		if (params.page) q.set("page", String(params.page));
		if (params.pageSize) q.set("pageSize", String(params.pageSize));
		return apiFetch<{ memories: Memory[]; pagination: Pagination }>(`/api/memories?${q}`);
	},

	memoryById: (id: string) => apiFetch<Memory>(`/api/memories/${id}`),

	createMemory: (body: Partial<Memory>) =>
		apiFetch<{ id: string }>("/api/memories", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body)
		}),

	updateMemory: (id: string, updates: Partial<Memory>) =>
		apiFetch<{ success: boolean }>(`/api/memories/${id}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(updates)
		}),

	deleteMemory: (id: string) => apiFetch<{ success: boolean }>(`/api/memories/${id}`, { method: "DELETE" }),

	bulkImportMemories: (repo: string, items: unknown[]) =>
		apiFetch<{ count: number }>("/api/memories/import", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ repo, items })
		}),

	bulkMemoryAction: (action: string, ids: string[], updates?: Partial<Memory>) =>
		apiFetch<{ count: number }>("/api/memories/action", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action, ids, updates })
		}),

	tasks: (params: { repo: string; status?: string; search?: string; page?: number; pageSize?: number }) => {
		const q = new URLSearchParams({ repo: params.repo });
		if (params.status) q.set("status", params.status);
		if (params.search) q.set("search", params.search);
		if (params.page) q.set("page", String(params.page));
		if (params.pageSize) q.set("pageSize", String(params.pageSize));
		return apiFetch<{ tasks: Task[]; pagination: Pagination }>(`/api/tasks?${q}`);
	},

	taskById: (id: string) => apiFetch<Task>(`/api/tasks/${id}`),

	taskByCode: (repo: string, task_code: string) =>
		apiFetch<Task>(`/api/tasks/by-code?repo=${encodeURIComponent(repo)}&task_code=${encodeURIComponent(task_code)}`),

	taskTimeStats: (repo?: string | null) =>
		apiFetch<TaskTimeStats>(repo ? `/api/tasks/stats/time?repo=${encodeURIComponent(repo)}` : "/api/tasks/stats/time"),

	updateTask: (id: string, updates: Partial<Task>) =>
		apiFetch<Task>(`/api/tasks/${id}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(updates)
		}),

	createTask: (body: Partial<Task>) =>
		apiFetch<{ id: string }>("/api/tasks", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body)
		}),

	deleteTask: (id: string) => apiFetch<{ success: boolean }>(`/api/tasks/${id}`, { method: "DELETE" }),

	bulkImportTasks: (repo: string, items: unknown[]) =>
		apiFetch<{ count: number }>("/api/tasks/import", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ repo, items })
		}),

	bulkTaskAction: (action: string, ids: string[], updates?: Partial<Task>) =>
		apiFetch<{ count: number }>("/api/tasks/action", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action, ids, updates })
		}),

	updateTaskComment: (id: string, comment: string) =>
		apiFetch<{ success: boolean }>(`/api/tasks/comments/${id}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ comment })
		}),

	deleteTaskComment: (id: string) => apiFetch<{ success: boolean }>(`/api/tasks/comments/${id}`, { method: "DELETE" }),

	coordinationClaims: (params: {
		repo: string;
		agent?: string;
		active_only?: boolean;
		page?: number;
		pageSize?: number;
	}) => {
		const q = new URLSearchParams({ repo: params.repo });
		if (params.agent) q.set("agent", params.agent);
		if (params.active_only !== undefined) q.set("active_only", String(params.active_only));
		if (params.page) q.set("page", String(params.page));
		if (params.pageSize) q.set("pageSize", String(params.pageSize));
		return apiFetch<{ claims: TaskClaim[]; pagination: Pagination }>(`/api/coordination/claims?${q}`);
	},

	releaseClaim: (body: { repo: string; task_id?: string; task_code?: string; agent?: string }) =>
		apiFetch<{ success: boolean; task_id: string; task_code?: string | null; agent?: string | null }>(
			"/api/coordination/claims/release",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body)
			}
		),

	coordinationHandoffs: (params: {
		repo: string;
		status?: string;
		to_agent?: string;
		from_agent?: string;
		page?: number;
		pageSize?: number;
	}) => {
		const q = new URLSearchParams({ repo: params.repo });
		if (params.status) q.set("status", params.status);
		if (params.to_agent) q.set("to_agent", params.to_agent);
		if (params.from_agent) q.set("from_agent", params.from_agent);
		if (params.page) q.set("page", String(params.page));
		if (params.pageSize) q.set("pageSize", String(params.pageSize));
		return apiFetch<{ handoffs: Handoff[]; pagination: Pagination }>(`/api/coordination/handoffs?${q}`);
	},

	createHandoff: (body: {
		repo: string;
		from_agent: string;
		to_agent?: string;
		task_code?: string;
		summary: string;
		context?: Record<string, unknown>;
		expires_at?: string;
	}) =>
		apiFetch<{ success: boolean; handoff: Handoff }>("/api/coordination/handoffs", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body)
		}),

	updateHandoffStatus: (body: { id: string; status: string }) =>
		apiFetch<{ success: boolean; handoff: Handoff }>("/api/coordination/handoffs/status", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body)
		}),

	standards: (params: {
		repo?: string;
		query?: string;
		language?: string;
		stack?: string;
		tags?: string;
		is_global?: boolean;
		page?: number;
		pageSize?: number;
	}) => {
		const q = new URLSearchParams();
		if (params.repo) q.set("repo", params.repo);
		if (params.query) q.set("query", params.query);
		if (params.language) q.set("language", params.language);
		if (params.stack) q.set("stack", params.stack);
		if (params.tags) q.set("tags", params.tags);
		if (params.is_global !== undefined) q.set("is_global", String(params.is_global));
		if (params.page) q.set("page", String(params.page));
		if (params.pageSize) q.set("pageSize", String(params.pageSize));
		return apiFetch<{ standards: CodingStandard[]; pagination: Pagination }>(`/api/standards?${q}`);
	},

	standardById: (id: string) => apiFetch<CodingStandard>(`/api/standards/${id}`),

	createStandard: (body: Partial<CodingStandard>) =>
		apiFetch<CodingStandard>("/api/standards", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body)
		}),

	updateStandard: (id: string, updates: Partial<CodingStandard>) =>
		apiFetch<{ success: boolean }>(`/api/standards/${id}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(updates)
		}),

	deleteStandard: (id: string) => apiFetch<{ success: boolean }>(`/api/standards/${id}`, { method: "DELETE" }),

	exportStandards: (params: { repo?: string; scope?: "repo" | "global" | "all" }) => {
		const q = new URLSearchParams();
		if (params.repo) q.set("repo", params.repo);
		if (params.scope) q.set("scope", params.scope);
		return apiFetch<StandardsExport>(`/api/standards/export?${q}`);
	},

	importStandards: (body: StandardsExport | { standards: Partial<CodingStandard>[]; refresh_vectors?: boolean }) =>
		apiFetch<StandardsImportResult>("/api/standards/import", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body)
		}),

	bulkStandardAction: (action: string, ids: string[], updates?: Partial<CodingStandard>) =>
		apiFetch<{ count: number }>("/api/standards/action", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action, ids, updates })
		}),

	export: (repo: string) =>
		apiFetch<{ repo: string; exported_at: string; tasks: Task[]; memories: Memory[] }>(
			`/api/export?repo=${encodeURIComponent(repo)}`
		),

	capabilities: () => apiFetch<ReferenceDataState>("/api/capabilities"),

	/**
	 * TASK-269 / audit F7: ONE aggregate endpoint replacing the ~5×N per-repo
	 * fan-out the Agent Arena fired on load. Returns the same task/claim/
	 * handoff rows the per-repo endpoints returned, merged across all repos.
	 */
	arenaOverview: (signal?: AbortSignal) =>
		apiFetch<{ id?: string; tasks: Task[]; claims: TaskClaim[]; handoffs: Handoff[] }>(
			"/api/dashboard/overview",
			signal ? { signal } : undefined
		),

	callTool: (name: string, args: Record<string, unknown>) =>
		apiFetch<unknown>(`/api/tools/${encodeURIComponent(name)}/call`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(args)
		}),

	// ─── Knowledge Graph ──────────────────────────────────────────────────────

	kgGraph: (
		repo: string,
		params?: { page?: number; pageSize?: number; graphLimit?: number; signal?: AbortSignal; includeEdges?: boolean }
	) => {
		const q = new URLSearchParams({ repo });
		// TASK-213: top-N-by-degree mode sends `graphLimit` INSTEAD of page/pageSize.
		// The server treats graphLimit as authoritative — it bypasses the pageSize
		// clamp ([100,1000]) and forces offset=0, so sending page alongside would
		// be ambiguous. graphLimit mode ignores page/pageSize entirely.
		if (params?.graphLimit) {
			q.set("graphLimit", String(params.graphLimit));
		} else {
			if (params?.page) q.set("page", String(params.page));
			if (params?.pageSize) q.set("pageSize", String(params.pageSize));
		}
		// TASK-198: only an explicit `false` opts out of the edge payload (up to
		// 4000 edges). Absent/true leave the query unchanged (server default).
		if (params?.includeEdges === false) q.set("includeEdges", "false");
		return apiFetch<{ nodes: KGNode[]; edges: KGEdge[]; truncated: boolean; pagination: Pagination }>(
			`/api/kg/graph?${q}`,
			params?.signal ? { signal: params.signal } : undefined
		);
	},

	kgEntityDetail: (name: string) =>
		apiFetch<{ entity: Record<string, unknown>; relations: unknown[]; observations: unknown[] }>(
			`/api/kg/entities/${encodeURIComponent(name)}`
		),

	kgEntities: (repo: string, params?: { type?: string; search?: string; page?: number; pageSize?: number }) => {
		const q = new URLSearchParams({ repo });
		if (params?.type) q.set("type", params.type);
		if (params?.search) q.set("search", params.search);
		if (params?.page) q.set("page", String(params.page));
		if (params?.pageSize) q.set("pageSize", String(params.pageSize));
		return apiFetch<{ entities: KGEntity[]; pagination: Pagination }>(`/api/kg/entities?${q}`);
	},

	kgCreateEntity: (body: { name: string; type?: string; description?: string; repo: string }) =>
		apiFetch<{ id: string }>("/api/kg/entities", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body)
		}),

	kgDeleteEntity: (name: string) =>
		apiFetch<{ success: boolean }>(`/api/kg/entities/${encodeURIComponent(name)}`, { method: "DELETE" }),

	kgCreateRelation: (body: { from_entity: string; to_entity: string; relation_type: string; repo: string }) =>
		apiFetch<{ success: boolean }>("/api/kg/relations", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body)
		}),

	kgDeleteRelation: (body: { from_entity: string; to_entity: string; relation_type: string }) =>
		apiFetch<{ success: boolean }>("/api/kg/relations", {
			method: "DELETE",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body)
		}),

	// ─── Codebase Search ────────────────────────────────────────────────────────

	codebaseSearch: (repo: string, query: string, limit: number = 10) => {
		const q = new URLSearchParams({
			repo,
			query,
			limit: String(limit)
		});
		return apiFetch<{ results: CodeSymbol[] }>(`/api/codebase/search?${q}`);
	},

	// GET /api/codebase/code-search — CODE mode content grep (TASK-317).
	// `content` mirrors the tool's CODE discriminator param (presence ⇒ CODE
	// mode); `query` would route to SEARCH instead, so it is intentionally
	// NOT used here.
	codebaseCodeSearch: (
		repo: string,
		content: string,
		opts?: { regex?: boolean; language?: string; limit?: number; offset?: number }
	) => {
		const q = new URLSearchParams({ repo, content });
		if (opts?.regex) q.set("regex", "true");
		if (opts?.language) q.set("language", opts.language);
		if (opts?.limit != null) q.set("limit", String(opts.limit));
		if (opts?.offset != null) q.set("offset", String(opts.offset));
		return apiFetch<CodeSearchResult>(`/api/codebase/code-search?${q}`);
	},

	// ─── Codebase Index Status ──────────────────────────────────────────────────

	codebaseIndexStatus: async (repo: string) => {
		const q = new URLSearchParams({ repo });
		const raw = await apiFetch<Record<string, unknown>>(`/api/codebase/index-status?${q}`);
		const progress = raw.progress as Record<string, unknown> | undefined;
		// Normalize backend camelCase → frontend snake_case
		return {
			indexed: (raw.isIndexed as boolean) ?? false,
			file_count: (raw.totalFiles as number) ?? 0,
			symbol_count: (raw.totalSymbols as number) ?? 0,
			last_indexed_at: (raw.lastIndexedAt as string) ?? null,
			stale: raw.stale as boolean | undefined,
			staleRatio: raw.staleRatio as number | undefined,
			indexing: {
				in_progress: (raw.isIndexing as boolean) ?? false,
				files_parsed: (progress?.current as number) ?? 0,
				total_files: (progress?.total as number) ?? 0
			}
		} as CodebaseIndexStatus;
	},

	codebaseReindex: (repo: string) => {
		return apiFetch<{ success: boolean; message: string }>("/api/codebase/index", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ repo })
		});
	},

	// ─── Codebase Architecture ─────────────────────────────────────────────────

	codebaseArchitecture: (repo: string, depth: number = 3, includeSymbolCounts: boolean = true) => {
		const q = new URLSearchParams({
			repo,
			depth: String(depth),
			includeSymbolCounts: String(includeSymbolCounts)
		});
		return apiFetch<{ root: Record<string, unknown>; summary: Record<string, unknown>; deadCode?: DeadCodeBlock }>(
			`/api/codebase/architecture?${q}`
		);
	},

	// ─── Codebase Trace ─────────────────────────────────────────────────────

	codebaseTrace: (repo: string, name: string) => {
		const q = new URLSearchParams({
			repo,
			name,
			includeReferences: "true"
		});
		return apiFetch<TraceResult>(`/api/codebase/trace?${q}`);
	},

	// ─── Codebase File Symbols ─────────────────────────────────────────────

	codebaseSymbols: (repo: string, filePath: string) => {
		const q = new URLSearchParams({
			repo,
			filePath
		});
		return apiFetch<{ file: Record<string, unknown>; symbols: CodeSymbol[]; total: number }>(
			`/api/codebase/symbols?${q}`
		).then((res) => res.symbols ?? []);
	},

	// ─── Queue Admin ──────────────────────────────────────────────────────────
	// TASK-297 failed-job admin view. `status` values on the wire are the
	// LITERAL QueueJobStatus enum names (pending|claimed|done|poison) — the UI
	// layer translates `poison` to a "Failed" label, the enum is never renamed.
	// `?repo=` scope mirrors the other dashboard controllers (KG/Codebase/
	// System): present → restricted to that entity_repo; absent → global view.

	queueStatus: () => apiFetch<QueueStatus>("/api/queue/status"),

	queueJobs: (params: { repo: string; status?: string; page?: number; pageSize?: number }) => {
		const q = new URLSearchParams({ repo: params.repo });
		if (params.status) q.set("status", params.status);
		if (params.page) q.set("page", String(params.page));
		if (params.pageSize) q.set("pageSize", String(params.pageSize));
		return apiFetch<{ jobs: QueueJob[]; pagination: Pagination }>(`/api/queue/jobs?${q}`);
	},

	queueRetryJob: (id: string, repo?: string) => {
		const q = repo ? `?repo=${encodeURIComponent(repo)}` : "";
		return apiFetch<QueueJob>(`/api/queue/jobs/${encodeURIComponent(id)}/retry${q}`, { method: "POST" });
	},

	queueClearJob: (id: string, repo?: string) => {
		const q = repo ? `?repo=${encodeURIComponent(repo)}` : "";
		return apiFetch<{ id: string; message: string }>(`/api/queue/jobs/${encodeURIComponent(id)}/clear${q}`, {
			method: "POST"
		});
	},

	queueRetryAll: (repo?: string) => {
		const q = repo ? `?repo=${encodeURIComponent(repo)}` : "";
		return apiFetch<{ id: string; retried: number }>(`/api/queue/retry-all${q}`, { method: "POST" });
	}
};

// ─── Codebase Index Types ──────────────────────────────────────────────────────

/**
 * A queue job as served by GET /api/queue/jobs (TASK-296/297).
 * `status` is the LITERAL `QueueJobStatus` enum value (`pending|claimed|done|
 * poison`) — the UI renders `poison` as "Failed", the enum is never renamed.
 */
export interface QueueJob {
	id: string;
	entity_kind: string;
	entity_id: string;
	entity_repo: string;
	status: "pending" | "claimed" | "done" | "poison";
	attempts: number;
	max_attempts: number;
	enqueued_at: string;
	processed_at: string;
	last_error: string | null;
}

/**
 * Worker + queue observability snapshot from GET /api/queue/status
 * (`embeddingWorker.getStats()`). `poison` rows are the failed-job count the
 * admin view surfaces as "Failed".
 */
export interface QueueStatus {
	pending: number;
	claimed: number;
	done: number;
	poison: number;
	total: number;
	processed: number;
	failed: number;
	poisoned: number;
	lastBatchSize: number;
	lastRunAt: string | null;
	running: boolean;
	started: boolean;
	modelReady: boolean;
	pollIntervalMs: number;
	batchSize: number;
	leaseMs: number;
	embedLatency: {
		count: number;
		avgMs: number;
		p50Ms: number;
		p95Ms: number;
		maxMs: number;
	};
}

export interface CodebaseIndexStatus {
	indexed: boolean;
	symbol_count: number;
	file_count: number;
	last_indexed_at: string | null;
	stale?: boolean;
	staleRatio?: number;
	indexing?: {
		in_progress: boolean;
		files_parsed: number;
		total_files: number;
	};
}

export interface TraceReference {
	filePath: string;
	startLine: number;
	startCol: number;
	endLine: number;
	endCol: number;
	context: string;
	/**
	 * Edge kind — 'call' | 'instantiation' | 'import' | 'extends' | 'implements'
	 * (table-backed references, v23 / TASK-299-301). Absent on legacy
	 * in-memory references (doc_comment scan).
	 */
	kind?: string;
	/** Enclosing function/method at the call / heritage site, when determinable. */
	callerName?: string | null;
	/** File path of the referenced symbol when resolvable (table-backed, v23). */
	targetFile?: string | null;
	/** codebase_symbols(id) of the referenced symbol when resolvable (table-backed, v23). */
	targetSymbolId?: string | null;
}

/**
 * Raw `codebase_symbols` row as served by the codebase API (snake_case —
 * mirrors src/mcp/types/codebase-symbol.ts CodebaseSymbol). TRACE surfaces
 * these verbatim for `children`.
 */
export interface CodebaseSymbolRow {
	id: string;
	repo: string;
	file_path: string;
	name: string;
	kind: string;
	exported: boolean;
	default_export: boolean;
	start_line: number | null;
	start_col: number | null;
	end_line: number | null;
	end_col: number | null;
	signature: string | null;
	doc_comment: string | null;
	parent_symbol_id: string | null;
}

/** Enclosing container of a traced symbol, resolved from parent_symbol_id (TASK-300). */
export interface TraceParent {
	id: string;
	name: string;
	kind: string;
	filePath: string;
	line: number | null;
}

export interface TraceResult {
	symbol: CodeSymbol;
	definition: {
		file: string;
		line: number;
		column: number;
		endLine: number;
		endColumn: number;
	};
	references: TraceReference[];
	exportChain: {
		exported: boolean;
		defaultExport: boolean;
	};
	/** Enclosing container (e.g. class → method). Null for top-level symbols or when absent. */
	parent?: TraceParent | null;
	/** Direct children (e.g. a class's methods/properties), ordered by start line (TASK-300). */
	children?: CodebaseSymbolRow[];
	/** Candidates when the trace was ambiguous (camelCase projection — aligned
	 *  with codebase.read.ts TRACE structuredContent: name/kind/file/line/
	 *  exported, NOT raw rows). */
	disambiguation?: TraceDisambiguationCandidate[];
}

/** A disambiguation candidate for an ambiguous TRACE, as served by the API. */
export interface TraceDisambiguationCandidate {
	name: string;
	kind: string;
	file: string;
	line: number | null;
	exported: boolean;
}
