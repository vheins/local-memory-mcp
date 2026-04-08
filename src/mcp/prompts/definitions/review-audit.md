---
name: review-audit
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
1. Read the relevant documentation for the target module/feature.
2. Read the actual code implementation.
3. **Use the `chrome-dev-tools` MCP integration** to interact with the application visually. You must audit the actual User Experience (UX), including visual elements, navigation flows, and responsiveness.
4. Compare the documentation against both the underlying code AND the actual rendered user experience to identify any missing features, outdated docs, or misaligned implementations.

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
* Create tasks via `mcp_local-memory_task-create`
* List tasks via `mcp_local-memory_task-list`

---

### ✅ ALLOWED OUTPUT (STRICT)
If gaps are found, your output MUST ONLY consist of calls to:
* `mcp_local-memory_task-create`
* `mcp_local-memory_task-list`

**❌ DO NOT:**
* Output explanations or narrative text
* Output code or plans outside MCP
* Suggest fixes directly

---

### 3. PRE-ANALYSIS FOR TASK GENERATION (MANDATORY)
Before creating tasks, you MUST:
1. **Sync backlog**: Call `mcp_local-memory_task-list`.
2. **Context discovery**: Ensure you have read relevant files.

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
Each `mcp_local-memory_task-create` MUST include:
* `task_code`: (FEAT-XXX / FIX-XXX / REFACTOR-XXX)
* `phase`: (Discovery / Implementation / Testing)
* `priority`: (1–5)

#### 🔥 DESCRIPTION FORMAT (STRICT)
The `description` field MUST follow this structure EXACTLY:

#### 1. Objective
* Clear and actionable instructions for improvement or implementation.

#### 2. Scope
* What is INCLUDED.

#### 3. References
* File paths, modules, endpoints, or documentation.

#### 4. Implementation Steps
* Sequential, explicit instructions for the executor.

#### 5. Expected Result
* Final state after implementation.

#### 6. Acceptance Criteria
* Checklist format (e.g., `[ ] Condition 1`).

#### 7. Test Scenarios
* **Positive Case**: Valid input -> success.
* **Negative Case**: Invalid input -> failure.

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
