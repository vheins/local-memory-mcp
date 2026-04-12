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

function deserialize(body: any): any {
  if (!body || !body.data) return body;
  const { data, meta } = body;
  
  const processItem = (item: any) => {
    if (item.id === 'system' && item.type === 'status') return item.attributes;
    return { id: item.id, ...item.attributes };
  };

  if (Array.isArray(data)) {
    const items = data.map(processItem);
    const result: any = {};
    if (meta) result.pagination = meta;
    
    // Feature-specific hydration for backward compatibility
    if (data[0]?.type === 'repository') {
      return { repos: items.map(i => i.name || i.repo || i.id) };
    }
    
    const rootKey = data[0]?.type ? `${data[0].type}s` : 'data';
    result[rootKey] = items;
    return result;
  }
  
  const item = processItem(data);
  // Unify successful responses that were previously { success: true, ... }
  if (data.type === 'status') return { success: true, ...item };
  return item;
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

  bulkImportMemories: (repo: string, items: any[]) =>
    apiFetch<any>('/api/memories/bulk-import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repo, items }) }),

  bulkMemoryAction: (action: string, ids: string[], updates?: any) =>
    apiFetch<any>('/api/memories/bulk-action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ids, updates }) }),

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

  bulkImportTasks: (repo: string, items: any[]) =>
    apiFetch<any>('/api/tasks/bulk-import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repo, items }) }),

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

  callTool: (name: string, args: any) =>
    apiFetch<any>(`/api/tools/${encodeURIComponent(name)}/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args)
    }),
};
