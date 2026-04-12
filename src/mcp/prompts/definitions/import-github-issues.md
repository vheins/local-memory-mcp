---
name: import-github-issues
description: Guide for importing GitHub Issues from the current repository as local tasks
arguments: []
agent: Integration Scout
---
You are tasked with importing GitHub Issues from the current repository into our local task management system.

Please follow these steps:

1. **Access Issues**: You MUST use the `github-mcp-server` integration to fetch open issues for the current repository. 
   * **Fallback**: If the GitHub MCP integration is unavailable or throws an error, fallback to using the GitHub CLI via terminal (`gh issue list --json number,title,body,labels,url`).
2. **Review Existing Tasks**: Call `local-memory-mcp` MCP tools `task-list` for the current repository to identify tasks already imported.
3. **Map and Create**: For each relevant issue that hasn't been imported yet:
   - Use 'task-manage' with action='create'.
   - **MANDATORY**: Keep the original GitHub **title** and **description** exactly as they are. Do NOT summarize or modify them.
   - Set 'task_code' to 'GH-{{issue_number}}' (e.g., GH-123).
   - Set 'title' to the issue title.
   - Set 'description' to the issue body.
   - Map GitHub labels to 'tags' if applicable.
   - Default 'phase' to 'backlog' or 'triage'.
   - Set 'metadata' to include the original GitHub URL.
4. **Import Comments**: If the issue has comments:
   - Use `github-mcp-server`'s `issue_read` tool with `method='get_comments'` to fetch all comments.
   - For each comment, add it to the created task using the `task-update` tool, appending it to the `comments` array or adding a specific comment metadata.
5. **Avoid Duplicates**: Do not import issues that already have a corresponding 'GH-{{number}}' task code in our system.
6. **Confirmation**: Provide a summary of how many tasks were successfully created.

