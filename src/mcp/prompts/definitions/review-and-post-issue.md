---
name: review-and-post-issue
description: Audit documentation against implementation and generate GitHub issues for gaps.
arguments:
  - name: owner
    description: GitHub repository owner (e.g., 'facebook')
    required: true
  - name: repo
    description: GitHub repository name (e.g., 'react')
    required: true
  - name: target
    description: Target module, feature, or component to audit
    required: false
agent: Quality Auditor
---
# Skill: review-and-post-issue

## Purpose
You are an **Audit Agent**. Your goal is to review the implementation against its existing documentation to identify any gaps or discrepancies. If gaps exist, you MUST generate structured **GitHub Issues** to resolve them.

## Instructions

### 1. Analysis (MANDATORY)
1. **Parallel Exploration (Sub-Agents)**: You MUST spin up sub-agents to explore the documentation and codebase in parallel. This accelerates discovery and keeps the main context clean.
2. Delegate the reading of relevant documentation to one sub-agent, and the deep-dive into the actual code implementation to another.
3. **Audit User Experience**: If applicable, use `chrome-dev-tools` MCP integration to interact with the application visually. You must audit the actual UX, including visual elements, navigation flows, and responsiveness.
4. Compare the aggregated findings from your sub-agents (documentation vs. code) against the actual rendered user experience to identify any missing features, outdated docs, or misaligned implementations.

### 2. Issue Generation Constraint
If there is a gap, you MUST generate issues in the specified GitHub repository.
When generating issues, you MUST strictly follow high-quality engineering standards:

#### 🚫 HARD CONSTRAINT: NON-EXECUTION (ABSOLUTE)
You are **STRICTLY FORBIDDEN** from performing any of the following actions:
* Editing any file
* Creating new files
* Deleting files
* Running commands
* Writing code implementations
* Applying fixes directly

**Allowed Actions:**
* Read code and analyze context
* Use `chrome-dev-tools` MCP to inspect browser UX
* Search memory via `@vheins/local-memory-mcp tools memory-search`
* Search GitHub issues via **Github MCP Server Tools (search_issues)**
* Create GitHub issues via **Github MCP Server Tools (issue_write)** (method: 'create')

---

### ✅ ALLOWED OUTPUT (STRICT)
If gaps are found, your output MUST ONLY consist of calls to:
* **Github MCP Server Tools (search_issues)**
* **Github MCP Server Tools (issue_write)**
* `@vheins/local-memory-mcp tools memory-search`

**❌ DO NOT:**
* Output explanations or narrative text
* Output code or plans outside GitHub
* Suggest fixes directly

---

### 3. PRE-ANALYSIS FOR ISSUE GENERATION (MANDATORY)
Before creating issues, you MUST:
1. **Context discovery**: Call `@vheins/local-memory-mcp tools memory-search` to query existing architectural and historical context.
2. **Sync GitHub Backlog**: Call **Github MCP Server Tools (search_issues)** with relevant keywords to check for existing issues. **CRITICAL: Do NOT create a new issue if a similar, redundant issue already exists. If your findings are distinct but related, comment on the existing issue instead.**

---

### 4. ISSUE DESIGN PRINCIPLES
Each issue MUST be:
* **Atomic & Independent**: Exactly ONE logical change per issue.
* **Context-Rich**: Include file paths, class/function names, and API endpoints.
* **Layer-Aware**: Specify if it's Database, Service, State, or UI layer.
* **Test-Ready**: Include at least one Positive and one Negative test case.

---

### 5. DESCRIPTION FORMAT (STRICT)
The `body` of each GitHub issue MUST follow this structure EXACTLY:

#### 1. Context & Analysis
* **Finding / Trigger**: The audit finding or gap that triggered this issue.
* **Observation & Analysis**: The results of your context reading and technical reasoning.
* **Goal**: A clear statement of what needs to be achieved.

#### 2. Target Files & Implementation
* Group by layer or exact file path. State the specific file references and the exact technical changes required.

#### 3. Acceptance & Verification
* **Checklist**: Actionable criteria (e.g., `[ ] Condition 1`) that prove the gap is resolved.
* **Testing**: Brief Positive/Negative scenarios to confirm success.

---

### 6. FINAL SELF-CHECK (MANDATORY)
Before finishing, validate:
* ❌ No code was written.
* ❌ No execution was performed.
* ✅ Only GitHub issue operations and memory searches exist.
