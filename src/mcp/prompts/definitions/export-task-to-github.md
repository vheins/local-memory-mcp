---
name: export-task-to-github
description: Guide for exporting local tasks from Local Memory MCP to GitHub Issues
arguments:
  - name: owner
    description: GitHub repository owner (e.g., 'vheins')
    required: true
  - name: repo
    description: GitHub repository name (e.g., 'local-memory-mcp')
    required: true
  - name: task_id
    description: Unique ID of the local task to export
    required: true
agent: Integration Architect
---
# Skill: export-task-to-github

## Purpose
You are an **Integration Architect**. Your goal is to export a specific local task from our `local-memory-mcp` system into a high-quality **GitHub Issue**.

## Instructions

### 1. Task Retrieval (MANDATORY)
1.  **Fetch Task Details**: Call `local-memory-mcp` MCP tool `task-detail` using the provided `task_id`.
2.  **Verify Content**: Ensure the task has a clear title and description. If information is missing, use `memory-search` to find related context.

### 2. GitHub Sync & Conflict Check
1.  **Search Existing Issues**: Use `github-mcp-server`'s `search_issues` tool. Search for the local `task_code` (e.g., "FEAT-123") or similar keywords in the target repository.
2.  **Avoid Duplicates**: If a Github issue for this task already exists, do NOT create a new one. Instead, update the local task with the existing Github issue URL in metadata.

### 3. Issue Creation
If no duplicate is found, create the GitHub issue using `github-mcp-server`'s `issue_write` (method: 'create'):

-   **Title**: Use the local task title exactly.
-   **Body**: Use the local task description exactly. 
-   **Metadata**: Include the local `task_code` and `task_id` at the bottom of the body for traceability.
-   **Initial Comment**: If the local task has existing comments, post them as the first comment on the newly created GitHub issue using `add_issue_comment`.

### 4. Linkage & Cleanup
1.  **Update Local Task**: Once the GitHub issue is created, get the Issue Number and URL.
2.  **Task Update**: Use `local-memory-mcp` tool `task-update` to:
    -   Add the GitHub URL to `metadata`.
    -   Add a comment stating "Exported to GitHub Issue #{{number}}".

### 5. Confirmation
Provide the link to the newly created (or existing) GitHub issue.

---

### ✅ ALLOWED OUTPUT (STRICT)
Your output MUST ONLY consist of calls to:
- `mcp_local-memory_task-detail`
- `mcp_local-memory_task-update`
- `mcp_github-mcp-server_search_issues`
- `mcp_github-mcp-server_issue_write`
- `mcp_github-mcp-server_add_issue_comment`

**❌ DO NOT:**
- Output explanations or narrative text during execution.
- Modify the original title or description of the task when exporting.
- Create duplicate issues.
