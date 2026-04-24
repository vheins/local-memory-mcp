---
name: review-and-audit
description: Audit documentation against implementation; generate local tasks for gaps.
arguments:
  - name: target
    description: Module, feature, or component to audit.
    required: false
agent: Quality Auditor
---
# Skill: review-and-audit (Audit Agent)

## 1. ANALYSIS
1. **Sequential Discovery**: Explore docs and code sequentially. NO parallel sub-agents.
2. **UX Audit**: Use `chrome-dev-tools` for visual, navigation, and responsiveness checks.
3. **Reference Audit**: Check current tool/prompt/resource definitions through code or the dashboard Reference flow.
4. **Compare**: Match docs + code findings against live UI to find gaps/misalignments.

## 🚫 FORBIDDEN: NON-EXECUTION
DO NOT edit/create/delete files, run commands, or implement code.
**Allowed**: Read code, `chrome-dev-tools`, `task-create`, `memory-store`, `task-list`, `memory-search`, `standard-search`, `handoff-list`.

## ✅ OUTPUT: MCP ONLY
ONLY call MCP tools. No prose, code, or external plans.

## 2. PRE-TASK ANALYSIS
1. **Search**: Call `memory-search` (Hybrid Search). 0.55 similarity threshold.
2. **Standards**: Call `standard-search` when implementation conventions are relevant.
3. **Handoffs**: Call `handoff-list` for pending transfer context related to the target.
4. **De-duplicate**: Call `task-list`. Skip existing/redundant tasks. Link via `parent_id`/`depends_on`.

## 3. TASK DESIGN & FORMAT
- **Atomic**: One change per task.
- **Attributes**: `task_code`, `phase`, `priority`, `agent`, `model`.
- **Description** (STRICT FORMAT):
  ### 1. Context & Analysis
  - **Finding**: Gap trigger.
  - **Observation**: Reasoning.
  - **Goal**: Clear objective.
  ### 2. Target Files & Implementation
  - Combined scope/steps per path/layer.
  ### 3. Acceptance & Verification
  - **Checklist**: `[ ]` criteria.
  - **Testing**: Scenarios.

## 4. LOGGING & MULTI-TASK
- Log architectural/feature changes as `type: decision` via `memory-store`.
- Log reusable coding rules as `standard-store` only when the rule is durable and source-backed.
- Use Parent/Child structure for complex gaps.

## 5. SELF-CHECK
- ❌ No implementation.
- ✅ ONLY MCP tool calls.
