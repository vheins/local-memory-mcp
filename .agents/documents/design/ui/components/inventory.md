# Svelte Component Inventory

This document tracks the UI components implemented in the Svelte dashboard.

## 1. Top-Level Layout
- **`App.svelte`**
  - Path: `src/dashboard/ui/src/App.svelte`
  - Purpose: Root application shell, tab orchestration, global state coordination.
- **`RepoSidebar.svelte`**
  - Purpose: Repository switcher with collapsible state and active status indicators.
- **`TopBar.svelte`**
  - Purpose: Header containing global refresh, sync status, and mobile menu triggers.

## 2. Feature-Specific Components

### Memory Management
- **`MemoryList.svelte`**: Interactive feed for memory units with infinite scroll support.
- **`MemoryDrawer.svelte`**: Multi-purpose drawer for creating, viewing, and editing memories.
- **`BulkImportModal.svelte`**: Standardized file upload interface for importing JSON/Markdown data.

### Task Orchestration
- **`KanbanBoard.svelte`**: Visual task management board implementing the 4 primary active swimlanes (`backlog`, `pending`, `in_progress`, `completed`).
- **`TaskCard.svelte`**: Data-dense card showing priority, task code, and recent activity.
- **`AddTaskModal.svelte`**: Focused modal for manual task entry.

### Telemetry & Stats
- **`StatsWidget.svelte`**: Real-time database and memory metrics (total units, hits, misses).
- **`TaskStatsWidget.svelte`**: Visual summary of task completion rates and priorities.
- **`TimeStatsWidget.svelte`**: Metrics tracking task duration and efficiency.
- **`RecentActions.svelte`**: Paginated audit log of all system tool calls and results.

### Reference System
- **`ReferenceTab.svelte`**: Dedicated view for inspecting MCP Capabilities (Tools, Prompts, Resources).
- **`ReferenceDrawer.svelte`**: Displays detailed JSON schemas and documentation for individual reference items.

## 3. Utility Components
- **`Icon.svelte`**: SVG icon wrapper with Lucid-inspired iconography.
- **`DetailDrawer.svelte`**: Abstract base for slide-out detail panels.