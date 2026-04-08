---
name: architecture-design
description: Plan system architecture, component layout, and data flow
arguments:
  - name: tech_stack
    description: Technology stack
    required: true
  - name: requirements
    description: Key functional and non-functional requirements
    required: true
agent: System Architect
---
Design the architecture for a system in the current repository.

Stack: {{tech_stack}}
Requirements: {{requirements}}

Produce a comprehensive architecture overview:
1. **Component Diagram**: Major blocks and their responsibilities.
2. **Data Flow**: How information moves through the system.
3. **Key Technical Decisions**: Rationale for chosen patterns.
4. **Scalability & Reliability**: How the design handles growth and failure.
5. **Security Considerations**: Identity, data protection, and boundaries.
