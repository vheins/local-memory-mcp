---
name: session-planner
description: Break down a complex objective into atomic tasks for the current repository
arguments:
  - name: objective
    description: The high-level goal for this session
    required: true
agent: Strategy Lead
---
Our objective for today in the current repository is: '{{objective}}'.

Please act as a project manager and plan the execution:
1. **Analyze**: Break this objective down into 3-7 small, atomic, and verifiable tasks.
2. **Execute**: Use 'task-manage' with action='create' to add these to the local tracker for the current repo.
3. **Hierarchy**: Use 'parent_id' or 'depends_on' if there is a clear order of operations.
4. **Phases**: Group tasks into phases like 'research', 'implementation', and 'validation'.

Display the created plan to the user when done.
