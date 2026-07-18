---
name: technical-planning
description: Technical blueprint for new feature/product, including full-roadmap execution planning.
arguments:
  - name: objective
    description: High-level goal.
    required: true
agent: Technical Architect
category: workflows
version: "1.0.0"
tags: [workflow, technical-planning]
---

## Technical Planning

Entry=create-task → task-claim Exit=task-update completed|blocked
Guard: A(N) req all prev A✅

A1 | tech-stack-selection | — | tech stack decision | —
A2 | architecture-design | A1✅ | architecture plan | .agents/documents/design/architecture/
G1 | approve stack + arch | A2✅ | → proceed | —
A3 | domain-modeling | G1✅ | domain model | .agents/documents/design/domain/
A4 | database-schema-planning | A3✅ | schema plan | .agents/documents/design/database/
G2 | approve domain + db | A4✅ | → proceed | —
A5 | api-contract-design | G2✅ | API contract | .agents/documents/application/api/
G3 | approve API contracts | A5✅ | → proceed | —
A6 | derive total_sprints from roadmap timeline+capacity → generate 1 sprint-planning task per sprint(N) + allocation audit + MCP task tree(parent/child + depends_on) | G3✅ | roadmap + sprints-1..N + audit + tasks | tasks/ + MCP
GF | final approve — blocked if sprint-N.md missing or MCP task tree not created | A6✅ | → documentation | —
V1 | verify: confirm all artifacts exist at documented output paths, gate approvals recorded | GF✅ | verified | —

## Optional

A7 | capacity-planning | — | capacity plan | —
A8 | event-storming | — | domain discovery | —
A9 | dependency-mapping | — | dependency map | —
A10 | microservices-boundary | — | service boundaries | —
A11 | monolith-decomposition | — | migration plan | —
A12 | sla-slo-definition | — | SLA/SLO doc | —
A13 | system-design-review | — | review findings | —
A14 | tech-affinity-scout | — | best practices | —
