---
name: technical-planning
description: Technical blueprint for new feature/product, including full-roadmap execution planning.
arguments:
  - name: objective
    description: High-level goal.
    required: true
agent: Technical Architect
version: "1.0.0"
license: Proprietary — Personal Use Only
category: workflows
type: Pipeline
complexity: Advanced
tags: [workflow, technical-planning]
author: vheins
---

# Skill: Technical Planning Pipeline

## Purpose
Produces a comprehensive technical blueprint (tech stack, architecture, domain, database, API contracts, execution plan).

## Input
| Variable | Type | Req | Description |
|----------|------|-----|-------------|
| `objective` | string | Yes | High-level goal |

## FSM
Entry: create-task → task-claim   Exit: task-update completed|blocked
Guard: A(N) requires all prev A✅

A1 | tech-stack-selection           | —    | tech stack decision  | —
A2 | architecture-design            | A1✅ | architecture plan    | design/architecture/
G1 | approve stack + arch          | A2✅ | → proceed            | —
A3 | domain-modeling                | G1✅ | domain model         | design/domain/
A4 | database-schema-planning       | A3✅ | schema plan          | design/database/
G2 | approve domain + db           | A4✅ | → proceed            | —
A5 | api-contract-design            | G2✅ | API contract         | design/api/
G3 | approve API contracts         | A5✅ | → proceed            | —
A6 | roadmap-creation + all sprint plans + MCP tasks | G3✅ | roadmap + sprint-1..sprint-N + allocation audit + MCP task tree | tasks/roadmap/ + tasks/sprints/ + local-memory-mcp
GF | final approve                 | A6✅ | → documentation      | —

## Execution Planning Rule
A6 MUST cover the full delivery horizon. `sprint-planning` is per sprint, so A6 must derive `total_sprints` from roadmap timeline/capacity and generate one sprint-planning task for every sprint number from 1 through `total_sprints`. After sprint allocation audit passes, A6 must invoke `create-task` to create the Local Memory MCP task tree with parent/child and `depends_on` links. The final approval is blocked if only `sprint-1.md` exists while the roadmap contains later sprint-ready work, or if the MCP task tree was not created from the final sprint plans.

## Optional
A7  | capacity-planning             | —    | capacity plan        | —
A8  | event-storming                | —    | domain discovery     | —
A9  | dependency-mapping            | —    | dependency map       | —
A10 | microservices-boundary        | —    | service boundaries   | —
A11 | monolith-decomposition        | —    | migration plan       | —
A12 | sla-slo-definition            | —    | SLA/SLO doc          | —
A13 | system-design-review          | —    | review findings      | —
A14 | tech-affinity-scout           | —    | best practices       | —
