# API Specification: Internal Dashboard API

This document describes the private HTTP API used by the Svelte frontend to communicate with the `dashboard-server`.

## 1. Endpoints

### 1.1 `GET /api/repos`
Retrieves a list of all repositories currently present in the database.
- **Response:** `Array<{ name: string, taskCount: number }>`

### 1.2 `GET /api/memories?repo={repo}`
Lists memories for a specific repository.
- **Query Params:** `repo` (string), `limit` (number), `offset` (number).
- **Response:** `Array<MemoryObject>`

### 1.3 `GET /api/tasks?repo={repo}`
Lists tasks for a specific repository.
- **Response:** `Array<TaskObject>`

### 1.4 `POST /api/tasks/:id/status`
Updates the status of a specific task.
- **Body:** `{ status: string }`
- **Response:** `{ success: boolean }`

### 1.5 `DELETE /api/memories/:id`
Deletes a memory entry.
- **Response:** `{ success: boolean }`

## 2. Security
- **Access Control:** Restricted to local loopback interface only. No authentication tokens required for local dev use.
