# Navigation Structure Design

This document specifies the routing and navigational hierarchy of the dashboard.

## 1. High-Level Taxonomy

The dashboard utilizes a flat, tab-based navigation model scoped per repository.

### Root Route (`/`)

User must select a **Repository Scope** (Sidebar) before content is populated.

### Primary Navigation Tabs

1. **Dashboard**
   - Goal: High-level system health and volume metrics.
   - Content: `StatsWidget`, `TaskStatsWidget`, `TimeStatsWidget`.
2. **Activity**
   - Goal: Chronological audit trail of agent interactions with burst condensation.
   - Content: `RecentActions` Feed (Tool calls, queries, result counts).
3. **Memories**
   - Goal: Knowledge exploration and management.
   - Content: Searchable `MemoryList`, `Memory Drawer`, `Bulk Import Modal`.
4. **Tasks**
   - Goal: Work state coordination for agents with Kanban board.
   - Content: `KanbanBoard`, `Add Task` modal, `Detail Drawer`.
5. **Reference**
   - Goal: Inspecting technical MCP surface (self-documenting).
   - Content: Tool definitions, Prompt schemas, Resource paths.
6. **Standards**
   - Goal: Browse and manage coding standards.
   - Content: Standards list with language/stack filters, detail panel.
7. **Handoffs**
   - Goal: Multi-agent coordination overview.
   - Content: Handoff list with status filters, claim viewer.
8. **Knowledge Graph**
   - Goal: Visualize entity-relationship graph.
   - Content: Force-directed graph with zoom/pan, entity details.

---

## 2. Drawer & Modal Hierarchy

Navigation is supplemented by contextual slide-over panels:

- **Detail Drawer**: Unified viewer for Task and Memory details (Query params: `?task={id}` or `?memory={id}`).
- **Memory Drawer**: Create/edit memories.
- **Reference Drawer**: Schema viewer for MCP capabilities.
- **Bulk Import Modal**: Administrative tool for data seeding.
- **Add Task Modal**: Quick task creation form.
- **Quick Create FAB**: Floating action button for rapid task creation.

---

## 3. Site Map Visual Representation

```text
Dashboard Root (/)
├── Repository Context (Sidebar)
│   ├── Repo A (Active)
│   └── Repo B
├── Main View (Tab Groups)
│   ├── 1. Dashboard (Overview Widgets)
│   │   ├── StatsWidget (Memories, Tasks, Activity)
│   │   ├── TaskStatsWidget (Completion rates)
│   │   └── TimeStatsWidget (Duration metrics)
│   ├── 2. Activity (Interaction Log)
│   ├── 3. Memories (Knowledge Base)
│   │   ├── Memory Detail (Drawer)
│   │   └── Bulk Import (Modal)
│   ├── 4. Tasks (Kanban Board)
│   │   ├── Task Detail (Drawer)
│   │   └── Add Task (Modal)
│   ├── 5. Reference (Capabilities Index)
│   │   └── Schema View (Drawer)
│   ├── 6. Standards (Coding Rules)
│   │   └── Standard Detail (Panel)
│   ├── 7. Handoffs (Agent Coordination)
│   │   └── Claim List
│   └── 8. Knowledge Graph (Visualization)
│       └── Entity Detail
└── Global Actions (TopBar)
    ├── Refresh Sync
    └── Theme Toggle (Light/Dark)
```
