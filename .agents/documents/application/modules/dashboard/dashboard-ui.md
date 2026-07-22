# Feature Documentation: Dashboard UI

## Header & Navigation

- [Module Overview](overview.md)
- [Memories API](../../api/dashboard/api-memories.md)
- [Tasks API](../../api/dashboard/api-tasks.md)
- [System API](../../api/dashboard/api-system.md)
- [Dashboard Tests](../../testing/dashboard/test-dashboard.md)

## Responsibility

The Dashboard UI provides a responsive, high-fidelity interface for human interaction with the local memory system. It serves as both a monitoring tool and a manual administrative console.

## Primary Navigation

The interface is organized into 8 functional tabs:

1. **Dashboard**: High-level stats, volume trends, and performance metrics.
2. **Activity**: A chronological audit log of all system actions (with burst condensation).
3. **Memories**: Knowledge search, curation, and bulk import/export.
4. **Tasks**: A Kanban view of all development initiatives with drag-and-drop state transitions.
5. **Reference**: A self-documenting index of MCP capabilities (Tools/Prompts/Resources).
6. **Standards**: Browse and search coding standard entries.
7. **Handoffs**: View and manage agent-to-agent handoffs.
8. **Knowledge Graph**: Interactive force-directed graph visualization.

## Svelte 5 Patterns

The UI leverages the latest Svelte 5 "Runes" for predictable state management:

- **$state**: Used for tracking global repository switching, tab selection, and active drawer.
- **$derived**: Automates pagination calculations, filtered memory views, and computed stats.
- **$effect**: Manages synchronization with `localStorage` for visual settings (Theme, PageSize).

## UI Components

### Top-Level Layout

- **`App.svelte`**: Root application shell, tab orchestration, global state coordination.
- **`RepoSidebar.svelte`**: Repository switcher with collapsible state and active status indicators.
- **`TopBar.svelte`**: Header containing global refresh, sync status, and mobile menu triggers.
- **`FloatingChat.svelte`**: Floating chat interface for manual MCP tool invocation.

### Memory Management

- **`MemoryList.svelte`**: Interactive feed for memory units with infinite scroll support.
- **`MemoryDrawer.svelte`**: Multi-purpose drawer for creating, viewing, and editing memories.
- **`BulkImportModal.svelte`**: Standardized file upload interface for importing JSON data.

### Task Orchestration

- **`KanbanBoard.svelte`**: Visual task management board with 4 swimlanes and drag-and-drop.
- **`DetailDrawer.svelte`**: Unified viewer for Task and Memory details.
- **`AddTaskModal.svelte`**: Focused modal for manual task entry.
- **`QuickCreateFAB.svelte`**: Floating action button for quick task creation.

### Telemetry & Stats

- **`StatsWidget.svelte`**: Real-time database and memory metrics.
- **`TaskStatsWidget.svelte`**: Visual summary of task completion rates and priorities.
- **`TimeStatsWidget.svelte`**: Metrics tracking task duration and efficiency.
- **`RecentActions.svelte`**: Paginated audit log with burst condensation.

### Knowledge Graph

- **`KGGraph.svelte`**: Force-directed graph canvas renderer for entities and relations.
- **`KGGraphShell.svelte`**: Full-page KG visualization container with controls.
- **`KGGraphHeader.svelte`**: Header with KG controls and filters.
- **`KGZeroEdgeStatus.svelte`**: Empty state component for graphs with no relations.

### Additional Panels

- **`StandardsPanel.svelte`**: Browse and search coding standards with detail view.
- **`HandoffsPanel.svelte`**: View and manage agent handoffs and claims.
- **`ReferenceTab.svelte`**: MCP capabilities browser (Tools, Prompts, Resources).
- **`ReferenceDrawer.svelte`**: Displays detailed JSON schemas for individual references.
- **`StandardDetailPanel.svelte`**: Detail view for individual coding standards.
- **`AgentArena.svelte`**: Multi-agent coordination overview.
- **`GlobalCommandCenter.svelte`**: Global search and command interface.

### Utility Components

- **`Icon.svelte`**: SVG icon wrapper with Lucid-inspired iconography.

## Technical Patterns

- **API Communication**: Centralized via `api.ts` utilizing `fetch` with standardized error handling for 4xx/5xx responses.
- **Svelte Stores**: Active tab, current repo, and UI state managed via Svelte stores in `stores.ts`.
- **Composables**: Logic extracted to `composables/` (use-prefixed modules) for code organization: `useApp.ts`, `useBulkImport.ts`, `useMemoryList.ts`, `useStatsWidget.ts`, `useRepoSidebar.ts`, etc.
- **Optimistic Updates**: Immediate UI feedback for task status changes, with rollback on server failure.
- **Glass Design System**: Custom CSS with transparency, backdrop-blurs (28px), and sleek dark-mode aesthetics.
- **Responsive Adaptive Design**:
  - **Desktop (>1024px)**: Full sidebar, multi-column grids.
  - **Tablet (768-1024px)**: Sidebar collapses to icons, main content stays multi-column.
  - **Mobile (<768px)**: Sidebar hidden (mobile drawer), single-column grids, Kanban with horizontal touch-scrolling.
