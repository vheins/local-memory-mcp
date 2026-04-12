import type { Memory, Task, RepoMeta, DashboardStats, RecentAction, TaskTimeStats, HealthData } from "./stores";

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
	attributes?: Record<string, any>;
}

interface JsonApiBody {
	data: JsonApiItem | JsonApiItem[];
	meta?: any;
}

function deserialize(body: JsonApiBody | any): any {
	if (!body || !body.data) return body;
	const { data, meta } = body as JsonApiBody;

	const processItem = (item: JsonApiItem) => {
		const attr = item.attributes || {};
		// Inject success for status responses
		if (item.type === "status" && (attr as any).success === undefined) {
			(attr as any).success = true;
		}
		// Return flat object (preserving ID except for generic 'system' IDs)
		if (item.id === "system") return attr;
		return { id: item.id, ...attr };
	};

	if (Array.isArray(data)) {
		const items = data.map(processItem);
		const result: Record<string, any> = {};
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
		return apiFetch<{ actions: RecentAction[]; pagination: any }>(url);
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
		return apiFetch<{ memories: Memory[]; pagination: any }>(`/api/memories?${q}`);
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

	bulkImportMemories: (repo: string, items: any[]) =>
		apiFetch<{ count: number }>("/api/memories/import", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ repo, items })
		}),

	bulkMemoryAction: (action: string, ids: string[], updates?: any) =>
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
		return apiFetch<{ tasks: Task[]; pagination: any }>(`/api/tasks?${q}`);
	},

	taskById: (id: string) => apiFetch<Task>(`/api/tasks/${id}`),

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

	bulkImportTasks: (repo: string, items: any[]) =>
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

	export: (repo: string) => apiFetch<{ url: string }>(`/api/export?repo=${encodeURIComponent(repo)}`),

	capabilities: () => apiFetch<{ capabilities: string[] }>("/api/capabilities"),

	callTool: (name: string, args: Record<string, any>) =>
		apiFetch<{ result: any }>(`/api/tools/${encodeURIComponent(name)}/call`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(args)
		})
};
