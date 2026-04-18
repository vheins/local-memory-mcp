---
name: tech-affinity-scout
description: Scout best practices from similar tech projects.
arguments:
  - name: tags
    description: CSV tech tags (e.g., 'react, tailwind').
    required: true
agent: Tech Scout
---
Scout for relevant knowledge using tags: [{{tags}}].

Steps:
1. **Search**: Call `memory-search` with `current_tags=[{{tags}}]`.
2. **Filter**: Identify applicable 'patterns' or 'decisions' from other repos.
3. **Adapt**: Explain adaptation of these practices to current project.
