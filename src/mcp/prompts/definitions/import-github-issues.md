---
name: import-github-issues
description: Guide for importing GitHub Issues from the current repository as local tasks
arguments: []
agent: Integration Scout
---
You are tasked with importing GitHub Issues from the current repository into our local task management system.

Please follow these steps:

1. **Access Issues**: Use available GitHub MCP tools to list open issues for the current repository.
2. **Review Existing Tasks**: Call '@vheins/local-memory-mcp tools task-list' for the current repository to identify tasks already imported.
3. **Map and Create**: For each relevant issue that hasn't been imported yet:
   - Use 'task-manage' with action='create'.
   - Set 'task_code' to 'GH-{{issue_number}}' (e.g., GH-123).
   - Set 'title' to the issue title.
   - Set 'description' to the issue body (abbreviate if extremely long).
   - Map GitHub labels to 'tags' if applicable.
   - Default 'phase' to 'backlog' or 'triage'.
   - Set 'metadata' to include the original GitHub URL.
4. **Avoid Duplicates**: Do not import issues that already have a corresponding 'GH-{{number}}' task code in our system.
5. **Confirmation**: Provide a summary of how many tasks were successfully created.
