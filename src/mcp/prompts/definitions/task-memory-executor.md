---
name: task-memory-executor
description: Sequentially execute pending tasks for current repository.
arguments: []
agent: Task Executor
---
# Skill: task-memory-executor

## 1. SYNC & FILTER
1. **Identify**: Get repo name (git/context).
2. **List**: Call `task-list` ONCE for active tasks.
3. **Handoffs**: Call `handoff-list` with `status=pending` and inspect relevant transfer context before selecting work. Treat a pending handoff as active only when it has unfinished work, a blocker, a next owner, or a linked task. If it is obsolete or only describes completed work, close it with `handoff-update status=expired`.
4. **Audit**: Identify stale `in_progress` tasks (>30m no update). Hydrate via `task-detail` to check timestamps.

## Task Cache (MANDATORY)
- `task-detail` MUST be called at most ONCE per task
- result MUST be reused across all steps
- do NOT re-fetch or re-inject full detail

## 2. EXECUTION LOOP
1. **Parallelism & Sub-Agents**: 
   - **MANDATORY**: Tasks MUST be delegated to sub-agents if the current agent has sub-agent capabilities.
   - **Decomposition**: If a task is too broad, the agent is allowed to decompose it into multiple tasks (via `task-create`) and delegate them to sub-agents.
   - **Spawn Limit**: The total number of parallel sub-agents MUST NOT exceed 4. Each sub-agent executes EXACTLY ONE task at a time.
   - **Fallback**: If the current agent CANNOT spawn sub-agents, it MUST execute tasks sequentially (exactly ONE concurrent task) until the queue is clear.
2. **Hydrate**: Fetch full context via `task-detail` for the assigned task.
3. **Claim**: Use `task-claim` with `task_code` or `task_id` before implementation.
4. **Start**: `task-update` status to `in_progress` (MUST transition: `pending` → `in_progress`). Add agent/role metadata.
5. **Research**: Call `memory-search` (Hybrid Search) and hydrate relevant results with `memory-detail`.
6. **Standards (MANDATORY PER TASK)**: Call `standard-search` for every task inside the execution loop before implementation, using the task intent plus inferred language/stack/repo as filters. This is required even for decomposed tasks and sub-agent assignments, so each task execution remains aligned with current standards. Apply only relevant standards and hydrate details when needed.
7. **Execute**:
   - **Trace**: Inspect logic, call sites, and docs. DO NOT infer from file presence.
   - **Logic**: Implement per description/intent.
8. **Validate**:
   - Trace path end-to-end.
   - Run tests/linters/type-checks.
   - Logic audit for all affected paths.
   - **Browser Verification (MANDATORY)**: If the task involves UI/UX changes, use Playwright or Chrome DevTools to verify the feature is functional and consumable by the user. Check console errors, layout overflow, responsive behavior, and core interactions.
9. **Finalize**:
   - **Evidence**: `task-update` status to `completed` with detailed 'comment' (inspected files, verified logic, test results).
   - **Cleanup**: Completing/canceling a task automatically releases active claims and expires linked pending handoffs.
   - **Memory**: Store insights as `code_fact`/`pattern` via `memory-store`.
   - **Standards**: Store durable implementation rules via `standard-store`, not generic memory.
   - **Handoff**: If work remains or ownership changes, create `handoff-create` with concise summary and structured context containing next steps/blockers/remaining work. Do not create handoffs for completed-work summaries.
   - **Retrospective**: Invoke `learning-retrospective`.
   - **Commit**: Atomic git commit. The commit message MUST include the task code (for example: `fix: ... [TASK-123]`).
   - **GitHub Issue Traceability**: If task metadata contains a GitHub Issue reference, the commit message MUST also include the issue hashtag in `#123` format.
   - **Issue Number Extraction**: Read the issue number from task metadata when available. If metadata only contains a GitHub Issue URL, extract the trailing issue number from that URL before committing.
10. **Repeat**: Claim next task from `task-list`.

## 3. BACKLOG MAINTENANCE
If active queue is empty:
1. Call `task-list` (status: `backlog`).
2. Move up to 20 highest-priority tasks to `pending` via `task-update`.
3. Interpret priority using MCP ordering: `5=Critical`, `4=High`, `3=Medium`, `2=Normal`, `1=Low`.

## 4. REPORT
Provide progress summary.
