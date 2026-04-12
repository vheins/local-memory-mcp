# Svelte Component Inventory

## 1. Layout Components
- **`App.svelte`**
  - Purpose: Root container managing the router, theme, and data-fetching.
- **`RepoSidebar.svelte`**
  - Purpose: Displays list of repos. Emits selected repo event.
- **`TopBar.svelte`**
  - Purpose: Global search input, theme toggle, tab navigation.
- **`DetailDrawer.svelte`** / **`MemoryDrawer.svelte`**
  - Purpose: Reusable slide-out container for viewing/editing details.

## 2. Widget Components
- **`StatsWidget.svelte`**
  - Purpose: Show DB size, model status, etc.
- **`KanbanBoard.svelte`**
  - Purpose: Container for task columns.
- **`MemoryList.svelte`**
  - Purpose: Feed view for memories.

## 3. Atomic UI Components
- **`TaskCard.svelte`**
  - Props: `task` object.
  - States: Default, Hover (shadow elevation), Active (highlight border).
- **`Icon.svelte`**
  - Props: `name` (string), `size` (string).
  - Purpose: Renders inline SVG icons.