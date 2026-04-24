---
name: create-task
description: Create structured, atomic tasks in Local Memory MCP.
arguments:
  - name: instruction
    description: Directive to analyze and break into tasks.
    required: true
agent: Task Planner
---
# Skill: create-task (Task Creation Orchestrator)

## 🚫 FORBIDDEN: NON-EXECUTION
DO NOT edit/create/delete files, run commands, or implement code.
**Allowed**: Read code, `task-create`, `memory-store`, `task-list`, `memory-search`.

## ✅ OUTPUT: MCP ONLY
ONLY call MCP tools. No prose, no code, no plans outside MCP.

## 1. PRE-ANALYSIS
1. **Search Memory**: Call `memory-search` (architecture/history).
2. **Search Standards**: Call `standard-search` when coding conventions may constrain the task.
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
- `priority`: 1-5.
- `description` (STRICT FORMAT):
  ### 1. Context & Analysis
  - **Trigger**: Instruction/finding.
  - **Observation**: Technical reasoning.
  - **Goal**: Clear objective.
  ### 2. Target Files & Implementation
  - Combined scope/steps per path/layer.
  ### 3. Acceptance & Verification
  - **Checklist**: `[ ]` criteria.
  - **Testing**: Scenarios.

## 4. MEMORY
Log architectural/feature changes as `type: decision` via `memory-store`. Store reusable implementation rules via `standard-store`. Skip for simple bug fixes.

## 5. MULTI-TASK
- Parent/Child logic for complex directives.
- Bulk limit: 500 records.

## 6. SELF-CHECK
- ❌ No code/execution.
- ✅ ONLY MCP tool calls.

Analyze: {{instruction}}
