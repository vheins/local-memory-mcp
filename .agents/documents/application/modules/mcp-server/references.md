# Module Documentation: Reference Catalog (Resources & Prompts)

## Header & Navigation

- [Module Overview](overview.md)
- [Core API](../../api/mcp-server/api-core.md)

## Responsibility

The Reference Catalog exposes the internal knowledge and templates of the system through standard MCP primitives. This allows agents to "self-discover" project status and follow established behavioral patterns.

## 1. Resources

Resources provide read-only access to specialized data views and global knowledge using a repository-scoped URI scheme (`repository://{owner}/{name}/...`).

### Global Resources

- **URI**: `repository://index`
  - List of all available repositories including memory counts, task counts, and last activity timestamps.

### Knowledge Resources

- **URI**: `repository://{owner}/{name}/memories`
  - Paginated list of active memories for a repository. Supports `?search=`, `?type=`, `?tag=` filters.
- **URI**: `memory://{id}`
  - Direct access to a specific memory entry (full details and statistics).
- **URI**: `repository://{owner}/{name}/summary`
  - High-level global summary for a repository (updated via `memory-summarize`).

### Task Resources

- **URI**: `repository://{owner}/{name}/tasks`
  - Paginated list of tasks for a repository. Supports `?status=`, `?priority=` filters.
- **URI**: `task://{id}`
  - Direct access to a specific task (full description and comments).

### Standard Resources

- **URI**: `repository://{owner}/{name}/standards`
  - Paginated list of coding standards for a repository.

### Audit Resources

- **URI**: `repository://{owner}/{name}/actions`
  - Paginated stream of all agent tool actions logged within a repository.
- **URI**: `action://{id}`
  - Direct access to a specific action audit log entry.

## 2. Tools (Methods)

Tools are the primary operational interface for agents. The server registers ~34 tools across 7 categories:

### Discovery & Control

- **`tools/list`**: Returns all registered tool definitions with input schemas. Supports pagination.
- **`tools/call`**: Core gateway for all modifications and complex queries.
- **`completion/complete`**: Provides completion suggestions for tool arguments (repos, tags, task codes, file paths).

### Knowledge Management (Memory)

| Tool                 | Description                                                                                       |
| :------------------- | :------------------------------------------------------------------------------------------------ |
| `memory-store`       | Store a new knowledge entry. Types: `code_fact`, `decision`, `mistake`, `pattern`, `task_archive` |
| `memory-search`      | NAVIGATION LAYER: Returns pointer table `[id, title, type, importance]`                           |
| `memory-detail`      | Fetch full content for a specific memory by ID/code                                               |
| `memory-acknowledge` | (MANDATORY) Mark memory as used/irrelevant after code gen                                         |
| `memory-update`      | Update an existing memory entry                                                                   |
| `memory-delete`      | Soft-delete one or more memory entries                                                            |
| `memory-summarize`   | Update per-repo global summary                                                                    |
| `memory-recap`       | AGGREGATED OVERVIEW: Stats + top memories pointer table                                           |
| `memory-synthesize`  | Advanced reasoning using client sampling                                                          |

### Upstream Compatibility (Aliases)

| Alias            | Maps To                 |
| :--------------- | :---------------------- |
| `remember_fact`  | `memory-store` (single) |
| `remember_facts` | `memory-store` (bulk)   |
| `recall`         | `memory-search`         |
| `forget`         | `memory-delete`         |

### Task Management

| Tool                      | Description                                                      |
| :------------------------ | :--------------------------------------------------------------- |
| `task-list`               | PRIMARY navigation: tabular list with status/phase/query filters |
| `task-create`             | Register one or more tasks (single or bulk)                      |
| `task-create-interactive` | Guided creation via elicitation fallback                         |
| `task-detail`             | Fetch full task with comments                                    |
| `task-update`             | Update task(s) with transition validation                        |
| `task-delete`             | Hard delete task(s)                                              |
| `task-search`             | Dedicated search by title/code                                   |

### Coding Standards

| Tool              | Description                        |
| :---------------- | :--------------------------------- |
| `standard-store`  | Store an atomic coding standard    |
| `standard-search` | MANDATORY pre-implementation check |
| `standard-update` | Update existing standard           |
| `standard-delete` | Delete standard(s)                 |
| `standard-detail` | Fetch full standard detail         |

### Coordination (Handoffs & Claims)

| Tool             | Description                                   |
| :--------------- | :-------------------------------------------- |
| `handoff-create` | Create a pending handoff for context transfer |
| `handoff-list`   | List handoffs by repo/status/agent            |
| `handoff-update` | Close or reclassify a handoff                 |
| `task-claim`     | Record task ownership in claims table         |
| `claim-list`     | List active claims                            |
| `claim-release`  | Release a claim                               |

### Knowledge Graph

| Tool                 | Description                                        |
| :------------------- | :------------------------------------------------- |
| `create-entity`      | Create a KG entity node                            |
| `delete-entity`      | Delete entity (cascades to relations/observations) |
| `create-relation`    | Create a directed edge between entities            |
| `delete-relation`    | Delete a relation                                  |
| `delete-observation` | Delete an observation by ID                        |
| `kg-backfill`        | Scan memories to auto-extract entities             |

### Agent Tools

| Tool                | Description                            |
| :------------------ | :------------------------------------- |
| `agent-context`     | Contextual recall for active session   |
| `decision-log`      | Structured decision recording          |
| `session-summarize` | Persist session as task_archive memory |

### Internal Handling Logic

- **Write Lock**: All mutation tools run under `WriteLock.withLock()` using `proper-lockfile`.
- **Audit Logs**: Every successful tool invocation is recorded in `action_log`.
- **Scope Injection**: `owner`, `repo`, `folder` auto-injected from session context.
- **Response Pattern**: All tools return `structuredContent` for machine parsing + `content` for LLM text.

## 3. Prompts

The server provides 31 prompt templates that guide agent behavior for specific workflows.

### Core Lifecycle Prompts

- **`memory-agent-core`**: Essential behavioral contract for memory-aware agents. Instructs on `memory-search`, `memory-acknowledge`, and conflict handling.
- **`project-briefing`**: Onboarding template for new sessions. Guides agents to discover recent knowledge, pending tasks, and key decisions.
- **`tool-usage-guidelines`**: Standards for tool usage and data integrity.

### Engineering Role Prompts

- **`architecture-design`**: System architect for ADR generation and component planning.
- **`business-analyst`**: Bridge business needs with technical solutions.
- **`senior-code-review`**: Principal reviewer for code compliance against stored standards.
- **`security-analyst`**: Security assessment and threat modeling.
- **`qa-analyst`**: Test strategy design and quality assurance.
- **`data-analyst`**: Data analysis and insight generation.
- **`scrum-master`**: Scrum ceremony facilitation and blocker removal.

### Workflow Prompts

- **`task-memory-executor`**: Execute tasks with memory and standard enforcement.
- **`fix-suggestion`**: Propose and validate fixes with before/after code.
- **`root-cause-analysis`**: Structured bug/incident investigation.
- **`learning-retrospective`**: Capture lessons and update memory.
- **`technical-planning`**: Feature planning with task decomposition.
- **`session-planner`**: Break objectives into atomic tasks.
- **`sentinel-issue-resolver`**: Autonomous GitHub issue resolution.

## 4. Subscription & Observability

The server supports `resources/subscribe` capability.

- When an agent calls a mutating tool (e.g., `memory-store` or `task-update`), the server automatically emits resource change notifications for affected URIs.
- This allows real-time UI updates in the client (IDE) when the background knowledge base changes.
