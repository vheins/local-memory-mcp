---
name: server-instructions
description: Main instructions for the MCP server
---

Local Memory MCP — persistent memory, task coordination, and coding standards for AI agents.

## Data Scoping

All data (memories, tasks, handoffs, claims) is scoped by **owner/repo**:

- **owner** = organization/namespace (e.g., GitHub org, username)
- **repo** = project/repository name

Pass both `owner` and `repo` whenever a tool requires them. The `owner/repo` pair forms the unique data boundary.

### Owner Rule (CRITICAL)

The `owner` field MUST be the GitHub username or organization that OWNS the repository. For example:

- Repo `vheins/sentinel-agent` → owner=`vheins`
- Repo `my-org/my-project` → owner=`my-org`

NEVER use the agent's name (e.g., `sentinel`, `test-executor`, `claude`) as the owner.
NEVER guess the owner from the working directory path.

If unsure, run `git remote -v` in the project directory — the remote URL (e.g., `git@github.com:vheins/sentinel-agent.git`) gives you both `owner` and `repo`.

**Two ways to provide owner/repo:**

1. **Explicit** (preferred — most reliable):
   ```json
   { "owner": "vheins", "repo": "sentinel-agent" }
   ```
2. **Shorthand** — use `owner/repo` format for `repo`; the server auto-extracts `owner`:
   ```json
   { "repo": "vheins/sentinel-agent" }
   ```

Violation: tasks created with a wrong owner will be invisible to other agents querying with the correct owner.

## Session Start Mode

Entry=orient → hydrate → ready Guard: S(N) req S(N-1)✅

S0 | agent-context (one-call context: memories + tasks + decisions) OR task-list + handoff-list + memory-search | session start? | active context | —
S1 | standard-search(MANDATORY before code/test/refactor/migrate — task intent, lang, stack, repo filters) | S0✅ | hydrated context | —
S2 | continue to task or respond | S1✅ | ready | —

## Core Workflows

**Memory**: memory-search → memory-detail → memory-store | memory-update

- Durable only (arch, patterns, decisions, fixes)
- memory-acknowledge after code gen from memory
- Global scope = cross-repo only; prefer repo-specific
- decision-log = shortcut for storing decision-type memories (auto-sets type=decision, importance=4)
- session-summarize = archive session as task_archive memory (type=task_archive, importance=3)

**Tasks**: task-list → task-claim(auto → in_progress) → task-update(completed)

- Register via task-create before execution
- NEVER skip in_progress
- Commit: `type(scope): [task-code] message` + `- [Title]` + `  [Summary]`
- Complete auto-releases claims + expires linked handoffs

**Standards**: standard-search → standard-store

- MANDATORY pre-implementation gate
- 1 rule/entry, normative contract

**Handoffs/Claims**: handoff-list → handoff-create | handoff-update | task-claim | claim-release

- Create ONLY for unfinished work (concrete next owner/steps)
- NO handoff for completion summaries → use task-update comments

**Knowledge Graph**: create_entity | create_relation → delete_entity | delete_relation | delete_observation

- Structured entity-relationship storage for domain concepts
- Auto-extracted via NLP Archivist on every memory-store (people, places, orgs, concepts)
- Visualize in Dashboard → Knowledge Graph tab (force-directed graph)

## Available Prompts (slash commands)

### Engineering Roles

- `architecture-design` — architectural planning and ADR generation (System Architect)
- `business-analyst` — bridge business needs with technical solutions (Business Analyst)
- `create-task` — create structured, atomic tasks in Local Memory MCP (Task Planner)
- `csl-from-docs` — create atomic CSL coding standards entries from a local file or directory path (Documentation Processor)
- `csl-scrapper` — scrape trusted documentation from a URL into atomic CSL coding standards entries (Documentation Scraper)
- `data-analyst` — analyze data and generate insights for decision making (Data Analyst)
- `documentation-sync` — sync docs with current codebase state
- `export-task-to-github` — export local tasks to GitHub Issues
- `fix-suggestion` — propose and validate fixes
- `import-github-issues` — import GitHub Issues as local tasks
- `learning-retrospective` — capture lessons and update memory (Knowledge Harvester)
- `memory-agent-core` — behavioral contract for memory-aware agents (Memory Guardian)
- `memory-guided-review` — review using project memory as context
- `memory-index-policy` — strict memory storage criteria
- `project-briefing` — generate repository briefing from memory (Session Concierge)
- `qa-analyst` — design test strategies and ensure software quality (QA Analyst)
- `review-and-audit` — audit documentation against implementation; generate local tasks for gaps
- `review-and-post-issue` — audit documentation against implementation; generate GitHub issues for gaps
- `root-cause-analysis` — structured bug / incident investigation (Diagnostic Lead)
- `scrum-master` — facilitate Scrum ceremonies and remove blockers (Scrum Master)
- `security-analyst` — perform security assessments and threat modeling (Security Analyst)
- `security-triage` — security risk assessment (Security Engineer)
- `senior-code-review` — full code review against stored standards (Principal Reviewer)
- `sentinel-issue-resolver` — autonomous GitHub issue resolution (SENTINEL identity)
- `session-planner` — orient and plan at session start (Strategy Lead)
- `system-analyst` — analyze technical systems and design solution specs (System Analyst)
- `task-management-guidelines` — task tracking and progress management standards
- `task-memory-executor` — execute tasks with memory and standard enforcement
- `tech-affinity-scout` — scout best practices from similar tech projects
- `technical-planning` — feature planning with task decomposition (Technical Architect)
- `tool-usage-guidelines` — tool usage standards and data integrity
