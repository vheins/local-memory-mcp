---
name: create-task
description: Create structured, atomic tasks in Local Memory MCP.
arguments:
  - name: instruction
    description: Directive to analyze and break into tasks. Optional — derived from active task, pending handoff, or recent conversation if omitted.
    required: false
agent: Task Planner
version: "1.0.0"
license: Proprietary — Personal Use Only
category: workflows
type: Orchestrator
complexity: Advanced
tags: [workflow, task-creation, planning, mcp]
author: vheins
---

## 🚫 FORBIDDEN: NON-EXECUTION
DO NOT edit/create/delete files, run commands, or implement code.
**Allowed**: Read code, `task-create`, `memory-store`, `task-list`, `memory-search`.

## ✅ OUTPUT: MCP ONLY
ONLY call MCP tools. No prose, no code, no plans outside MCP.

## 1. PRE-ANALYSIS
1. **Search Memory**: Call `memory-search` (architecture/history).
2. **Search Standards**: Call `standard-search` for tasks that may lead to code edits, test edits, refactors, migrations, or implementation decisions. If no relevant standards are returned, note that no applicable standards were found.
3. **Check Handoffs**: Call `handoff-list` for pending context that may already describe unfinished work. Ignore or close stale handoffs that only describe completed work.
4. **Research Codebase**: Read relevant source files to verify current implementation and paths.
5. **De-duplicate**: Call `task-list`. DO NOT duplicate existing tasks. Link related tasks via `parent_id`/`depends_on`.

## 2. TASK DESIGN
- **Atomic**: One logical change per task.
- **Context**: Paths, symbols, APIs.
- **Layered**: DB/Service/State/UI.
- **Tests**: Min 1 Positive + 1 Negative.

## 3. ATTRIBUTES & FORMAT
- `task_code`: FEAT/FIX/REFACTOR-XXX.
- `phase`: Discovery/Implementation/Testing.
- `priority`: 1-5 using this exact scale:
  - `1 = Low`
  - `2 = Normal`
  - `3 = Medium`
  - `4 = High`
  - `5 = Critical`
- `priority` is ascending by urgency. `5` is the highest urgency and `1` is the lowest. Never encode `Critical` as `1`.
- `description` (STRICT FORMAT):
  ### 1. Context & Analysis
  - **Trigger**: Instruction/finding.
  - **Observation**: Technical reasoning.
  - **Goal**: Clear objective.
  ### 2. Step & Implementation
  - Detailed execution steps per path/layer.
  ### 3. Acceptance & Verification
  - **Checklist**: `[ ]` criteria.
  - **Testing**: Scenarios.

## 4. MEMORY
Log architectural/feature changes as `type: decision` via `memory-store`. Store reusable implementation rules via `standard-store`. Skip for simple bug fixes.

## 5. MULTI-TASK
- Parent/Child logic for complex directives.
- Bulk limit: 500 records.

## 5A. BLUEPRINT ORCHESTRATION IMPORT
When the instruction source is `idea-to-blueprint`:
- Create one root parent task for the full SDLC blueprint.
- Create phase parent tasks for P0 through P10 and final no-gap handoff.
- Create child tasks for every task breakdown row in the `idea-to-blueprint` skill.
- Recursively decompose every referenced skill until leaf-level tasks are reached.
- Preserve phase order with `depends_on`: P0 -> P1 -> G1 -> P2 -> G2 -> P3 -> G3 -> P4/P5 -> P6 -> P7 -> P8 -> P9 -> P10 -> GF.
- For conditional tasks, create them with explicit condition metadata instead of omitting them:
  - UI design tasks run when the product has UI.
  - accessibility tests run when UI exists.
  - performance/load tests run when capacity risk exists.
  - database migration tests run when schema changes exist.
  - microservice/monolith tasks run only when architecture context applies.
- Gate tasks are internal quality checks. They should not ask for manual approval unless the gate is blocked by No-Go, missing mandatory input, or conflicting requirements.
- All task descriptions must use the strict Context & Analysis, Step & Implementation, Acceptance & Verification format.
- Call `task-list` before creation and link to existing related tasks instead of creating duplicates.
- Store a decision memory summarizing the blueprint task graph and major assumptions.

## 5B. SPRINT PLAN IMPORT
When the instruction source is `.agents/documents/tasks/sprints/`:
- Treat sprint files and allocation audit as the source of truth.
- Create one root parent task for the full delivery scope.
- Create one sprint parent task per sprint and link each to the root via `parent_id`.
- Create module/feature child tasks under the sprint where the work is scheduled.
- Create atomic implementation/testing tasks under the matching module/feature parent.
- Convert sprint dependency columns and implementation order into `depends_on`.
- Preserve cross-sprint blockers by linking later sprint tasks to earlier sprint MCP task IDs.
- Call `task-list` before creation and skip duplicates; link to existing related tasks instead.
- Store a task creation audit in memory with created, linked, skipped duplicate, and blocked counts.

## 6. SELF-CHECK
- ❌ No code/execution.
- ✅ ONLY MCP tool calls.

Analyze: {{instruction}}
