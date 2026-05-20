# Tool Reference & Usage Guide

A practical guide to the tools this MCP server exposes to AI agents. Each tool is grouped by domain with usage patterns and examples.

---

## Memory Tools (Durable Knowledge)

These tools manage your project's long-term memory: architectural decisions, code facts, patterns, and mistakes.

### `memory-store` — Store a New Memory

Store what you learn so it persists across sessions.

```json
{
  "type": "decision",
  "title": "Use SQLite for local persistence",
  "content": "We chose SQLite over JSON files because...",
  "importance": 4,
  "agent": "assistant",
  "model": "gpt-4",
  "scope": { "repo": "my-project" },
  "tags": ["database", "architecture"]
}
```

**Fields:**
- `type` (`code_fact`, `decision`, `mistake`, `pattern`, `task_archive`) — what kind of knowledge this is
- `importance` (1-5) — how critical this is; higher = slower to decay
- `scope.repo` — which project this belongs to
- `tags` — technology labels for cross-project discoverability

### `memory-search` — Find Relevant Memories

Navigation layer. Returns a compact table of matching memory IDs (not full content).

```json
{
  "query": "authentication flow",
  "repo": "my-project",
  "limit": 5
}
```

**Pro tips:**
- Use `current_tags: ["react", "typescript"]` to find tech-stack relevant memories from other projects.
- Use `types: ["decision", "pattern"]` to filter by knowledge type.
- Use `include_archived: true` to search archived/decayed memories too.

### `memory-detail` — Read Full Memory Content

After search returns pointer rows, fetch the full content:

```json
{ "code": "Q7PXYE" }
```

Supports lookup by `id` (UUID) or `code` (short code like `Q7PXYE`).

### `memory-update` — Edit an Existing Memory

```json
{
  "code": "Q7PXYE",
  "importance": 5,
  "status": "archived"
}
```

### `memory-acknowledge` — Report Memory Utility

Mandatory after using a memory to generate code. Helps the decay system know what's useful.

```json
{
  "code": "Q7PXYE",
  "status": "used",
  "application_context": "Used this pattern when implementing the auth middleware"
}
```

### `memory-delete` — Remove Memories

Single or bulk:

```json
{ "code": "Q7PXYE" }
```

```json
{ "codes": ["Q7PXYE", "ZZUHFH"] }
```

### `memory-recap` — Dashboard Overview

Returns stats (counts by type) and a pointer table of top memories.

```json
{ "repo": "my-project" }
```

### `memory-summarize` — Update Repo Summary

Keeps a high-level project summary that agents can quickly reference:

```json
{
  "repo": "my-project",
  "signals": ["Microservices migration in progress", "PostgreSQL chosen as primary DB"]
}
```

### `memory-synthesize` — Ask Questions About Your Knowledge

Uses your AI client's own LLM to answer questions grounded in local memories:

```json
{
  "repo": "my-project",
  "objective": "What do we know about authentication?"
}
```

---

## Task Tools (Work Management)

Track work items through their lifecycle: Backlog → Pending → In Progress → Completed.

### `task-create` — Register a Task

```json
{
  "repo": "my-project",
  "task_code": "AUTH-001",
  "phase": "implementation",
  "title": "Implement JWT middleware",
  "description": "1. Create middleware class\n2. Add token validation\n3. Write tests",
  "priority": 4,
  "status": "pending"
}
```

Bulk mode:
```json
{
  "repo": "my-project",
  "tasks": [
    { "task_code": "AUTH-001", "phase": "impl", "title": "...", "description": "..." },
    { "task_code": "AUTH-002", "phase": "impl", "title": "...", "description": "..." }
  ]
}
```

### `task-list` — Find Tasks

```json
{ "repo": "my-project" }
```

Filters by default to `in_progress` and `pending`. Use `status` for custom filters:
```json
{ "repo": "my-project", "status": "backlog", "limit": 20 }
```

### `task-detail` — Read Full Task

```json
{ "repo": "my-project", "task_code": "AUTH-001" }
```

Returns full description, comments, coordination state (claims, handoffs), and status history.

### `task-update` — Progress a Task

```json
{
  "repo": "my-project",
  "task_code": "AUTH-001",
  "status": "in_progress",
  "comment": "Starting implementation"
}
```

When completing:
```json
{
  "repo": "my-project",
  "task_code": "AUTH-001",
  "status": "completed",
  "est_tokens": 1500,
  "commit_id": "abc123",
  "changed_files": ["src/middleware/auth.ts", "tests/auth.test.ts"],
  "comment": "All tests passing"
}
```

**Status transitions allowed:**
- backlog → pending, in_progress
- pending → in_progress, blocked
- in_progress → completed, blocked, canceled
- blocked → in_progress
- completed/canceled → terminal (no outgoing)

Bulk update:
```json
{
  "repo": "my-project",
  "ids": ["uuid-1", "uuid-2"],
  "status": "blocked",
  "comment": "Blocked by missing API key"
}
```

### `task-delete` — Remove Tasks

```json
{ "repo": "my-project", "task_code": "AUTH-001" }
```

---

## Standard Tools (Coding Standards Library)

Manage reusable coding rules enforced across projects.

### `standard-search` — Find Applicable Standards

MANDATORY call before implementing anything. Returns matching coding standards:

```json
{ "stack": ["react", "typescript"] }
```

### `standard-detail` — Read Full Standard

```json
{ "code": "J78C5E" }
```

### `standard-store` — Save a New Standard

```json
{
  "name": "React Component Naming",
  "content": "Use PascalCase for component filenames matching the export name.",
  "tags": ["naming", "react"],
  "metadata": { "source": "team-agreement" },
  "stack": ["react"],
  "language": "typescript",
  "is_global": true
}
```

### `standard-update` — Update a Standard

```json
{
  "code": "J78C5E",
  "name": "React Component Naming (Updated)",
  "version": "2.0.0"
}
```

### `standard-delete` — Remove Standards

```json
{ "code": "J78C5E" }
```

---

## Coordination Tools (Agent Handoff)

Used when multiple agents need to transfer context.

### `handoff-create` — Transfer Unfinished Work

```json
{
  "repo": "my-project",
  "from_agent": "agent-a",
  "to_agent": "agent-b",
  "task_code": "AUTH-001",
  "summary": "Auth middleware needs review",
  "context": {
    "next_steps": ["Review the JWT validation logic", "Add refresh token endpoint"],
    "blockers": ["Awaiting secrets manager access"]
  }
}
```

### `handoff-list` — Inspect Handoff Queue

```json
{ "repo": "my-project", "status": "pending" }
```

### `handoff-update` — Close a Handoff

```json
{ "id": "handoff-uuid", "status": "accepted" }
```

### `task-claim` — Take Ownership

```json
{
  "repo": "my-project",
  "task_code": "AUTH-001",
  "agent": "agent-b",
  "role": "maintainer"
}
```

### `claim-list` — See Who Owns What

```json
{ "repo": "my-project" }
```

### `claim-release` — Release Ownership

```json
{ "repo": "my-project", "task_code": "AUTH-001", "agent": "agent-b" }
```

---

## Common Agent Workflows

### Starting a New Session
```
1. task-list (repo: my-project)
2. Pick ONE task from the list
3. task-claim (task_code: ..., agent: ..., role: ...)
4. task-detail (task_code: ...)
5. standard-search (stack: [relevant tech])
6. Work on the task
7. task-update (status: completed, est_tokens: N)
```

### Debugging a Bug
```
1. memory-search (query: error description, repo: ...)
2. memory-detail on relevant results
3. Fix the issue
4. memory-store (type: mistake, about what went wrong)
5. task-update (if a task was tracking the fix)
```

### Knowledge Transfer Between Agents
```
1. task-detail / memory-search to gather context
2. handoff-create with next_steps and blockers
3. The receiving agent sees handoff-list and picks it up
4. Receiving agent calls handoff-update (status: accepted)
```

### Onboarding to a New Project
```
1. memory-synthesize (objective: "What is this project about?")
2. memory-recap to see top memories
3. task-list to see what's pending
4. standard-search for coding rules
5. Start working
```

---

## Tool Groups Summary

| Group | Tools | Purpose |
|-------|-------|---------|
| Memory | store, search, detail, update, acknowledge, delete, recap, summarize, synthesize | Durable long-term knowledge |
| Task | create, list, detail, update, delete | Work item lifecycle |
| Standard | store, search, detail, update, delete | Reusable coding rules |
| Coordination | handoff-create, handoff-list, handoff-update, task-claim, claim-list, claim-release | Multi-agent orchestration |
