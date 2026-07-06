---
name: create-task
description: Create structured, atomic tasks in Local Memory MCP.
arguments:
  - name: instruction
    description: Directive to analyze and break into tasks. Derived from active task/pending handoff/recent conversation if omitted.
    required: false
agent: Task Planner
category: workflows
version: "1.0.0"
tags: [workflow, task-creation, planning, mcp]
---

## Create Task

Entry=S0 → S1 → S2 → S3 → S4 Exit=created
Guard: S(N) req S(N-1)✅; NO code/edit/delete — MCP tools ONLY (allowed: task-create, task-list, task-detail, task-update, memory-store, memory-search, standard-search, standard-store, handoff-list, handoff-update, read)

S0 | pre_analysis: agent-context(one-call) OR memory-search(architecture/history) + standard-search(if task leads to code/test/refactor/migrate decisions) + handoff-list(pending; close stale that describe completed work) + read code(verify paths+impl) + task-list dedup(DO NOT duplicate; link via parent_id/depends_on) | — | context | —
S1 | design tasks: atomic(1 logical change), layered(DB/Service/State/UI), context(paths+symbols+APIs), min 1 pos+1 neg test | S0✅ | task specs | —
S2 | assign attributes: task_code(optional — auto-generated as TASK-xxx if omitted), phase(Discovery|Implementation|Testing), priority(1=Low..5=Critical), strict description format | S1✅ | task attrs | —
S3 | create via task-create(bulk max 500) + log decisions via memory-store(arch/feature changes; skip simple bugs) | S2✅ | MCP tasks created | —
S4 | verify: validate task count, description format compliance, parent/depends_on integrity, no duplicates | S3✅ | verified | —
G1 | blueprint? | src=idea-to-blueprint | → route blueprint flow | —
G2 | sprint? | src=.agents/documents/tasks/sprints/ | → route sprint flow | —

## Description Format (STRICT — used in S2)

```
### 1. Context & Analysis
- **Trigger**: Instruction/finding.
- **Observation**: Technical reasoning.
- **Goal**: Clear objective.
### 2. Step & Implementation
- Detailed execution steps per path/layer.
### 3. Acceptance & Verification
- **Checklist**: `[ ]` criteria.
- **Testing**: Scenarios.
```

## Priority Scale

`1=Low` `2=Normal` `3=Medium` `4=High` `5=Critical` (ascending urgency)

## 3B. SKILL TRACKING METADATA

When a task's description references specific skills (e.g., "Load feature-decomposition skill"), set `metadata.required_skills` and `metadata.fsm_gates`:

- `metadata.required_skills`: `["skill-name-1", "skill-name-2"]` — array of skill names the task depends on.
- `metadata.fsm_gates`: `["S0", "S1", "G0"]` — array of FSM step/gate identifiers the skill requires.
- **Optional**: Only set when the task explicitly references a skill. Most tasks do NOT need skill tracking.
- **Enforcement**: The `task-memory-executor` G0.5 gate checks `metadata.required_skills` before execution. If a skill is listed but wasn't loaded, the executor blocks the task.

## Blueprint Flow (G1→)

Root parent → phase parents P0..P10 → child tasks per breakdown row
Recursive decompose every referenced skill to leaf level
depends_on: P0→P1→G1→P2→G2→P3→G3→P4/P5→P6→P7→P8→P9→P10→GF
Conditional tasks use metadata (not omission): UI design (if UI), a11y (if UI), perf (if capacity risk), db migration (if schema change), microservice (if arch context)
Gates = internal quality checks; no manual approval unless blocked No-Go or missing mandatory input
Store decision memory summarizing blueprint graph + assumptions

## Sprint Flow (G2→)

Root parent → sprint parents (per sprint) → module/feature children → atomic impl/test tasks
Convert sprint dependency columns + implementation order into depends_on
Preserve cross-sprint blockers via MCP task ID links
Store creation audit: created, linked, skipped dup, blocked counts

## Upstream Aliases

- `remember_fact(fact)` / `remember_facts(facts)` → `memory-store`
- `recall(query)` → `memory-search`
- `forget(id)` → `memory-delete(id)`
- Drop-in compatibility with Beledarian/mcp-local-memory

Analyze: {{instruction}}
