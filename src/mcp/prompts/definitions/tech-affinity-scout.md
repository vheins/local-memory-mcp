---
name: tech-affinity-scout
description: Find relevant best practices from other projects with similar tech for the current repository
arguments:
  - name: tags
    description: Comma-separated tech tags (e.g., 'react, tailwind')
    required: true
agent: Tech Scout
---
I am working on the current repository using [{{tags}}].

Please scout for relevant knowledge from other projects:
1. **Search**: Use '@vheins/local-memory-mcp tools memory-search' with current_tags=[{{tags}}] and include_archived=false.
2. **Filter**: Look for 'patterns' or 'decisions' from other repositories that might apply here.
3. **Translate**: Explain how these external best practices can be adapted to our current project context.
