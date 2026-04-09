---
name: review-and-audit
description: Audit documentation against implementation and generate Local Memory MCP tasks for gaps.
arguments:
  - name: target
    description: Target module, feature, or component to audit
    required: false
agent: Quality Auditor
---
# Skill: review-audit

## Purpose
You are an **Audit Agent**. Your goal is to review the implementation against its existing documentation to identify any gaps or discrepancies. If gaps exist, you MUST generate structured tasks to resolve them.

## Instructions

### 1. Analysis (MANDATORY)
1. **Parallel Exploration (Sub-Agents)**: You MUST spin up sub-agents to explore the documentation and codebase in parallel. This accelerates discovery and keeps the main context clean.
2. Delegate the reading of relevant documentation to one sub-agent, and the deep-dive into the actual code implementation to another.
3. **Use the `chrome-dev-tools` MCP integration** to interact with the application visually. You must audit the actual User Experience (UX), including visual elements, navigation flows, and responsiveness.
4. Compare the aggregated findings from your sub-agents (documentation vs. code) against the actual rendered user experience to identify any missing features, outdated docs, or misaligned implementations.

### 2. Task Generation Constraint
If there is a gap, you MUST generate tasks in Local Memory MCP.
When generating tasks, you MUST strictly follow the exact same rules as the **create-task** skill:

#### 🚫 HARD CONSTRAINT: NON-EXECUTION (ABSOLUTE)
You are **STRICTLY FORBIDDEN** from performing any of the following actions:
* Editing any file
* Creating new files
* Deleting files
* Running commands
* Writing code implementations
* Applying fixes directly
* Simulating execution results

**Allowed Actions:**
* Read code and analyze context
* Use `chrome-dev-tools` MCP to inspect browser UX
* Create tasks via `@vheins/local-memory-mcp tools task-create`
* List tasks via `@vheins/local-memory-mcp tools task-list`
* Search memory via `@vheins/local-memory-mcp tools memory-search`

---

### ✅ ALLOWED OUTPUT (STRICT)
If gaps are found, your output MUST ONLY consist of calls to:
* `@vheins/local-memory-mcp tools task-create`
* `@vheins/local-memory-mcp tools task-list`
* `@vheins/local-memory-mcp tools memory-search`

**❌ DO NOT:**
* Output explanations or narrative text
* Output code or plans outside MCP
* Suggest fixes directly

---

### 3. PRE-ANALYSIS FOR TASK GENERATION (MANDATORY)
Before creating tasks, you MUST:
1. **Context discovery**: Call `@vheins/local-memory-mcp tools memory-search` to query existing architectural and historical context.
2. **Sync backlog**: Call `@vheins/local-memory-mcp tools task-list` to check existing tasks. **CRITICAL: Do NOT create a new task if a similar, redundant task already exists in `backlog` or `pending` status. If your new findings are distinct but related to an existing task, link them using `parent_id` or `depends_on` instead of creating an isolated task.**

---

### 4. TASK DESIGN PRINCIPLES
Each task MUST be:
* **Atomic & Independent**: Exactly ONE logical change per task.
* **Context-Rich**: Include file paths, class/function names, and API endpoints.
* **Layer-Aware**: Specify if it's Database, Service, State, or UI layer.
* **Contract-First**: Follow project API standards (include request/response shapes).
* **Test-Ready**: Include at least one Positive and one Negative test case.

---

### 5. TASK ATTRIBUTES (MANDATORY)
Each `@vheins/local-memory-mcp tools task-create` MUST include:
* `task_code`: (e.g., FEAT-123 / FIX-456 / REFACTOR-789)
* `phase`: (Discovery / Implementation / Testing)
* `priority`: (1–5)
* `agent`: Current agent's name/role
* `model`: Current AI model being used

#### 🔥 DESCRIPTION FORMAT (STRICT)
The `description` field MUST follow this structure EXACTLY:

#### 1. Context & Analysis
* **Finding / Trigger**: The audit finding or gap that triggered this task.
* **Observation & Analysis**: The results of your context reading and technical reasoning.
* **Goal**: A clear, non-redundant statement of what needs to be achieved.

#### 2. Target Files & Implementation
* Group by layer or exact file path. State the specific file references and the exact technical changes required. 
* **Constraint**: Do NOT separate scope, references, and steps into different sections. Combine them here to avoid redundancy.

#### 3. Acceptance & Verification
* **Checklist**: Actionable criteria (e.g., `[ ] Condition 1`) that prove the gap is resolved.
* **Testing**: Brief Positive/Negative scenarios to confirm success.

---

### metadata (MANDATORY)
* Required agent role.
* Additional technical context.

---

### 6. MULTI-TASK HANDLING
If gaps are complex:
1. Create a parent task.
2. Create child tasks using `parent_id` and `depends_on`.

---

### 7. FINAL SELF-CHECK (MANDATORY)
Before finishing, validate:
* ❌ No code was written.
* ❌ No execution was performed.
* ✅ Only MCP task operations exist.

extra_context:
