---
name: tech-affinity-scout
description: Scout best practices from similar tech projects.
arguments:
  - name: tags
    description: CSV tech tags (e.g., 'react, tailwind'). Optional — auto-detected from repo package files, file extensions, or active task tags if omitted.
    required: false
agent: Tech Scout
---
## 0. CONTEXT RESOLUTION
- **tags**: If provided, use directly. If omitted — detect from repo package files, file extensions, or active task tags.

Scout for relevant knowledge using detected/provided tags.

Steps:
1. **Search**: Call `memory-search` with `current_tags=[{{tags}}]`.
2. **Standards**: Call `standard-search` with `stack=[{{tags}}]` to find reusable coding standards.
3. **Hydrate**: Use `memory-detail` for relevant memory pointer rows.
4. **Filter**: Identify applicable `pattern`, `decision`, and coding standard entries from similar stacks.
5. **Adapt**: Explain adaptation of these practices to current project and clearly separate memory-derived guidance from standards.
