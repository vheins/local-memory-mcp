// ─── API helpers ─────────────────────────────────────────────────────────────

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── API ─────────────────────────────────────────────────────────────────────

export const api = {
  health: () => apiFetch<any>('/api/health'),

  repos: () => apiFetch<{ repos: any[] }>('/api/repos'),

  stats: (repo?: string) => {
    const q = repo ? `?repo=${encodeURIComponent(repo)}` : '';
    return apiFetch<any>(`/api/stats${q}`);
  },

  recentActions: (repo: string | null, page: number, pageSize: number) => {
    let url = `/api/recent-actions?page=${page}&pageSize=${pageSize}`;
    if (repo) url += `&repo=${encodeURIComponent(repo)}`;
    return apiFetch<any>(url);
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
    if (params.type) q.set('type', params.type);
    if (params.search) q.set('search', params.search);
    if (params.minImportance != null) q.set('minImportance', String(params.minImportance));
    if (params.maxImportance != null) q.set('maxImportance', String(params.maxImportance));
    if (params.sortBy) q.set('sortBy', params.sortBy);
    if (params.sortOrder) q.set('sortOrder', params.sortOrder);
    if (params.page) q.set('page', String(params.page));
    if (params.pageSize) q.set('pageSize', String(params.pageSize));
    return apiFetch<any>(`/api/memories?${q}`);
  },

  memoryById: (id: string) => apiFetch<any>(`/api/memories/${id}`),

  createMemory: (body: any) =>
    apiFetch<any>('/api/memories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),

  updateMemory: (id: string, updates: any) =>
    apiFetch<any>(`/api/memories/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) }),

  deleteMemory: (id: string) =>
    apiFetch<any>(`/api/memories/${id}`, { method: 'DELETE' }),

  tasks: (params: {
    repo: string;
    status?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  }) => {
    const q = new URLSearchParams({ repo: params.repo });
    if (params.status) q.set('status', params.status);
    if (params.search) q.set('search', params.search);
    if (params.page) q.set('page', String(params.page));
    if (params.pageSize) q.set('pageSize', String(params.pageSize));
    return apiFetch<any>(`/api/tasks?${q}`);
  },

  taskById: (id: string) => apiFetch<any>(`/api/tasks/${id}`),

  taskTimeStats: (repo: string) =>
    apiFetch<any>(`/api/tasks/stats/time?repo=${encodeURIComponent(repo)}`),

  updateTask: (id: string, updates: any) =>
    apiFetch<any>(`/api/tasks/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    }),

  createTask: (body: any) =>
    apiFetch<any>('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),

  deleteTask: (id: string) =>
    apiFetch<any>(`/api/tasks/${id}`, { method: 'DELETE' }),

  updateTaskComment: (id: string, comment: string) =>
    apiFetch<any>(`/api/task-comments/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment }),
    }),

  deleteTaskComment: (id: string) =>
    apiFetch<any>(`/api/task-comments/${id}`, { method: 'DELETE' }),

  export: (repo: string) =>
    apiFetch<any>(`/api/export?repo=${encodeURIComponent(repo)}`),

  capabilities: () => apiFetch<any>('/api/capabilities'),
};
