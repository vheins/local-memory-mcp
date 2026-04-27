---
name: architecture-design
description: Plan system architecture, component layout, and data flow
arguments:
  - name: tech_stack
    description: Technology stack. Optional — auto-detected from repo package files, language, and active task tags if omitted.
    required: false
  - name: requirements
    description: Key requirements. Optional — inferred from active task description, pending handoff, or recent conversation if omitted.
    required: false
agent: System Architect
---
## 0. CONTEXT RESOLUTION
- **tech_stack**: If provided, use directly. If omitted — detect from package.json, pyproject.toml, Gemfile, or repo file extensions.
- **requirements**: If provided, use directly. If omitted — extract from active `in_progress` task description, pending handoff context, or recent conversation.

Design system architecture for the active repository.

Stack: (resolved above)
Requirements: (resolved above)

Output:
1. **Component Diagram**: Blocks & responsibilities.
2. **Data Flow**: Information movement.
3. **ADRs**: Rationale for patterns.
4. **Scalability/Reliability**: Growth & failure handling.
5. **Security**: Identity, protection, boundaries.
