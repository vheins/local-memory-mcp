import type {
	Memory,
	Task,
	CodingStandard,
	RepoMeta,
	DashboardStats,
	RecentAction,
	TaskTimeStats,
	HealthData,
	Pagination,
	ReferenceDataState
} from "./stores";

// ─── API helpers ─────────────────────────────────────────────────────────────

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
	const res = await fetch(url, options);
	if (!res.ok) {
		const err = await res.json().catch(() => ({ error: res.statusText }));
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

	return processItem(data as JsonApiItem);
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

	taskByCode: (repo: string, task_code: string) => apiFetch<Task>(`/api/tasks/by-code?repo=${encodeURIComponent(repo)}&task_code=${encodeURIComponent(task_code)}`),

	taskTimeStats: (repo: string) => apiFetch<TaskTimeStats>(`/api/tasks/stats/time?repo=${encodeURIComponent(repo)}`),

	updateTask: (id: string, updates: Partial<Task>) =>
		apiFetch<{ success: boolean }>(`/api/tasks/${id}`, {
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

	updateTaskComment: (id: string, comment: string) =>
		apiFetch<{ success: boolean }>(`/api/tasks/comments/${id}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ comment })
		}),

	deleteTaskComment: (id: string) => apiFetch<{ success: boolean }>(`/api/tasks/comments/${id}`, { method: "DELETE" }),

	standards: (params: { repo?: string; query?: string; language?: string; stack?: string; tags?: string; is_global?: boolean; page?: number; pageSize?: number }) => {
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

	export: (repo: string) =>
		apiFetch<{ repo: string; exported_at: string; tasks: Task[]; memories: Memory[] }>(
			`/api/export?repo=${encodeURIComponent(repo)}`
		),

	capabilities: () => apiFetch<ReferenceDataState>("/api/capabilities"),

	callTool: (name: string, args: Record<string, unknown>) =>
		apiFetch<unknown>(`/api/tools/${encodeURIComponent(name)}/call`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(args)
		})
};
