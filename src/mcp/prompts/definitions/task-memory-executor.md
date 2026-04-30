---
name: task-memory-executor
description: Sequentially execute pending tasks for current repository.
arguments:
  - name: agent_identity
    description: Optional runner identity (e.g., Codex-Jarvis, Codex-HulkBuster, Gemini-Ultron). If omitted, identity is inferred from the active CLI/IDE and a short session token is appended.
    required: false
agent: Task Executor
---

## 1. SYNC & FILTER
1. **Identify**: Determine runner identity and repo context.
   - Resolver priority: `agent_identity` argument -> auto session identity generated once per run.
   - Auto identity format: `<runner>-<randomName>`.
   - `<runner>` should come from the active CLI/IDE label (for example `vibe-coding-cli`, `vibe-coding-ide`, `Codex`, `Gemini`) and `<randomName>` is a short stable session token.
   - Use this identity for all `task-claim`, `task-update`, and handoff writes.
2. **List**: Call `task-list` ONCE for active tasks.
3. **Dependency-aware selection** (in `task-list` order):
   - Process tasks in the order returned by `task-list`.
   - A task is READY only if:
     - status is `backlog` or `pending`, and
     - `depends_on` is empty, or the dependency task exists and is `completed`, and
     - `parent_id` is empty, or the parent task is `completed`.
   - Keep non-ready tasks out of execution for now.
   - If a task is blocked by unresolved dependency/parent, do not claim it and continue to the next ready task.
   - If all active tasks are blocked, report blockers and stop execution loop.
4. **Handoffs**: Call `handoff-list` with `status=pending` and inspect relevant transfer context before selecting work. Treat a pending handoff as active only when it has unfinished work, a blocker, a next owner, or a linked task. If it is obsolete or only describes completed work, close it with `handoff-update status=expired`.
5. **Audit**: Identify stale `in_progress` tasks (>30m no update). Hydrate via `task-detail` to check timestamps.

## Task Cache (MANDATORY)
- `task-detail` MUST be called at most ONCE per task
- result MUST be reused across all steps
- do NOT re-fetch or re-inject full detail

## 2. EXECUTION LOOP
1. **Parallelism & Sub-Agents**: 
   - **MANDATORY**: Tasks MUST be delegated to sub-agents if the current agent has sub-agent capabilities.
   - **Decomposition**: If a task is too broad, the agent is allowed to decompose it into multiple tasks (via `task-create`) and delegate them to sub-agents.
   - **Spawn Limit**: The total number of parallel sub-agents MUST NOT exceed 2. Each sub-agent executes EXACTLY ONE task at a time.
   - **Fallback**: If the current agent CANNOT spawn sub-agents, it MUST execute tasks sequentially (exactly ONE concurrent task) until the queue is clear.
2. **Hydrate**: Fetch full context via `task-detail` for the assigned task.
3. **Readiness re-check**: Re-check blockers from hydrated detail (`depends_on`, `parent_id`) before claim. If still blocked, return to step 2 (execution loop) and pick the next ready task in list order.
4. **Claim**: Use `task-claim` with `task_code` or `task_id` before implementation, and write the runner identity into claim metadata.
5. **Start**: `task-update` status to `in_progress` (MUST transition: `pending` → `in_progress`). Add agent/role metadata and the same runner identity used by claims.
6. **Research**: Call `memory-search` (Hybrid Search) and hydrate relevant results with `memory-detail`.
7. **Standards (MANDATORY PER TASK)**: Call `standard-search` for every task inside the execution loop before any code edit, test edit, refactor, migration, or implementation decision, using the task intent, affected files, inferred language, stack, and repo as filters. This is required even for small tasks, decomposed tasks, and sub-agent assignments. Apply only relevant standards, hydrate details when needed, and if no relevant standards are returned, continue and state that no applicable standards were found.
8. **Execute**:
   - **Trace**: Inspect logic, call sites, and docs. DO NOT infer from file presence.
   - **Logic**: Implement per description/intent.
9. **Validate**:
   - Trace path end-to-end.
   - Run tests/linters/type-checks.
   - Logic audit for all affected paths.
   - **Browser Verification (MANDATORY)**: If the task involves UI/UX changes, use Playwright or Chrome DevTools to verify the feature is functional and consumable by the user. Check console errors, layout overflow, responsive behavior, and core interactions.
10. **Finalize**:
   - **Evidence**: `task-update` status to `completed` with detailed 'comment' (inspected files, verified logic, test results).
   - **Cleanup**: Completing/canceling a task automatically releases active claims and expires linked pending handoffs.
   - **Memory**: Store insights as `code_fact`/`pattern` via `memory-store`.
   - **Standards**: Store durable implementation rules via `standard-store`, not generic memory.
   - **Handoff**: If work remains or ownership changes, create `handoff-create` with concise summary and structured context containing next steps/blockers/remaining work. Do not create handoffs for completed-work summaries. Include runner identity in handoff metadata/context.
   - **Retrospective**: Invoke `learning-retrospective`.
   - **Commit**: Atomic git commit. The commit message MUST follow this format: `type(scope): [task-code] your commit message`, followed by a detailed description:
     ```
     - [Task Title]
       [Summary Task]
     ```
     This ensures full traceability between code changes and project context.
   - **GitHub Issue Traceability**: If task metadata contains a GitHub Issue reference, the commit message MUST also include the issue hashtag in `#123` format.
   - **Issue Number Extraction**: Read the issue number from task metadata when available. If metadata only contains a GitHub Issue URL, extract the trailing issue number from that URL before committing.
11. **Repeat**: Claim next task from `task-list`.

## 3. BACKLOG MAINTENANCE
If active queue is empty:
1. Call `task-list` (status: `backlog`).
2. Move up to 20 highest-priority tasks to `pending` via `task-update`.
3. Interpret priority using MCP ordering: `5=Critical`, `4=High`, `3=Medium`, `2=Normal`, `1=Low`.

## 4. REPORT
Provide progress summary.
