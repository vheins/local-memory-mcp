---
name: review-and-post-issue
description: Audit documentation against implementation; generate GitHub issues for gaps.
arguments:
  - name: owner
    description: GitHub repo owner. Optional — auto-detected from git remote if omitted.
    required: false
  - name: repo
    description: GitHub repo name. Optional — auto-detected from git remote if omitted.
    required: false
  - name: target
    description: Module, feature, or component to audit. Optional — if omitted, audits all documentation against the full implementation.
    required: false
agent: Quality Auditor
---

## 0. CONTEXT RESOLUTION
1. **Owner/Repo**: Auto-detect from `git remote get-url origin` or active workspace context. Parse `owner` and `repo` from the remote URL. Verify before proceeding.
2. **Target**: If `target` provided — scope to that module/feature. If omitted — **fallback**: audit ALL existing documentation against the full codebase.

## 1. ANALYSIS
1. **Discovery**: Explore docs and code. Coding sub-agents MAY be used for parallel reading if the agent supports sub-agents. **FORBIDDEN: browser sub-agents**.
2. **UX Audit**: If the target involves UI, note it as a separate GitHub issue — do NOT block audit on visual inspection.
3. **Compare**: Match docs + code findings to identify gaps/misalignments.

## 🚫 FORBIDDEN: NON-EXECUTION
DO NOT edit/create/delete files, run commands, or implement code.
**Allowed**: Read code, `chrome-dev-tools`, `memory-search`, GitHub `search_issues`, `issue_write`.

## ✅ OUTPUT: GITHUB ONLY
ONLY call: `search_issues`, `issue_write` (method: 'create'), `memory-search`.
No prose. No external plans.

## 2. PRE-ISSUE ANALYSIS
1. **Search**: Call `memory-search` (Hybrid Search). 0.55 similarity threshold.
2. **De-duplicate**: Call `search_issues`. Skip existing/redundant issues. Comment on related issues if distinct.

## 3. ISSUE DESIGN & FORMAT
- **Atomic**: One change per issue.
- **Body** (STRICT FORMAT):
  ### 1. Context & Analysis
  - **Finding**: Gap trigger.
  - **Observation**: Reasoning.
  - **Goal**: Clear objective.
  ### 2. Target Files & Implementation
  - Path/layer specific changes.
  ### 3. Acceptance & Verification
  - **Checklist**: `[ ]` criteria.
  - **Testing**: Scenarios.

## 4. SELF-CHECK
- ❌ No implementation.
- ✅ ONLY GitHub/Memory tool calls.
