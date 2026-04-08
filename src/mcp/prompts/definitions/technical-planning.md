---
name: technical-planning
description: Define the technical blueprint for a new feature or product
arguments:
  - name: objective
    description: The high-level goal for the plan
    required: true
agent: Technical Architect
---
You are tasked with creating a technical blueprint for the following objective in the current repository: '{{objective}}'.

Please cover:
1. **Tech Stack**: Confirm or select the stack.
2. **Architecture**: Component layout and data flow.
3. **Domain Model**: Entities, value objects, and events.
4. **Database Schema**: Normalized tables and relationships.
5. **API Contracts**: Endpoint definitions (request/response/errors).
6. **Roadmap & Sprints**: Phased delivery plan.

Present a cohesive technical design and obtain feedback before proceeding to implementation.
