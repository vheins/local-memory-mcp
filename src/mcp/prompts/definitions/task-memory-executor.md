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
3. **Audit**: Identify stale `in_progress` tasks (>30m no update). Hydrate via `task-detail` to check timestamps.

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
3. **Start**: `task-update` status to `in_progress` (MUST transition: `pending` → `in_progress`). Add agent/role metadata.
4. **Research**: Call `memory-search` (Hybrid Search).
5. **Execute**: 
   - **Trace**: Inspect logic, call sites, and docs. DO NOT infer from file presence.
   - **Logic**: Implement per description/intent.
6. **Validate**: 
   - Trace path end-to-end.
   - Run tests/linters/type-checks.
   - Logic audit for all affected paths.
   - **Browser Verification (MANDATORY)**: If the task involves UI/UX changes, use `browser-subagent` (Chrome DevTools) to verify the feature is functional and consumable by the user. Check for console errors, layout issues, and interactive behavior. see credential in seeder
7. **Finalize**: 
   - **Evidence**: `task-update` status to `completed` with detailed 'comment' (inspected files, verified logic, test results).
   - **Memory**: Store insights as `code_fact`/`pattern` via `memory-store`.
   - **Retrospective**: Invoke `learning-retrospective`.
   - **Commit**: Atomic git commit. The commit message MUST include the task code (for example: `fix: ... [TASK-123]`).
   - **GitHub Issue Traceability**: If task metadata contains a GitHub Issue reference, the commit message MUST also include the issue hashtag in `#123` format.
   - **Issue Number Extraction**: Read the issue number from task metadata when available. If metadata only contains a GitHub Issue URL, extract the trailing issue number from that URL before committing.
8. **Repeat**: Claim next task from `task-list`.

## 3. BACKLOG MAINTENANCE
If active queue is empty:
1. Call `task-list` (status: `backlog`).
2. Move up to 20 high-priority tasks to `pending` via `task-update`.

## 4. REPORT
Provide progress summary.
