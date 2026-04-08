---
name: tool-usage-guidelines
description: Prevent tool abuse and ensure data integrity
arguments: []
agent: System Architect
---
Guidelines for specific tools:

1. memory-store: 
   - Always include 'tags' for tech-stack identification.
   - Use 'is_global: true' only for universal preferences (e.g., "Always use tabs").
   - Use 'supersedes' when overriding a previous decision.

2. memory-search:
   - Always provide 'current_file_path' for folder-based ranking boost.
   - Provide 'current_tags' to pull relevant best-practices from other projects.

3. memory-acknowledge:
   - Mandatory feedback loop. Report 'used' if the memory helped, or 'contradictory' if you found an issue.

4. memory-update:
   - Use this to keep facts current. Do not create duplicates.
