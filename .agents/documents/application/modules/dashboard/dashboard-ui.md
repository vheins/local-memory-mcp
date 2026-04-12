# Feature Documentation: Dashboard UI

## Responsibility
The Dashboard UI provides a responsive, high-fidelity interface for human interaction with the local memory system. It serves as both a monitoring tool and a manual administrative console.

## Primary Navigation
The interface is organized into 5 functional tabs:
1. **Dashboard**: High-level stats, volume trends, and performance metrics.
2. **Activity**: A chronological audit log of all system actions (with burst condensation).
3. **Memories**: Knowledge search, curation, and bulk import/export.
4. **Tasks**: A Kanban view of all development initiatives with drag-and-drop state transitions.
5. **Reference**: A self-documenting index of MCP capabilities (Tools/Prompts).

## Svelte 5 Patterns
The UI leverages the latest Svelte 5 "Runes" for predictable state management:
- **$state**: Used for tracking global repository switching and tab selection.
- **$derived**: Automates pagination calculations and filtered memory views.
- **$effect**: Manages synchronization with `localStorage` for visual settings (Theme, PageSize).

## UI Architecture Components
- **`App.svelte`**: Tab orchestration and global state context.
- **`Dashboard.svelte`**: Grid of analytics widgets using SVG charts.
- **`Kanban.svelte`**: Column-based view for task lifecycles (`backlog` -> `pending` -> `in_progress` -> `completed`).
- **`MemoryExplorer.svelte`**: Hybrid list/card view with semantic search input.

## Technical Patterns
- **API Communication**: Centralized via `api.ts` utilizing `fetch` with standardized error handling for 4xx/5xx responses.
- **Optimistic Updates**: Immediate UI feedback for task status changes, with rollback on server failure.
- **Glass Design System**: Custom Vanilla CSS utilities for transparency, backdrop-blurs, and sleek dark-mode aesthetics.
- **Responsive Adaptive Design**:
    - **Desktop**: Full grid layout with persistent sidebar.
    - **Mobile**: Collapsible navigation with bottom-sheet detail views.
