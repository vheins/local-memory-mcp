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
   - Resource: You can also read 'tasks://current?repo={repo}' for a filtered view of active tasks.
   - Coordinate: If a task is already 'in_progress', do not attempt to work on it unless specifically asked to collaborate.

3. Workflow Integration:
   - Plan first: Create tasks for the entire lifecycle (Research -> Strategy -> Execution -> Validation).
   - Atomic Updates: Update the task status to 'in_progress' immediately BEFORE calling implementation tools.
   - Finalize: Only mark a task as 'completed' after successful validation (tests passed). If validation fails, mark as 'blocked' or 'pending' with notes in metadata.`
        }
      }
    ]
  },
  "import-github-issues": {
    name: "import-github-issues",
    description: "Guide for importing GitHub Issues as local tasks",
    arguments: [
      {
        name: "repo",
        description: "GitHub repository in 'owner/repo' format",
        required: true
      }
    ],
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `You are tasked with importing GitHub Issues from the repository {{repo}} into our local task management system.

Please follow these steps:

1. **Access Issues**: Use available GitHub MCP tools to list open issues for the repository {{repo}}.
2. **Review Existing Tasks**: Call 'task-list' for the current local repository to identify tasks already imported.
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
    arguments: [
      { name: "repo", description: "The current repository name", required: true }
    ],
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `I am starting a new session in repository: {{repo}}.

Please perform a briefing to catch up on the project:
1. **Recent Knowledge**: Call 'memory-recap' to see the latest decisions, patterns, and mistakes recorded for this repo.
2. **Current Tasks**: Call 'task-list' to understand what is currently pending or in-progress.
3. **Context Check**: Summarize the top 3 most important architectural decisions you found.
4. **Readiness**: Tell me what you are ready to help with based on the current backlog.`
        }
      }
    ]
  },
  "learning-retrospective": {
    name: "learning-retrospective",
    description: "Extract durable knowledge from recent work",
    arguments: [
      { name: "repo", description: "The current repository name", required: true },
      { name: "task_id", description: "Optional ID of the task just completed", required: false }
    ],
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `We have just finished some work in {{repo}} related to task {{task_id}}. 

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
    description: "Review code for compliance with stored project decisions",
    arguments: [
      { name: "file_path", description: "Path to the file to review", required: true },
      { name: "repo", description: "The current repository name", required: true }
    ],
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Please review the code in '{{file_path}}' for repository '{{repo}}'.

Your goal is to ensure compliance with our stored project knowledge:
1. **Search Constraints**: Use 'memory-search' with current_file_path='{{file_path}}' to find relevant decisions and patterns.
2. **Evaluate Compliance**: Does the code follow established patterns? Does it repeat any known mistakes?
3. **Feedback**: Provide specific suggestions for improvement if you find violations of stored decisions.`
        }
      }
    ]
  },
  "session-planner": {
    name: "session-planner",
    description: "Break down a complex objective into atomic tasks",
    arguments: [
      { name: "objective", description: "The high-level goal for this session", required: true },
      { name: "repo", description: "The current repository name", required: true }
    ],
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Our objective for today in {{repo}} is: '{{objective}}'.

Please act as a project manager and plan the execution:
1. **Analyze**: Break this objective down into 3-7 small, atomic, and verifiable tasks.
2. **Execute**: Use 'task-manage' with action='create' to add these to the local tracker.
3. **Hierarchy**: Use 'parent_id' or 'depends_on' if there is a clear order of operations.
4. **Phases**: Group tasks into phases like 'research', 'implementation', and 'validation'.

Display the created plan to the user when done.`
        }
      }
    ]
  },
  "tech-affinity-scout": {
    name: "tech-affinity-scout",
    description: "Find relevant best practices from other projects with similar tech",
    arguments: [
      { name: "tags", description: "Comma-separated tech tags (e.g., 'react, tailwind')", required: true },
      { name: "repo", description: "The current repository name", required: true }
    ],
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `I am working on {{repo}} using [{{tags}}].

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
    description: "Reconcile memory decisions with local markdown files",
    arguments: [
      { name: "repo", description: "The current repository name", required: true }
    ],
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Please verify if our local documentation (README.md, docs/*.md) is in sync with our stored memories for {{repo}}.

Steps:
1. **Fetch Decisions**: Use 'memory-search' to find all 'decision' type memories for this repo.
2. **Read Docs**: Read the primary project documentation files.
3. **Identify Gaps**: Is there any durable knowledge in the memory that is MISSING from the docs? Is there any documentation that is OUTDATED based on recent decisions?
4. **Propose Updates**: Suggest specific changes to the documentation to reflect the current source of truth.`
        }
      }
    ]
  },
  "task-memory-executor": {
    name: "task-memory-executor",
    description: "Execute all pending tasks for the current repository, updating status and storing handoffs in memory",
    arguments: [],
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `You are tasked with executing all available tasks for the current repository.

Please follow this strict execution flow:

1. **Identify Repository**: Determine the current repository name (e.g., from git config or workspace context).
2. **Fetch Tasks**: Call 'task-list' for the identified repository for statuses 'pending' and 'in_progress'.
3. **Filter Stale**: Identify 'in_progress' tasks that are **stale** (stale is defined as > 30 Minutes without update, often because an agent stopped or crashed).
4. **Process Sequentially**: For each task (all 'pending' + all 'stale in_progress') found:
    - **Start**: Call 'task-update' to set status='in_progress' and provide current agent/role information.
    - **Execute**: Perform the work described in the task title and description.
    - **Validate**: Ensure the work is correct and follows project standards.
    - **Complete**: Call 'task-update' to set status='completed' with a summary of accomplishment in the 'comment' field.
    - **Commit**: Perform an atomic git commit and push for the changes made in the task.
    - **Handoff**: Always use 'memory-store' (type='agent_handoff') to document **detailed fix steps** and project-specific knowledge gained during execution. If the task was complex, decompose it into smaller sub-tasks and store them using 'task-create' (referencing the current task's ID as \`parent_id\`).
5. **Report**: After processing all tasks, provide a summary of your progress.

If a task becomes blocked, update its status to 'blocked' with a **clear reason and recommended next steps for resolution** in the 'comment' field, then move to the next task.`
        }
      }
    ]
  }
};
