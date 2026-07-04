---
name: review-and-audit
description: Audit documentation against implementation; generate local tasks for gaps.
arguments:
  - name: target
    description: Module, feature, or component to audit.
    required: false
agent: Quality Auditor
category: workflows
version: "1.0.0"
tags: [workflow, audit, ux, gap-analysis, mcp]
---

## Review and Audit

Entry=S0 → S1 → S2 → S3 → S4 Exit=done
Guard: S(N) req S(N-1)✅; NO code/edit/delete — read+MCP tools ONLY

S0 | sequential discovery: docs → code → UI (chrome-dev-tools) | — | findings | —
S1 | pre-task analysis: memory-search (0.55 threshold) + standard-search + handoff-list + task-list dedup | S0✅ | context | —
S2 | design tasks: atomic, attributes (task_code optional — auto-generated as TASK-xxx, phase, priority, agent, model), strict description format | S1✅ | task specs | —
S3 | create via task-create + log decisions via memory-store(type+title+content+importance+agent+model+scope) + standard-store for coding rules | S2✅ | MCP tasks | —
S4 | verify: confirm task count matches gap count, description format compliance, parent/child linkage | S3✅ | verified | —

## FORBIDDEN: NON-EXECUTION

DO NOT edit/create/delete files, run commands, or implement code.
Allowed: Read code, chrome-dev-tools, task-create, memory-store, task-list, memory-search, standard-search, handoff-list, handoff-update.

## SELF-CHECK

- No implementation.
- ONLY MCP tool calls.

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

`1=Low` `2=Normal` `3=Medium` `4=High` `5=Critical`

## Logging

- Decisions → `memory-store` (type=decision)
- Reusable coding rules → `standard-store` (only if durable + source-backed)
- Complex gaps → parent/child structure
