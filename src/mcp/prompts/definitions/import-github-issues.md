---
name: import-github-issues
description: Import GitHub Issues as local tasks.
arguments: []
agent: Integration Scout
category: workflows
version: "1.0.0"
tags: [workflow, github, issue-import, mcp]
---

## FSM

Entry=S0 → S1 → S2 → S3 → S4 Exit=imported
Guard: S(N) req S(N-1)✅
Hint: If repo not auto-detected, run `git remote -v` to get owner/repo from origin URL.

S0 | fetch open issues: primary=github-mcp-server; fallback=`gh issue list --json number,title,body,labels,url` | — | issue list | —
S1 | dedup via task-list (skip if GH-{number} exists) | S0✅ | filtered issues | —
S2 | create MCP tasks: task_code=GH-{number} (auto-generated as TASK-xxx if omitted), EXACT title/body (DO NOT summarize), tags=labels, phase=backlog|triage, metadata=URL | S1✅ | tasks created | —
S3 | import comments via issue_read → task-update | S2✅ | comments linked | —
S4 | report created count | S3✅ | summary | —
