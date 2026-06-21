---
name: task-memory-executor
description: Sequentially execute pending tasks for current repository.
arguments:
  - name: agent_identity
    description: Optional runner identity. If omitted, infer from CLI/IDE + short session token.
    required: false
agent: Task Executor
category: workflows
version: "1.5.4"
tags: [workflow, task-execution, memory]
---

## Main Loop

Entry=S0 → S1 → G0 → S2 → S3 → S4 → S5 → S6 → S7 → S8 → S9 Exit=exhausted|blocked
Guard: S(N) req S(N-1)✅; dependency-ready filter (depends_on+parent_id done)

S0 | sync: resolve identity (arg→auto `<runner>-<randomName>`, 1x reuse all loop) + task-list(ONCE) + handoff-list(pending, close stale) + audit stale in_progress(>30m, hydrate via task-detail) | — | filtered queue | —
S1 | hydrate: task-detail ONCE per task — MUST cache, MUST reuse all steps, NO re-fetch | S0✅ | full task | —
G0 | readiness: depends_on✅ AND parent_id✅? if all blocked → report blockers + pause | S1✅ | → S2 / skip+pick next | —
S2 | claim: task-claim(with identity metadata) [auto → in_progress] | G0✅ | ownership | —
G0.5 | skill readiness: check task.metadata.required_skills — if present, load each via skill() and verify FSM completed (all gates passed). If skill not loaded or FSM incomplete → ⛔ block with reason. If absent → skip (most tasks don't use skills). Check task-detail for suggested_skills too — if present, load each. | S2✅ | → S3 / ⛔ → blocker | —
S3 | research: memory-search + standard-search(MANDATORY per task — even sub-agents/decomposed) + hydrate relevant | G0.5✅ | context | —
S4 | execute: trace logic+callsites+docs — DO NOT infer from file presence; decompose if too broad | S3✅ | changes | —
S5 | validate: tests + linters + type-check + browser(if UI — MANDATORY: console errors, overflow, responsive, core interactions) + logic audit all paths | S4✅ | verification | —
S6 | finalize: task-update→completed(evidence: inspected files, verified logic, test results) + memory-store(insights) + standard-store(rules) + handoff(if work remains — with identity) + retrospective + report | S5✅ | completion | —
S7 | commit: `type(scope): msg — {{task_title}} {{summary_task}} {{keyword}} #N` (fix|closes|resolve, extract N from metadata/URL) | S6✅ | git commit | —
S8 | repeat → S0 | queue not empty | next task | —
S9 | verify: confirm commit format compliance, task updated completed, no stale handoffs remain | S8✅ | verified | —

## Design Note

Main loop is intentionally infinite — runs until MCP task queue is fully exhausted (no pending/backlog tasks remain across all cycles). No max_iterations guard needed.

## Parallelism Rules

- Delegate to sub-agents if capability exists; decompose broad tasks via task-create
- **Max 2** parallel sub-agents; each executes EXACTLY 1 task
- Fallback: sequential (1 concurrent) if no sub-agent capability

## Blocker Handling

Entry=S0 → S1 → G1|G2 → S2 → S3 Exit=unblocked|deferred

S0 | detect: task-update→blocked with reason | is blocked? | blocker comment | —
S1 | classify: regex-match comment against patterns below | S0✅ | internal solvable | external | —
G1 | internal solvable? | S1✅ | → S2 auto-create | —
G2 | external? (awaiting user, API down) | S1✅→external | → keep blocked, no auto task | —
S2 | create fix task: code=`{parent}-FIX-{unix}`, title=`FIX: [{parent_title}] — Resolve: {reason}`, priority=4(HIGH), phase=blocker-resolution, parent=current_id, depends_on=parent, tags=[blocker-fix,auto-generated], metadata={triggered_by, blocker_reason, timestamp, identity} | G1✅ | blocker fix task | —
S3 | verify: confirm fix task created, parent task dependency linked | S2✅ | verified | —

### Blocker Regex Patterns

| Category  | Regex                                                                                                    | Example                                           |
| --------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Missing   | `/(module\|package\|library\|dependency\|import)\s+(not\s+found\|missing\|undefined\|not\s+installed)/i` | `ImportError: Function 'validateToken' not found` |
| Not impl  | `/(function\|interface\|class\|method\|endpoint)\s+not\s+(found\|implemented\|exists)/i`                 | `Function 'processPayment' not implemented`       |
| Config    | `/(config\|configuration\|setup\|env\|environment)\s+(missing\|not\s+set\|invalid)/i`                    | `DATABASE_URL not set`                            |
| Test fail | `/(test\|build\|compile\|type\s+check)\s+(failed\|error)/i`                                              | `Type error: Property 'user' not on 'Request'`    |

## Backlog Maintenance

Entry=S0 → S1 → S2 Exit=promoted
Guard: active queue empty?

S0 | list backlog: task-list(status=backlog) | active queue empty? | backlog tasks | —
S1 | promote top 20 by priority(5→1) to pending via task-update | S0✅ | tasks→pending | —
S2 | verify: confirm promoted task count, check priority ordering correct | S1✅ | verified | —
