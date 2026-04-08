import { SQLiteStore } from "../storage/sqlite.js";
import { SessionContext, inferRepoFromSession } from "../session.js";
import { rankCompletionValues } from "../utils/completion.js";
import { decodeCursor, encodeCursor } from "../utils/pagination.js";

export const PROMPTS = {
  "memory-agent-core": {
    name: "memory-agent-core",
    description: "Core behavioral contract for memory-aware agents",
    arguments: [],
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `You are a coding copilot agent working inside an active software project.

Your primary goal is to help write correct, maintainable, and consistent code.

You are memory-aware:
- Stored memory represents durable project knowledge.
- Memory is a source of truth, not a suggestion.
- You must respect stored decisions and constraints.

Core Behavioral Rules:
1. Never contradict stored decisions without explicitly using 'memory-update' or 'supersedes'.
2. Never repeat known mistakes documented in memory.
3. Never use memory from another repository UNLESS it shares the same technology tags (Affinity) or is marked as Global.
4. If memory conflicts with the user's new request, detect the conflict and ask for clarification or propose a 'supersedes' update.
5. After using a memory to generate code, you MUST call 'memory-acknowledge' to report its utility.

Memory Usage Policy:
Before generating code:
1. Search memory using 'current_file_path' and 'current_tags' (e.g., ['filament', 'react']) for maximum relevance.
2. Evaluate results based on 'type' (decision, pattern, mistake).
3. Use memory ONLY if clearly relevant. Prefer fewer, stronger memories over many weak ones.

Auto-Memory Creation Policy:
You MAY store memory ONLY if:
- The information affects future behavior.
- The knowledge is durable (e.g., architecture, styling rules, bug fixes).
- You use 'tags' to categorize by technology (e.g., ['nestjs', 'typescript']).

Before storing memory:
- If this replaces an old rule, find the old memory ID and use 'supersedes'.
- Explain briefly why it should be stored.

Behave like a trusted senior engineer who remembers past decisions and protects the long-term health of the codebase across all user projects.`
        }
      }
    ]
  },
  "memory-index-policy": {
    name: "memory-index-policy",
    description: "Enforce strict memory discipline",
    arguments: [],
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Do not store:
- Temporary discussions or brainstorming.
- Subjective opinions without consensus.
- Generic coding knowledge available in public docs.

Only store:
- Specific project decisions (Architecture, UI/UX).
- Learned patterns for this specific tech-stack.
- Hard-won bug fixes (Mistakes to avoid).

Memory is a permanent record, categorize it properly with tags.`
        }
      }
    ]
  },
  "tool-usage-guidelines": {
    name: "tool-usage-guidelines",
    description: "Prevent tool abuse and ensure data integrity",
    arguments: [],
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Guidelines for specific tools:

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
   - Use this to keep facts current. Do not create duplicates.`
        }
      }
    ]
  },
  "task-management-guidelines": {
    name: "task-management-guidelines",
    description: "Best practices for task tracking and progress management",
    arguments: [],
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Guidelines for Task Management:

1. task-manage:
   - Use 'create' to break down complex user requests into actionable steps at the start of a session.
   - Use 'phase' to group tasks (e.g., 'research', 'implementation', 'testing').
   - Use 'priority' (1-5) to highlight critical path items.
   - Use 'update' to mark progress (in_progress, completed, blocked).
   - Use 'metadata' to store technical debt notes or implementation details.

2. Resource & Tool Usage:
   - MANDATORY: Always call 'task-list' at the very start of a new session to understand current progress and avoid duplicating work.
   - Resource: You can also read 'tasks://current' for a filtered view of active tasks for the current repository.
   - Coordinate: If a task is already 'in_progress', do not attempt to work on it unless specifically asked to collaborate.

3. Workflow Integration:
   - Plan first: Create tasks for the entire lifecycle (Research -> Strategy -> Execution -> Validation).
   - Atomic Updates: Update the task status to 'in_progress' EXACTLY ONCE when you begin working on a task. Do NOT repeatedly update it to 'in_progress' before every tool call.
   - Finalize: Only mark a task as 'completed' after successful validation (tests passed). If validation fails, do NOT immediately mark it as 'blocked' or 'pending'. You MUST iterate and fix the issues while keeping the task 'in_progress'. Only mark as 'blocked' if there is a hard dependency issue that completely prevents further progress.`
        }
      }
    ]
  },
  "import-github-issues": {
    name: "import-github-issues",
    description: "Guide for importing GitHub Issues from the current repository as local tasks",
    arguments: [],
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `You are tasked with importing GitHub Issues from the current repository into our local task management system.

Please follow these steps:

1. **Access Issues**: Use available GitHub MCP tools to list open issues for the current repository.
2. **Review Existing Tasks**: Call 'task-list' for the current repository to identify tasks already imported.
3. **Map and Create**: For each relevant issue that hasn't been imported yet:
   - Use 'task-manage' with action='create'.
   - Set 'task_code' to 'GH-{{issue_number}}' (e.g., GH-123).
   - Set 'title' to the issue title.
   - Set 'description' to the issue body (abbreviate if extremely long).
   - Map GitHub labels to 'tags' if applicable.
   - Default 'phase' to 'backlog' or 'triage'.
   - Set 'metadata' to include the original GitHub URL.
4. **Avoid Duplicates**: Do not import issues that already have a corresponding 'GH-{{number}}' task code in our system.
5. **Confirmation**: Provide a summary of how many tasks were successfully created.`
        }
      }
    ]
  },
  "project-briefing": {
    name: "project-briefing",
    description: "Onboard the agent to the current repository state",
    arguments: [],
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `I am starting a new session in the current repository.

Please perform a briefing to catch up on the project:
1. **Recent Knowledge**: Call 'memory-recap' for the current repo to see the latest decisions, patterns, and mistakes recorded.
2. **Current Tasks**: Call 'task-list' to understand what is currently pending or in-progress.
3. **Context Check**: Summarize the top 3 most important architectural decisions you found.
4. **Readiness**: Tell me what you are ready to help with based on the current backlog.`
        }
      }
    ]
  },
  "learning-retrospective": {
    name: "learning-retrospective",
    description: "Extract durable knowledge from recent work in the current repository",
    arguments: [
      { name: "task_id", description: "Optional ID of the task just completed", required: false }
    ],
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `We have just finished some work in the current repository related to task {{task_id}}. 

Please reflect on the changes and identify knowledge worth keeping:
1. **Mistakes**: Did we encounter any bugs that were hard to find or caused by specific environment quirks? (Store as 'mistake')
2. **Decisions**: Did we make a choice between multiple options (e.g., library choice, UI pattern)? (Store as 'decision')
3. **Patterns**: Did we establish a repeatable way of doing things in this codebase? (Store as 'pattern')

Use 'memory-store' to record any high-value findings. Be concise and use appropriate technology tags.`
        }
      }
    ]
  },
  "memory-guided-review": {
    name: "memory-guided-review",
    description: "Review code for compliance with stored project decisions in the current repository",
    arguments: [
      { name: "file_path", description: "Path to the file to review", required: true }
    ],
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Please review the code in '{{file_path}}'.

Your goal is to ensure compliance with our stored project knowledge for the current repository:
1. **Search Constraints**: Use 'memory-search' with current_file_path='{{file_path}}' and the current repo context to find relevant decisions and patterns.
2. **Evaluate Compliance**: Does the code follow established patterns? Does it repeat any known mistakes?
3. **Feedback**: Provide specific suggestions for improvement if you find violations of stored decisions.`
        }
      }
    ]
  },
  "session-planner": {
    name: "session-planner",
    description: "Break down a complex objective into atomic tasks for the current repository",
    arguments: [
      { name: "objective", description: "The high-level goal for this session", required: true }
    ],
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Our objective for today in the current repository is: '{{objective}}'.

Please act as a project manager and plan the execution:
1. **Analyze**: Break this objective down into 3-7 small, atomic, and verifiable tasks.
2. **Execute**: Use 'task-manage' with action='create' to add these to the local tracker for the current repo.
3. **Hierarchy**: Use 'parent_id' or 'depends_on' if there is a clear order of operations.
4. **Phases**: Group tasks into phases like 'research', 'implementation', and 'validation'.

Display the created plan to the user when done.`
        }
      }
    ]
  },
  "tech-affinity-scout": {
    name: "tech-affinity-scout",
    description: "Find relevant best practices from other projects with similar tech for the current repository",
    arguments: [
      { name: "tags", description: "Comma-separated tech tags (e.g., 'react, tailwind')", required: true }
    ],
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `I am working on the current repository using [{{tags}}].

Please scout for relevant knowledge from other projects:
1. **Search**: Use 'memory-search' with current_tags=[{{tags}}] and include_archived=false.
2. **Filter**: Look for 'patterns' or 'decisions' from other repositories that might apply here.
3. **Translate**: Explain how these external best practices can be adapted to our current project context.`
        }
      }
    ]
  },
  "documentation-sync": {
    name: "documentation-sync",
    description: "Reconcile memory decisions with local markdown files in the current repository",
    arguments: [],
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Please verify if our local documentation (README.md, docs/*.md, .agents/documents/**/*.md, .kiro/**/*.md) is in sync with our stored memories for the current repository.

Steps:
1. **Fetch Decisions**: Use 'memory-search' to find all 'decision' type memories for this repo.
2. **Read Docs**: Read the primary project documentation files including those in .agents/documents and .kiro.
3. **Identify Gaps**: Is there any durable knowledge in the memory that is MISSING from the docs? Is there any documentation that is OUTDATED based on recent decisions?
4. **Propose Updates**: Suggest specific changes to the documentation to reflect the current source of truth.`
        }
      }
    ]
  },
  "task-memory-executor": {
    name: "task-memory-executor",
    description: "Execute all pending tasks for the current repository, updating status and storing handoffs in the task backlog.",
    arguments: [],
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `# Skill: task-memory-executor

## Purpose

You are tasked with executing all available tasks for the current repository.

## Instructions

---
description: Execute all pending tasks for the current repository
---

Please follow this strict execution flow:

1. **Identify Repository**: Determine the current repository name (e.g., from git config or workspace context).
2. **Fetch Tasks**: Call 'task-list' for the identified repository for statuses 'pending' and 'in_progress'.
3. **Filter Stale**: Identify 'in_progress' tasks that are **stale** (stale is defined as > 30 Minutes without update, often because an agent stopped or crashed).
4. **Single-Task Execution Loop (STRICT)**: You MUST process tasks EXACTLY ONE AT A TIME. DO NOT update multiple tasks to 'in_progress' simultaneously. For the SINGLE task you select:
    - **Start**: Call 'task-update' to set status='in_progress' for this task ONLY. Provide current agent/role information in the metadata.
    - **Execute**: Perform the work described in the task title and description.
    - **Inspect Codebase Logic First (MANDATORY)**: Before marking anything done, inspect the relevant code paths, call sites, configs, tests, and affected modules in the repository. Do not infer correctness from file presence alone.
    - **Validate Behavior (MANDATORY)**: Ensure the implementation logic satisfies the task intent and follows project standards. Validation must focus on behavior, control flow, data flow, and integration points, not just whether a file/class/function exists.
    - **Complete Only With Evidence**: Call 'task-update' to set status='completed' only after recording concrete evidence in the 'comment' field. The comment must include: files inspected, logic verified, checks/tests run (or why they could not run), and the exact reason the task is considered complete.
    - **Compact Context**: Summarize key learnings, decisions, and patterns discovered during task execution. Store critical insights as memory entries (type: 'code_fact' or 'pattern') using 'memory-store'.
    - **Commit**: Perform an atomic git commit and push for the changes made in the task.
    - **Handoff**: Use 'task-update' to document **detailed fix steps**, milestones, project-specific knowledge gained during execution, and validation evidence. If complex, decompose into smaller tasks using 'task-create'.
    - **Next**: Repeat this loop for the next 'pending' or 'stale' task.
5. **Backlog Migration**: Once all 'pending' and 'in_progress' tasks are completed or blocked, fetch tasks with status='backlog'. If any exist, select up to 20 tasks (prioritizing by priority field) and update their status to 'pending' using 'task-update' to ensure the next agent has work ready.
6. **Report**: After processing all tasks, provide a summary of your progress.

## Mandatory Validation Rules

Before a task can be marked \`completed\`, the agent **must** satisfy all applicable rules below:

1. **Read the implementation, not just the filesystem**
   - Inspect the actual source files related to the task.
   - Trace the relevant logic path end-to-end using code search and file reads.
   - Verify how the changed code is invoked, not just that it exists.

2. **Confirm behavior against task intent**
   - Compare the implementation against the task title, description, acceptance criteria, or bug report.
   - Check that the business logic is actually implemented and wired correctly.
   - If the task affects existing behavior, inspect adjacent modules and integration points for regressions.

3. **Use concrete verification**
   - Run targeted tests, linters, type checks, or validation scripts if available.
   - If automated tests cannot be run, perform a manual logic audit of all affected paths.
   - Document the specific verification method used in the task completion comment.
`
        }
      }
    ]
  },
  "senior-code-review": {
    name: "senior-code-review",
    description: "Performs a comprehensive production-readiness evaluation for the current repository context",
    arguments: [
      { name: "tech_stack", description: "Target tech stack (e.g., 'Node.js + Express')", required: true },
      { name: "context", description: "Production context (traffic, data sensitivity, SLA, conventions)", required: false }
    ],
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Act as a principal software engineer performing a production-readiness review for the current repository.

Stack: {{tech_stack}}
Context: {{context}}

Please review the current code/changes against these 6 dimensions:
1. **Error Handling Completeness**
2. **Security** (Injection, Input validation, PII/Secrets)
3. **Performance** (Time/Memory complexity, DB queries)
4. **Observability** (Logging, Metrics, Tracing)
5. **Test Coverage**
6. **Documentation**

For each finding, provide:
- **Severity**: P0-P3
- **Dimension**: One of the above
- **Location**: Specific function/line
- **Problem**: What is wrong and why it matters
- **Fix**: Actionable recommendation

Produce a **Production Readiness Verdict**: READY | READY WITH MINOR FIXES | NOT READY`
        }
      }
    ]
  },
  "fix-suggestion": {
    name: "fix-suggestion",
    description: "Provide a targeted, minimal fix for an identified bug with before/after code and a test case",
    arguments: [
      { name: "tech_stack", description: "Target technology stack", required: true },
      { name: "bug_description", description: "Description of the bug behavior", required: true },
      { name: "root_cause", description: "The identified root cause", required: true }
    ],
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `You are a senior software engineer generating a precise, minimal fix for a confirmed bug in the current repository.

Tech stack: {{tech_stack}}
Bug description: {{bug_description}}
Root cause: {{root_cause}}

Please provide:
1. **Fix Explanation**: Why the bug occurs and how the fix resolves it.
2. **Before Code**: Show original buggy code.
3. **After Code**: Show fixed code with explanatory comments.
4. **Fix Checklist**: Additional changes (config, migrations, etc.)
5. **Test Case**: A regression test case to verify the fix.`
        }
      }
    ]
  },
  "root-cause-analysis": {
    name: "root-cause-analysis",
    description: "Apply structured 5-Why analysis to trace bugs to their origin",
    arguments: [
      { name: "tech_stack", description: "Target technology stack", required: true },
      { name: "bug_description", description: "Observable symptom or bug behavior", required: true },
      { name: "symptoms", description: "Additional errors, logs, metrics", required: false }
    ],
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `You are a senior software engineer conducting a root cause analysis for a bug in the current repository.

Tech stack: {{tech_stack}}
Bug description: {{bug_description}}
Symptoms: {{symptoms}}

Apply a full **5-Why analysis**:
1. **Symptom Statement**: Technically restate the problem.
2. **5-Why Causal Chain**: Trace from symptom to the core process/design/environmental failure.
3. **Root Cause Statement**: "The root cause is [X] because [Y], which allowed [Z] to occur."
4. **Fix Recommendation**: Address the root cause, not just the symptom.
5. **Recurrence Prevention**: Suggest a monitoring or testing measure.`
        }
      }
    ]
  },
  "technical-planning": {
    name: "technical-planning",
    description: "Define the technical blueprint for a new feature or product",
    arguments: [
      { name: "objective", description: "The high-level goal for the plan", required: true }
    ],
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `You are tasked with creating a technical blueprint for the following objective in the current repository: '{{objective}}'.

Please cover:
1. **Tech Stack**: Confirm or select the stack.
2. **Architecture**: Component layout and data flow.
3. **Domain Model**: Entities, value objects, and events.
4. **Database Schema**: Normalized tables and relationships.
5. **API Contracts**: Endpoint definitions (request/response/errors).
6. **Roadmap & Sprints**: Phased delivery plan.

Present a cohesive technical design and obtain feedback before proceeding to implementation.`
        }
      }
    ]
  },
  "security-triage": {
    name: "security-triage",
    description: "Assess security vulnerability reports for exploitability and prioritize remediation",
    arguments: [
      { name: "tech_stack", description: "Application stack", required: true },
      { name: "vulnerability_report", description: "Report details (CVE, SAST, etc.)", required: true },
      { name: "codebase_context", description: "Component usage context", required: false }
    ],
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Act as a senior application security engineer triaging a vulnerability for the current repository.

Stack: {{tech_stack}}
Report: {{vulnerability_report}}
Codebase context: {{codebase_context}}

Please provide:
1. **Vulnerability Classification**: Type, CVE, CVSS, and attack vector.
2. **Exploitability Assessment**: Contextual reachability and realistic scenarios.
3. **Impact Assessment**: Impact on Confidentiality, Integrity, and Availability.
4. **Remediation Priority & Fix**: Concrete priority (P0-P3) and fix steps.
5. **Verification**: How to test and verify the fix.`
        }
      }
    ]
  },
  "architecture-design": {
    name: "architecture-design",
    description: "Plan system architecture, component layout, and data flow",
    arguments: [
      { name: "tech_stack", description: "Technology stack", required: true },
      { name: "requirements", description: "Key functional and non-functional requirements", required: true }
    ],
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Design the architecture for a system in the current repository.

Stack: {{tech_stack}}
Requirements: {{requirements}}

Produce a comprehensive architecture overview:
1. **Component Diagram**: Major blocks and their responsibilities.
2. **Data Flow**: How information moves through the system.
3. **Key Technical Decisions**: Rationale for chosen patterns.
4. **Scalability & Reliability**: How the design handles growth and failure.
5. **Security Considerations**: Identity, data protection, and boundaries.`
        }
      }
    ]
  },
  "create-task": {
    name: "create-task",
    description: "Generate structured, atomic tasks in Local Memory MCP from user directives.",
    arguments: [],
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `# Skill: create-task

## Purpose

You are a **Task Creation Orchestrator**. Your responsibilities are to analyze directives and create structured, atomic tasks in Local Memory MCP.

## Instructions

### 🚫 HARD CONSTRAINT: NON-EXECUTION (ABSOLUTE)

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
* Create tasks via \`mcp_local-memory_task-create\`
* List tasks via \`mcp_local-memory_task-list\`

---

### ✅ ALLOWED OUTPUT (STRICT)

Your output MUST ONLY consist of calls to:
* \`mcp_local-memory_task-create\`
* \`mcp_local-memory_task-list\`

**❌ DO NOT:**
* Output explanations or narrative text
* Output code or plans outside MCP
* Suggest fixes directly

---

### 1. PRE-ANALYSIS (MANDATORY)

Before creating tasks, you MUST:
1. **Sync backlog**: Call \`mcp_local-memory_task-list\`.
2. **Context discovery**: Read relevant modules, files, endpoints, and documentation.

---

### 2. TASK DESIGN PRINCIPLES

Each task MUST be:
* **Atomic & Independent**: Exactly ONE logical change per task.
* **Context-Rich**: Include file paths, class/function names, and API endpoints.
* **Layer-Aware**: Specify if it's Database, Service, State, or UI layer.
* **Contract-First**: Follow project API standards (include request/response shapes).
* **Test-Ready**: Include at least one Positive and one Negative test case.

---

### 3. TASK ATTRIBUTES (MANDATORY)

Each \`mcp_local-memory_task-create\` MUST include:
* \`task_code\`: (FEAT-XXX / FIX-XXX / REFACTOR-XXX)
* \`phase\`: (Discovery / Implementation / Testing)
* \`priority\`: (1–5)

#### 🔥 DESCRIPTION FORMAT (STRICT)
The \`description\` field MUST follow this structure EXACTLY:

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
* Checklist format (e.g., \`[ ] Condition 1\`).

#### 7. Test Scenarios
* **Positive Case**: Valid input -> success.
* **Negative Case**: Invalid input -> failure.

---

### metadata (MANDATORY)
* Required agent role.
* Additional technical context.

---

### 4. MULTI-TASK HANDLING
If a directive is complex:
1. Create a parent task.
2. Create child tasks using \`parent_id\` and \`depends_on\`.

---

### 5. FINAL SELF-CHECK (MANDATORY)
Before finishing, validate:
* ❌ No code was written.
* ❌ No execution was performed.
* ✅ Only MCP task operations exist.

If this check fails → ABORT OUTPUT.`
        }
      }
    ]
  },
  "review-audit": {
    name: "review-audit",
    description: "Audit documentation against implementation and generate Local Memory MCP tasks for gaps.",
    arguments: [
      { name: "target", description: "Target module, feature, or component to audit", required: false }
    ],
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `# Skill: review-audit

## Purpose
You are an **Audit Agent**. Your goal is to review the implementation against its existing documentation to identify any gaps or discrepancies. If gaps exist, you MUST generate structured tasks to resolve them.

## Instructions

### 1. Analysis (MANDATORY)
1. Read the relevant documentation for the target module/feature.
2. Read the actual code implementation.
3. **Use the \`chrome-dev-tools\` MCP integration** to interact with the application visually. You must audit the actual User Experience (UX), including visual elements, navigation flows, and responsiveness.
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
* Use \`chrome-dev-tools\` MCP to inspect browser UX
* Create tasks via \`mcp_local-memory_task-create\`
* List tasks via \`mcp_local-memory_task-list\`

---

### ✅ ALLOWED OUTPUT (STRICT)
If gaps are found, your output MUST ONLY consist of calls to:
* \`mcp_local-memory_task-create\`
* \`mcp_local-memory_task-list\`

**❌ DO NOT:**
* Output explanations or narrative text
* Output code or plans outside MCP
* Suggest fixes directly

---

### 3. PRE-ANALYSIS FOR TASK GENERATION (MANDATORY)
Before creating tasks, you MUST:
1. **Sync backlog**: Call \`mcp_local-memory_task-list\`.
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
Each \`mcp_local-memory_task-create\` MUST include:
* \`task_code\`: (FEAT-XXX / FIX-XXX / REFACTOR-XXX)
* \`phase\`: (Discovery / Implementation / Testing)
* \`priority\`: (1–5)

#### 🔥 DESCRIPTION FORMAT (STRICT)
The \`description\` field MUST follow this structure EXACTLY:

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
* Checklist format (e.g., \`[ ] Condition 1\`).

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
2. Create child tasks using \`parent_id\` and \`depends_on\`.

---

### 7. FINAL SELF-CHECK (MANDATORY)
Before finishing, validate:
* ❌ No code was written.
* ❌ No execution was performed.
* ✅ Only MCP task operations exist.`
        }
      }
    ]
  }
};

export type PromptArgument = {
  name: string;
  title?: string;
  description?: string;
  required?: boolean;
};

export type PromptMessage = {
  role: string;
  content: any;
};

export type PromptDefinition = {
  name: string;
  title?: string;
  description: string;
  arguments: PromptArgument[];
  messages: PromptMessage[];
  icons?: Array<{ src: string; mimeType?: string }>;
};

type PromptCatalogEntry = Omit<PromptDefinition, "messages">;

const DYNAMIC_PROMPTS: Record<string, Omit<PromptCatalogEntry, "name">> = {
  "workspace-briefing-rich": {
    title: "Workspace Briefing Rich",
    description: "Brief the model with active roots, project summary, task backlog, and memory index for the current repository.",
    arguments: [
      {
        name: "repo",
        title: "Repository",
        description: "Repository name. Optional when it can be inferred from roots or the existing local memory store.",
        required: false,
      },
      {
        name: "focus",
        title: "Focus",
        description: "Optional focus area for the briefing, such as architecture, tasks, or onboarding.",
        required: false,
      },
    ],
  },
  "repo-architecture-context": {
    title: "Repo Architecture Context",
    description: "Ground a model with summary and recent memory resources before architecture work or review.",
    arguments: [
      {
        name: "repo",
        title: "Repository",
        description: "Repository name. Optional when it can be inferred from roots or the local memory store.",
        required: false,
      },
    ],
  },
  "active-tasks-review-rich": {
    title: "Active Tasks Review Rich",
    description: "Review the current task queue and memory context for a repository using embedded MCP resources.",
    arguments: [
      {
        name: "repo",
        title: "Repository",
        description: "Repository name. Optional when it can be inferred from roots or the local memory store.",
        required: false,
      },
      {
        name: "objective",
        title: "Objective",
        description: "Optional review objective, such as triage, execution planning, or blocker analysis.",
        required: false,
      },
    ],
  },
};

export function listPrompts(
  db: SQLiteStore,
  session?: SessionContext,
  params?: { cursor?: string; limit?: number },
) {
  const allPrompts = getPromptCatalog(db, session);
  const limit = normalizeLimit(params?.limit);
  const offset = decodeCursor(params?.cursor);
  const prompts = allPrompts.slice(offset, offset + limit);
  const nextOffset = offset + prompts.length;

  return {
    prompts,
    nextCursor: nextOffset < allPrompts.length ? encodeCursor(nextOffset) : undefined,
  };
}

export function getPrompt(
  name: string,
  args: Record<string, unknown> | undefined,
  db: SQLiteStore,
  session?: SessionContext,
): PromptDefinition {
  const promptName = String(name || "");
  const promptArgs = args ?? {};

  if (promptName in DYNAMIC_PROMPTS) {
    return buildDynamicPrompt(promptName, promptArgs, db, session);
  }

  const prompt = PROMPTS[promptName as keyof typeof PROMPTS];
  if (!prompt) {
    throw invalidPromptParams(`Unknown prompt: ${promptName}`);
  }

  validatePromptArguments(promptName, prompt.arguments ?? [], promptArgs);

  const result = JSON.parse(JSON.stringify(prompt)) as PromptDefinition;
  result.title = result.title || humanizePromptName(result.name);
  result.messages = result.messages.map((message) => substitutePromptMessage(message, promptArgs));
  return result;
}

export function completePromptArgument(
  promptName: string,
  argumentName: string,
  argumentValue: string,
  contextArguments: Record<string, unknown>,
  dataSources: {
    repos: string[];
    tags: string[];
    filePaths: string[];
    tasks: Array<{ id: string; task_code: string; title: string }>;
  },
) {
  const prompt = promptName in DYNAMIC_PROMPTS
    ? {
        name: promptName,
        arguments: DYNAMIC_PROMPTS[promptName].arguments,
      }
    : PROMPTS[promptName as keyof typeof PROMPTS];

  if (!prompt) {
    throw invalidPromptParams(`Unknown prompt: ${promptName}`);
  }

  const declaredArgument = (prompt.arguments ?? []).find((entry) => entry.name === argumentName);
  if (!declaredArgument) {
    throw invalidPromptParams(`Unknown prompt argument "${argumentName}" for prompt "${promptName}"`);
  }

  if (argumentName === "repo") {
    return rankCompletionValues(dataSources.repos, argumentValue);
  }

  if (argumentName === "file_path") {
    return rankCompletionValues(dataSources.filePaths, argumentValue);
  }

  if (argumentName === "task_id") {
    return rankCompletionValues(dataSources.tasks.map((task) => task.id), argumentValue);
  }

  if (argumentName === "tech_stack") {
    return rankCompletionValues(dataSources.tags, argumentValue);
  }

  if (argumentName === "tags") {
    const parts = argumentValue.split(",");
    const activePart = parts[parts.length - 1]?.trim() ?? "";
    const suggestions = rankCompletionValues(dataSources.tags, activePart);
    if (parts.length <= 1) {
      return suggestions;
    }

    const prefix = parts.slice(0, -1).map((part) => part.trim()).filter(Boolean).join(", ");
    return suggestions.map((value) => `${prefix}, ${value}`);
  }

  return rankCompletionValues([], argumentValue);
}

function getPromptCatalog(db: SQLiteStore, session?: SessionContext): PromptCatalogEntry[] {
  const staticPrompts = Object.values(PROMPTS).map((prompt) => ({
    name: prompt.name,
    title: humanizePromptName(prompt.name),
    description: prompt.description,
    arguments: prompt.arguments ?? [],
  }));

  const dynamicPrompts = Object.entries(DYNAMIC_PROMPTS).map(([name, prompt]) => ({
    name,
    ...prompt,
  }));

  return [...staticPrompts, ...dynamicPrompts];
}

function buildDynamicPrompt(
  name: string,
  args: Record<string, unknown>,
  db: SQLiteStore,
  session?: SessionContext,
): PromptDefinition {
  validatePromptArguments(name, DYNAMIC_PROMPTS[name].arguments, args);

  const repo = resolvePromptRepo(args, db, session);
  const focus = typeof args.focus === "string" && args.focus.trim() ? args.focus.trim() : undefined;
  const objective = typeof args.objective === "string" && args.objective.trim() ? args.objective.trim() : undefined;

  switch (name) {
    case "workspace-briefing-rich":
      return {
        name,
        title: DYNAMIC_PROMPTS[name].title,
        description: DYNAMIC_PROMPTS[name].description,
        arguments: DYNAMIC_PROMPTS[name].arguments,
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                `Create a grounded workspace briefing${repo ? ` for repository "${repo}"` : ""}.`,
                focus ? `Prioritize focus area: ${focus}.` : "Prioritize architecture decisions, active tasks, and current workspace boundaries.",
                "Use the attached MCP resources as primary evidence before using tools.",
              ].join(" "),
            },
          },
          createResourceMessage("session://roots", "application/json"),
          ...(repo ? [
            createResourceMessage(`memory://summary/${repo}`, "text/plain"),
            createResourceMessage(`tasks://current?repo=${encodeURIComponent(repo)}`, "application/json"),
            createResourceMessage(`memory://index?repo=${encodeURIComponent(repo)}`, "application/json"),
          ] : []),
        ],
      };

    case "repo-architecture-context":
      return {
        name,
        title: DYNAMIC_PROMPTS[name].title,
        description: DYNAMIC_PROMPTS[name].description,
        arguments: DYNAMIC_PROMPTS[name].arguments,
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: repo
                ? `Review the attached summary and memory index for repository "${repo}" before proposing any architectural changes.`
                : "Review the attached workspace roots and available repository context before proposing any architectural changes.",
            },
          },
          createResourceMessage("session://roots", "application/json"),
          ...(repo ? [
            createResourceMessage(`memory://summary/${repo}`, "text/plain"),
            createResourceMessage(`memory://index?repo=${encodeURIComponent(repo)}`, "application/json"),
          ] : []),
        ],
      };

    case "active-tasks-review-rich":
      return {
        name,
        title: DYNAMIC_PROMPTS[name].title,
        description: DYNAMIC_PROMPTS[name].description,
        arguments: DYNAMIC_PROMPTS[name].arguments,
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                `Review the active task queue${repo ? ` for repository "${repo}"` : ""}.`,
                objective ? `Goal: ${objective}.` : "Identify the most important next actions, blockers, and stale work.",
                "Base the review on the attached MCP resources.",
              ].join(" "),
            },
          },
          ...(repo ? [
            createResourceMessage(`tasks://current?repo=${encodeURIComponent(repo)}`, "application/json"),
            createResourceMessage(`memory://summary/${repo}`, "text/plain"),
          ] : [createResourceMessage("session://roots", "application/json")]),
        ],
      };

    default:
      throw invalidPromptParams(`Unknown prompt: ${name}`);
  }
}

function createResourceMessage(uri: string, mimeType?: string): PromptMessage {
  return {
    role: "user",
    content: {
      type: "resource",
      resource: {
        uri,
        mimeType,
      },
    },
  };
}

function validatePromptArguments(
  promptName: string,
  definitions: PromptArgument[],
  args: Record<string, unknown>,
) {
  const missing = definitions
    .filter((entry) => entry.required)
    .filter((entry) => {
      const value = args[entry.name];
      return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
    })
    .map((entry) => entry.name);

  if (missing.length > 0) {
    throw invalidPromptParams(`Missing required prompt arguments for "${promptName}": ${missing.join(", ")}`);
  }
}

function substitutePromptMessage(message: PromptMessage, args: Record<string, unknown>): PromptMessage {
  if (!message.content || message.content.type !== "text" || typeof message.content.text !== "string") {
    return message;
  }

  let text = message.content.text;
  for (const [key, value] of Object.entries(args)) {
    const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, "g");
    text = text.replace(placeholder, String(value));
  }

  return {
    ...message,
    content: {
      ...message.content,
      text,
    },
  };
}

function resolvePromptRepo(
  args: Record<string, unknown>,
  db: SQLiteStore,
  session?: SessionContext,
) {
  const argRepo = typeof args.repo === "string" && args.repo.trim() ? args.repo.trim() : undefined;
  if (argRepo) return argRepo;

  const inferredRepo = inferRepoFromSession(session);
  if (inferredRepo) return inferredRepo;

  const repos = typeof db.listRepos === "function" ? db.listRepos() : [];
  return repos[0];
}

function humanizePromptName(name: string) {
  return name
    .split("-")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function normalizeLimit(limit: unknown) {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return 25;
  }
  return Math.min(100, Math.max(1, Math.trunc(limit)));
}

function invalidPromptParams(message: string) {
  const error = new Error(message) as Error & { code: number };
  error.code = -32602;
  return error;
}
