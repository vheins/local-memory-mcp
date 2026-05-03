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
   - **Decomposition**: If a task is too broad, the agent is allowed to decompose it into multiple tasks (via `task-create`) and delegate them to sub-agents. All created tasks MUST follow the format: 1. Context & Analysis, 2. Step & Implementation, 3. Acceptance & Verification.
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
       - Context: Reference parent task code and explain the blocking factor
       - Steps: Identify root cause and implement fix
       - Verification: Confirm parent task can proceed
     - Parent ID: Set to current blocked task ID
     - Priority: `4` (HIGH)
     - Phase: `blocker-resolution`
     - Tags: `["blocker-fix", "auto-generated"]`
     - Metadata: Include `triggered_by_task`, `blocker_reason`, `creation_timestamp`, and `agent_identity`
   - **Update Parent Task**: Add comment linking to the new blocker-fix task: `"Blocker resolution task created: ${new_task_code}"`
   - **Link Dependencies**: Set parent task's `depends_on` to the new blocker-fix task (parent waits for fix before retry)
   - **Skip Creation** (if external): Log that blocker is external, keep task status as `blocked`, no automatic task created.

11. **Repeat**: Claim next task from `task-list`.

## 3. BACKLOG MAINTENANCE
If active queue is empty:
1. Call `task-list` (status: `backlog`).
2. Move up to 20 highest-priority tasks to `pending` via `task-update`.
3. Interpret priority using MCP ordering: `5=Critical`, `4=High`, `3=Medium`, `2=Normal`, `1=Low`.

## 4. BLOCKER REFERENCE (Patterns & Detection)

### Internal Solvable Blocker Patterns (Trigger Auto Task Creation)

**Missing Dependencies/Modules**:
- `module not found`, `missing dependency`, `import not installed`, `undefined function`, `no such file`
- Example: "ImportError: Function 'validateToken' not found"

**Not Implemented**:
- `function/method not implemented`, `interface not exists`, `component undefined`
- Example: "Function 'processPayment' not implemented - exists in type definitions but no implementation"

**Configuration/Setup Issues**:
- `.env missing`, `configuration not set`, `setup invalid`, `environment variable not found`
- Example: "DATABASE_URL environment variable not set"

**Test/Build Failures** (solvable):
- `test failed`, `assertion failed`, `type error`, `build error`, `compilation failed`
- Example: "Type error: Property 'user' does not exist on type 'Request'"

**Implementation Gaps**:
- `endpoint not implemented`, `API route missing`, `middleware not registered`
- Example: "GET /api/users endpoint returns 404 - not implemented"

### External Blocker Patterns (Skip Auto Task Creation)

**Awaiting User/External Action**:
- `awaiting user`, `requires manual`, `user must`, `external dependency`, `manual setup`
- Example: "Awaiting user approval for database migration", "Requires manual infrastructure setup"

**External Service Issues**:
- `API not responding`, `service unavailable`, `server not ready`
- Example: "Payment gateway API not responding - external service unavailable"

**Manual Prerequisites**:
- `install locally`, `run script manually`, `requires external tool`
- Example: "Requires manual Docker setup - not part of this task"

### Auto Task Creation Example Flow

**Parent Task Blocked:**
```
Task Code: FEATURE-42
Title: Add payment processing middleware
Status: blocked
Comment: "Function 'chargeCard' in services/payment.ts not implemented - exists in interface but implementation missing"
```

**Detection & Classification:**
```
Pattern detected: "Function .* not implemented" → INTERNAL SOLVABLE ✅
Action: Create blocker-fix task
```

**Auto-Generated Task:**
```
Task Code: FEATURE-42-FIX-1714737908
Title: FIX: [Add payment processing middleware] - Resolve: Function 'chargeCard' not implemented
Parent ID: FEATURE-42
Priority: 4 (HIGH)
Phase: blocker-resolution
Tags: ["blocker-fix", "auto-generated"]

Description:
1. Context & Analysis:
   Parent task FEATURE-42 blocked due to: Function 'chargeCard' in services/payment.ts not implemented
   The function exists in the interface but has no implementation body
   Blocking factor: services/payment.ts - chargeCard function stub

2. Step & Implementation:
   - Review services/payment.ts chargeCard function signature
   - Implement full payment processing logic (charges, refunds, error handling)
   - Add proper error handling and validation
   - Write unit tests for charge scenarios

3. Acceptance & Verification:
   - chargeCard function fully implemented
   - Unit tests passing
   - Function can be called from FEATURE-42 middleware
   - FEATURE-42 parent task can proceed without blockers
```

**Execution Workflow:**
1. Agent picks blocker-fix task first (independent, no dependencies)
2. Implements `chargeCard` function
3. Completes blocker-fix task
4. Parent task FEATURE-42 becomes ready (fix completed)
5. Agent proceeds with FEATURE-42 execution

## 5. REPORT
Provide progress summary.
