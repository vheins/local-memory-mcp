---
name: review-and-post-issue
description: Audit documentation against implementation; generate GitHub issues for gaps.
arguments:
  - name: owner
    description: "GitHub repo owner. (hint: run `git remote -v` to extract from origin URL)"
    required: true
  - name: repo
    description: "GitHub repo name. (hint: run `git remote -v` to extract from origin URL)"
    required: true
  - name: target
    description: Module, feature, or component to audit.
    required: false
agent: Quality Auditor
category: workflows
version: "1.0.0"
tags: [workflow, audit, github, issue-triage]
---

## Review and Post Issue

Entry=S0 → S1 → S2 → S3 → S4 Exit=done
Guard: S(N) req S(N-1)✅; NO code/edit/delete — GitHub+MCP tools ONLY

S0 | sequential discovery: docs → code → UI (chrome-dev-tools if applicable) | — | findings | —
S1 | pre-issue analysis: agent-context(one-call) OR memory-search (0.55 threshold) + search_issues dedup (comment on related if distinct) | S0✅ | context | —
S2 | design issues: atomic, strict body format, labels | S1✅ | issue specs | —
S3 | create via issue_write(method=create) | S2✅ | GitHub issues | —
S4 | verify: confirm issue count matches gap count, all issues created on GitHub | S3✅ | verified | —

## FORBIDDEN: NON-EXECUTION

DO NOT edit/create/delete files, run commands, or implement code.
Allowed: Read code, chrome-dev-tools, agent-context, memory-search, GitHub search_issues, issue_write.

## OUTPUT: GITHUB ONLY

ONLY call: search_issues, issue_write (method: create), agent-context, memory-search.
No prose. No external plans.

## SELF-CHECK

- No implementation.
- ONLY GitHub/Memory tool calls.

## Issue Body Format (STRICT — used in S2)

```
### 1. Context & Analysis
- **Trigger**: Instruction/finding.
- **Observation**: Technical reasoning.
- **Goal**: Clear objective.
### 2. Step & Implementation
- Detailed execution steps per path/layer.
### 3. Acceptance & Verification
- **Checklist**: `[ ]` criteria.
- **Testing**: Scenarios.
```
