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
2. **Standards**: Call `standard-search` with `stack=[{{tags}}]` to find reusable coding standards.
3. **Hydrate**: Use `memory-detail` for relevant memory pointer rows.
4. **Filter**: Identify applicable `pattern`, `decision`, and coding standard entries from similar stacks.
5. **Adapt**: Explain adaptation of these practices to current project and clearly separate memory-derived guidance from standards.
