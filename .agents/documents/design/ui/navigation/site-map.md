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
   - Goal: Chronological audit trail of agent interactions.
   - Content: `RecentActions` Feed (Tool calls, queries, result counts).
3. **Memories**
   - Goal: Knowledge exploration and management.
   - Content: Searchable `MemoryList`, `New Memory` trigger.
4. **Tasks**
   - Goal: Work state coordination for agents.
   - Content: `KanbanBoard`, `Add Task` trigger.
5. **Reference**
   - Goal: Inspecting technical MCP surface.
   - Content: Tool definitions, Prompt schemas, Resource paths.

---

## 2. Drawer & Modal Hierarchy

Navigation is supplemented by contextual slide-over panels:

- **Detail Drawer**: Unified viewer for Task and Memory mutations (Query params: `?task={id}` or `?memory={id}`).
- **Reference Drawer**: Schema viewer for MCP capabilities.
- **Bulk Import Modal**: Administrative tool for data seeding.

---

## 3. Site Map Visual Representation

```text
Dashboard Root (/)
├── Repository Context (Sidebar)
│   ├── Repo A (Active)
│   └── Repo B
├── Main View (Tab Groups)
│   ├── 1. Dashboard (Overview Widgets)
│   ├── 2. Activity (Interaction Log)
│   ├── 3. Memories (Knowledge Base)
│   │   └── Memory Detail (Drawer)
│   ├── 4. Tasks (Kanban Board)
│   │   └── Task Detail (Drawer)
│   └── 5. Reference (Capabilties Index)
│       └── Schema View (Drawer)
└── Global Actions (TopBar)
    ├── Refresh Sync
    └── Theme Toggle (Light/Dark)
```