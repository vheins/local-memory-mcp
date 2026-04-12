# API Specification: Dashboard Memories

This document outlines the REST interfaces for interacting with the semantic memory store through the dashboard backend.

## 1. Collection Management

### 1.1 `GET /api/memories`
Retrieves a paginated list of memories with advanced filtering and sorting.
- **Query Parameters**:
  - `repo` (string, required): Target repository.
  - `type` (enum, optional): Memory category (e.g., `decision`, `mistake`).
  - `search` (string, optional): Full-text search string.
  - `minImportance` (number, optional): Minimum importance score (1-5).
  - `maxImportance` (number, optional): Maximum importance score (1-5).
  - `sortBy` (string, optional): Field to sort by (e.g., `created_at`, `importance`).
  - `sortOrder` (enum, default: `desc`): `asc` or `desc`.
  - `page` (number, default: 1): Current page.
  - `pageSize` (number, default: 25): Items per page (max 100).
- **Response**:
  ```json
  {
    "jsonapi": { "version": "1.1" },
    "data": [
      {
        "type": "memory",
        "id": "uuid-123",
        "attributes": {
          "type": "decision",
          "title": "...",
          "content": "...",
          "importance": 4,
          "created_at": "...",
          "updated_at": "..."
        }
      }
    ],
    "meta": {
      "page": 1,
      "pageSize": 25,
      "totalItems": 42,
      "totalPages": 2
    }
  }
  ```

### 1.2 `POST /api/memories/bulk-import`
Batch imports memory objects into a specific repository. 
- **Request Body**:
  - `items` (array, required): Array of memory objects.
- **Response**:
  ```json
  {
    "jsonapi": { "version": "1.1" },
    "data": {
      "type": "status",
      "id": "system",
      "attributes": { "count": 10 }
    }
  }
  ```

### 1.3 `POST /api/memories/bulk-action`
Applies a single operation to multiple memories identified by their IDs.
- **Request Body**:
  - `updates` (object, optional): Field updates to apply.
- **Response**:
  ```json
  {
    "jsonapi": { "version": "1.1" },
    "data": {
      "type": "status",
      "id": "system",
      "attributes": { "count": 5 }
    }
  }
  ```

## 2. Resource Operations

### 2.1 `GET /api/memories/:id`
Fetch a single memory entry with detailed statistics.
- **Path Parameters**:
  - `id` (UUID, required)
- **Response**:
  ```json
  {
    "jsonapi": { "version": "1.1" },
    "data": {
      "type": "memory",
      "id": "uuid-123",
      "attributes": {
        "type": "...",
        "title": "...",
        "content": "...",
        "importance": 5,
        "created_at": "..."
      }
    }
  }
  ```

### 2.2 `POST /api/memories`
Creates a single memory record.
- **Request Body**:
  - `repo` (string, required)
  - `type` (string, required)
  - `title` (string, optional)
  - `content` (string, required)
- **Response**:
  ```json
  {
    "jsonapi": { "version": "1.1" },
    "data": {
      "type": "memory",
      "id": "uuid-456",
      "attributes": {}
    }
  }
  ```

### 2.3 `PUT /api/memories/:id`
Partially updates a memory record.
- **Request Body**: Any top-level memory fields (e.g., `title`, `content`).
- **Response**:
  ```json
  {
    "jsonapi": { "version": "1.1" },
    "data": {
      "type": "status",
      "id": "system",
      "attributes": { "message": "Updated" }
    }
  }
  ```

### 2.4 `DELETE /api/memories/:id`
Hard deletes a memory record from the database.
- **Response**:
  ```json
  {
    "jsonapi": { "version": "1.1" },
    "data": {
      "type": "status",
      "id": "system",
      "attributes": { "message": "Deleted" }
    }
  }
  ```
