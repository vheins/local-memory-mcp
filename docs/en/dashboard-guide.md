# Web Dashboard: Global Command Center + Repo Workspace

The **MCP Local Memory Dashboard** now serves two jobs at once:

- **Global orchestration** for the agent coordinator.
- **Per-repository execution** for detailed work inside one repo.

It keeps the dashboard aligned with the same coordination model exposed by the MCP tools: tasks, claims, handoffs, standards, and memories all share one operational flow.

## Key Capabilities

- **Global Command Center:** The `Dashboard` tab shows cross-repository workload, coordination pressure, throughput, and the repos that need attention first.
- **Selected Repo Pulse:** The same `Dashboard` tab keeps repo-specific memory, task, and execution metrics for the currently selected repository.
- **Task Coordination Visibility:** Task board cards and task detail drawers now surface active claims and pending handoffs directly.
- **Claims Operations:** The `Handoffs` tab shows active claims and lets you release stale ownership without leaving the dashboard.
- **Handoff Operations:** Handoff rows now expose richer transfer context including linked `task_code`, `updated_at`, `expires_at`, and structured `context`.
- **Reference Alignment:** Dashboard actions and MCP tools now follow the same flow for task status updates and coordination cleanup.

## How to Start

Run the dashboard from the repository root:

```bash
npx @vheins/local-memory-mcp dashboard
```

Then open `http://localhost:3456`.

## How to Use

### 1. Orchestrator Mode
Use the `Dashboard` tab before drilling into a repo.

- Review **Global Command Center** for repo count, active repos, blocked tasks, active claims, and pending handoffs.
- Use the **Attention Board** to identify which repositories have the highest pressure from blocked work, queue buildup, or coordination overhead.
- Keep one repository selected in the sidebar to maintain a live repo pulse underneath the global overview.

### 2. Repository Execution Mode
Once a repo is selected:

- Open the `Tasks` tab for the kanban board.
- Watch task cards for active coordination badges showing current claim owners or pending handoffs.
- Open the task drawer to inspect detailed coordination state before moving a task or taking ownership.

### 3. Claims and Handoffs
Use the `Handoffs` tab as the coordination console.

- **Claims:** Inspect active ownership across the selected repo and release stale claims when reassignment is needed.
- **Handoffs:** Create transfer context for unfinished work, inspect structured context, and close consumed or stale handoffs.
- **Cleanup:** Completing or canceling a task through the dashboard now follows MCP `task-update`, so active claims are released and linked pending handoffs are expired automatically.

## Coordination Model

The dashboard mirrors the MCP tool flow:

- `task-claim` creates ownership
- `claim-list` inspects ownership
- `claim-release` clears stale ownership
- `handoff-create` transfers unfinished work
- `handoff-list` inspects queue state
- `handoff-update` closes stale or consumed transfers
- `task-update` is the authoritative status transition path

This means the dashboard is no longer a separate mutation path for tasks. Coordination cleanup and task lifecycle rules stay consistent between UI and MCP callers.

## Notes

- Most tabs remain **per-repository**.
- The `Dashboard` tab is intentionally **hybrid**: global overview first, selected repository pulse second.
- If no repository is selected, the `Dashboard` tab still works in global mode.

## Disclaimer

**THE DASHBOARD IS PROVIDED "AS IS"**, without warranty of any kind. It is intended for manual inspection and management of local data.
