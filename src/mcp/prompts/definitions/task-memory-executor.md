---
name: task-memory-executor
description: Sequentially execute pending tasks for current repository.
arguments:
  - name: agent_identity
    description: Optional runner identity (e.g., Codex-Jarvis, Codex-HulkBuster, Gemini-Ultron). If omitted, infer identity from the active CLI/IDE and append short session token.
    required: false
agent: Task Executor
version: "1.5.4"
license: Proprietary — Personal Use Only
category: workflows
type: Orchestrator
complexity: Advanced
tags: [workflow, task-execution, memory]
author: vheins
---
# Skill: task-memory-executor

## 1. SYNC & FILTER
1. **Identify**: Resolve runner identity + repo name.
   - Resolver priority: `agent_identity` argument -> auto-generated session identity for this run.
   - Compute this once and reuse it across the full execution loop.
   - Auto identity format: `<runner>-<randomName>`.
   - `<runner>` should come from the active CLI/IDE label (for example `vibe-coding-cli`, `vibe-coding-ide`, `Codex`, `Gemini`) and `<randomName>` is a short stable session token.
   - Use this identity in task claim/update and handoff metadata so parallel terminals remain attributable.
2. **List**: Call `task-list` ONCE for active tasks.
3. **Dependency-ready filtering**: In the returned `task-list` order, only run `backlog`/`pending` tasks where:
   - `depends_on` is empty or completed, and
   - `parent_id` is empty or completed.
   - If all are blocked, report blockers and pause.
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
3. **Readiness re-check**: Re-check `depends_on`/`parent_id` from hydrated detail; if still blocked, skip and pick next ready task.
4. **Claim**: Use `task-claim` with `task_code` or `task_id` before implementation. Include the runner identity in claim metadata.
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
   - **Handoff**: If work remains or ownership changes, create `handoff-create` with concise summary and structured context containing next steps/blockers/remaining work. Do not create handoffs for completed-work summaries. Include the runner identity in handoff context/metadata.
   - **Retrospective**: Invoke `learning-retrospective`.
    - **Commit**: Atomic git commit. The commit message MUST follow this format:
      ```
      type(scope): your commit message

      - {{task_title}}
        {{summary_task}}

      {{keyword}} #{{issue_number}}
      ```
      Use `fix` for bug fixes, `closes` for features/chores, `resolve` as general. Multiple issues: e.g., `fix #123, closes #124, resolve #125`. Issues close only when merged into the default branch.
    - **Issue Number Extraction**: Read the issue number from task metadata when available. If metadata only contains a GitHub Issue URL, extract the trailing issue number from that URL before committing.

10A. **BLOCKER HANDLING (AUTOMATIC TASK CREATION)**:
   - **Trigger**: When task status is updated to `blocked` with a comment explaining the blocker reason.
   - **Blocker Classification**: Analyze the blocker comment to determine if it is **internal solvable** or **external**:
     - **Internal Solvable** (auto-create task): Missing dependency, missing module/function, configuration/env setup, implementation gap, failing test, build error.
     - **External** (skip auto-create): Awaiting user input/approval, API/service unavailability, manual external setup required.
   - **Pattern Matching**: Use regex patterns to detect internal blockers in the comment:
     - Missing patterns: `/(module|package|library|dependency|import)\s+(not\s+found|missing|undefined|not\s+installed)/i`
     - Not implemented: `/(function|interface|class|method|endpoint)\s+not\s+(found|implemented|exists)/i`
     - Configuration: `/(config|configuration|setup|env|environment)\s+(missing|not\s+set|invalid)/i`
     - Test/build failure: `/(test|build|compile|type\s+check)\s+(failed|error)/i`
   - **Auto-Create Task** (if internal solvable):
     - Task Code: `${parent_task_code}-FIX-${unix_timestamp}`
     - Title: `FIX: [${parent_task_title}] - Resolve: ${blocker_reason_extracted}`
     - Description: Follow standard format (1. Context & Analysis, 2. Step & Implementation, 3. Acceptance & Verification)
     - Parent ID: Set to current blocked task ID
     - Priority: `4` (HIGH)
     - Phase: `blocker-resolution`
     - Tags: `["blocker-fix", "auto-generated"]`
     - Metadata: Include `triggered_by_task`, `blocker_reason`, `creation_timestamp`, and `agent_identity`
   - **Update Parent Task**: Add comment linking to the new blocker-fix task
   - **Link Dependencies**: Set parent task's `depends_on` to the new blocker-fix task
   - **Skip Creation** (if external): Log that blocker is external, keep task status as `blocked`, no automatic task created.

11. **Repeat**: Claim next task from `task-list`.

## 3. BACKLOG MAINTENANCE
If active queue is empty:
1. Call `task-list` (status: `backlog`).
2. Move up to 20 highest-priority tasks to `pending` via `task-update`.
3. Interpret priority using MCP ordering: `5=Critical`, `4=High`, `3=Medium`, `2=Normal`, `1=Low`.

## 4. BLOCKER REFERENCE (Patterns & Detection)

### Internal Solvable Blocker Patterns (Trigger Auto Task Creation)

**Missing Dependencies/Modules**: `module not found`, `missing dependency`, `import not installed`
- Example: "ImportError: Function 'validateToken' not found"

**Not Implemented**: `function not implemented`, `interface not exists`, `component undefined`
- Example: "Function 'processPayment' not implemented - exists in type definitions but no implementation"

**Configuration/Setup Issues**: `.env missing`, `configuration not set`, `setup invalid`
- Example: "DATABASE_URL environment variable not set"

**Test/Build Failures**: `test failed`, `assertion failed`, `type error`, `build error`
- Example: "Type error: Property 'user' does not exist on type 'Request'"

### External Blocker Patterns (Skip Auto Task Creation)

**Awaiting User/External Action**: `awaiting user`, `requires manual`, `external dependency`
- Example: "Awaiting user approval for database migration"

**External Service Issues**: `API not responding`, `service unavailable`, `server not ready`
- Example: "Payment gateway API not responding"

### Auto Task Creation Example

**Parent Task Blocked**:
```
Task: FEATURE-42 (Add payment middleware)
Status: blocked
Comment: "Function 'chargeCard' not implemented"
```

**Auto-Generated Fix Task**:
```
Code: FEATURE-42-FIX-1714737908
Title: FIX: [Add payment middleware] - Resolve: Function 'chargeCard' not implemented
Parent: FEATURE-42
Priority: 4 (HIGH)
Tags: ["blocker-fix", "auto-generated"]
```

## 5. REPORT
Provide progress summary.
