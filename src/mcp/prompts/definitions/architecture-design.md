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
---
Design system architecture for repository.

Stack: {{tech_stack}}
Requirements: {{requirements}}

Output:
1. **Component Diagram**: Blocks & responsibilities.
2. **Data Flow**: Information movement.
3. **ADRs**: Rationale for patterns.
4. **Scalability/Reliability**: Growth & failure handling.
5. **Security**: Identity, protection, boundaries.
