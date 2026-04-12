# Dashboard Content Layout

This document details the specific grid layouts for each primary tab in the dashboard.

## 1. Dashboard Tab (Overview)
- **Grid Strategy**: Vertical flow with nested horizontal rows.
- **Components**:
  - `StatsWidget`: Full-width row.
  - `TaskStatsWidget` + `TimeStatsWidget`: Two-column grid (Responsive: Single column on mobile).

## 2. Activity Tab (Log)
- **Grid Strategy**: Single column flex-layout.
- **Container**: `glass card` with internal scrolling to maintain the top-bar visibility.
- **Scroll Pattern**: "Load More" pagination at the bottom of the feed.

## 3. Memories Tab (Explorer)
- **Grid Strategy**: Flex-column with a persistent header (Search + New Memory).
- **List Pattern**: Scrollable list of memory cards. 
- **Responsiveness**: Cards take 100% width of the container.

## 4. Tasks Tab (Kanban)
- **Grid Strategy**: 4-column horizontal scroll group (`min-width: 260px` per column).
- **Columns**: Backlog, To Do (`pending`), In Progress, Completed.
- **Mobile Pattern**: Horizontal scroll with snap-points for single-column viewing.

## 5. Reference Tab (Engine)
- **Grid Strategy**: Master-detail or search-filtered list.
- **Filter Bar**: Sticky top-mount inside the glass card.
- **Drawer Trigger**: Item selection persistent across search refreshes.

---

## 6. Responsive Breakpoints

- **Desktop (>1024px)**: Full sidebar, multi-column grids.
- **Tablet (768px - 1024px)**: Sidebar collapses to icons, main content stays multi-column where possible.
- **Mobile (<768px)**: Sidebar hidden (Mobile drawer menu available), all grids collapse to single-column, Kanban enables horizontal touch-scrolling.