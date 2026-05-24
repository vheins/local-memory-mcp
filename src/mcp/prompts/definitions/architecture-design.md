---
name: architecture-design
description: Plan system architecture, component layout, and data flow
arguments:
  - name: tech_stack
    description: Technology stack
    required: true
  - name: requirements
    description: Key requirements
    required: true
agent: System Architect
version: "1.0.0"
category: planning
tags: [architecture, system-design, components, data-flow, adr]
---

# Skill: Architecture Design

> Design system architecture for repository.

## I/O
`tech_stack` (req), `requirements` (req) → `design/architecture/` (components, data flow, ADRs)

## Rules
- Component Diagram: Blocks & responsibilities
- Data Flow: Information movement
- ADRs: Rationale for patterns
- Scalability/Reliability: Growth & failure handling
- Security: Identity, protection, boundaries

## Chain
← N/A
→ `architecture-documentation`: `design/architecture/` → as-built architecture doc
