---
name: technical-planning
description: Technical blueprint for new feature/product.
arguments:
  - name: objective
    description: High-level goal. Optional — inferred from active task description, pending handoff, or recent conversation if omitted.
    required: false
agent: Technical Architect
---
## 0. CONTEXT RESOLUTION
- **objective**: If provided, use directly. If omitted — extract from the active `in_progress` task description, the most recent pending handoff summary, or the last user instruction in conversation context.

Create technical blueprint for the resolved objective.

Cover:
1. **Tech Stack**: Selected/confirmed technologies.
2. **Architecture**: Components & data flow.
3. **Domain Model**: Entities, value objects, events.
4. **Database**: Normalized schema & relationships.
5. **API Contracts**: Requests, responses, errors.
6. **Execution**: Roadmap & phased delivery.

Present design for feedback before implementation.
