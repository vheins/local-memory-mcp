---
name: task-memory-executor
description: Execute all pending tasks for the current repository, updating status and storing handoffs in the task backlog.
arguments: []
agent: Task Executor
---
# Skill: task-memory-executor

## Purpose

You are tasked with executing all available tasks for the current repository.

## Instructions

---
description: Execute all pending tasks for the current repository
---

Please follow this strict execution flow:

1. **Identify Repository**: Determine the current repository name (e.g., from git config or workspace context).
2. **Fetch Tasks**: Call '@vheins/local-memory-mcp tools task-list' for the identified repository for statuses 'pending' and 'in_progress'.
3. **Filter Stale**: Identify 'in_progress' tasks that are **stale** (stale is defined as > 30 Minutes without update, often because an agent stopped or crashed).
4. **Single-Task Execution Loop (STRICT)**: You MUST process tasks EXACTLY ONE AT A TIME. DO NOT update multiple tasks to 'in_progress' simultaneously. For the SINGLE task you select:
    - **Start**: Call '@vheins/local-memory-mcp tools task-update' to set status='in_progress' for this task ONLY. Provide current agent/role information in the metadata.
    - **Execute**: Perform the work described in the task title and description.
    - **Inspect Codebase Logic & Documentation First (MANDATORY)**: Before marking anything done, inspect the relevant code paths, call sites, configs, tests, and affected modules in the repository. Also read the relevant documentation, as it might need to be updated or fixed. Do not infer correctness from file presence alone.
    - **Validate Behavior (MANDATORY)**: Ensure the implementation logic satisfies the task intent and follows project standards. Validation must focus on behavior, control flow, data flow, and integration points, not just whether a file/class/function exists.
    - **Complete Only With Evidence**: Call '@vheins/local-memory-mcp tools task-update' to set status='completed' only after recording concrete evidence in the 'comment' field. The comment must include: files inspected, logic verified, checks/tests run (or why they could not run), and the exact reason the task is considered complete.
    - **Compact Context**: Summarize key learnings, decisions, and patterns discovered during task execution. Store critical insights as memory entries (type: 'code_fact' or 'pattern') using '@vheins/local-memory-mcp tools memory-store'.
    - **Commit**: Perform an atomic git commit and push for the changes made in the task.
    - **Handoff**: Use '@vheins/local-memory-mcp tools task-update' to document **detailed fix steps**, milestones, project-specific knowledge gained during execution, and validation evidence. If complex, decompose into smaller tasks using '@vheins/local-memory-mcp tools task-create'.
    - **Next**: Repeat this loop for the next 'pending' or 'stale' task.
5. **Backlog Migration**: Once all 'pending' and 'in_progress' tasks are completed or blocked, fetch tasks with status='backlog'. If any exist, select up to 20 tasks (prioritizing by priority field) and update their status to 'pending' using '@vheins/local-memory-mcp tools task-update' to ensure the next agent has work ready.
6. **Report**: After processing all tasks, provide a summary of your progress.

## Mandatory Validation Rules

Before a task can be marked `completed`, the agent **must** satisfy all applicable rules below:

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
