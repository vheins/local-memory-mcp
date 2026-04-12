# API Specification: Internal Dashboard API

This document describes the private HTTP API used by the Svelte frontend to communicate with the `dashboard-server`.

## 1. System Endpoints

### 1.1 `GET /api/health`
- **Response:** `{ connected: boolean, uptime: number, version: string, memoryCount: number, dbPath: string }`

### 1.2 `GET /api/stats?repo={repo}`
- **Response:** Returns high-level counters (Memories, Tasks, Activity) for the repo or global context.

### 1.3 `GET /api/capabilities`
- **Response:** Returns a full registry of all registered `tools`, `resources`, and `prompts`.

## 2. Memory Endpoints

### 2.1 `GET /api/memories`
- **Params:** `repo` (required), `type`, `search`, `minImportance`, `page`, `pageSize`.
- **Response:** `{ memories: Array<Memory>, pagination: { totalItems, totalPages } }`

### 2.2 `POST /api/memories/bulk-import`
- **Body:** `{ items: Array<PartialMemory>, repo: string }`

### 2.3 `POST /api/memories/bulk-action`
- **Body:** `{ action: 'delete'|'update'|'archive', ids: Array<string>, updates?: object }`

## 3. Task Endpoints

### 3.1 `GET /api/tasks`
- **Params:** `repo` (required), `status` (comma-separated), `search`.

### 3.2 `PUT /api/tasks/:id`
- **Body:** Any field updates + optional `comment`.
- **Note:** Updates to `status` automatically generate a task comment in the audit trail.

### 3.3 `GET /api/tasks/stats/time?repo={repo}`
- **Response:** Breakdown of completion times (Daily/Weekly/Monthly) and comparison history.

## 4. MCP Proxy

### 4.1 `POST /api/tools/:name/call`
- Proxies a tool call directly to the internal `MCPClient`.
- **Body:** Tool arguments.
