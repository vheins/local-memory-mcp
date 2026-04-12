# Dashboard Layout Design (Svelte UI)

## Overall Grid Structure
- **Container:** Full-screen (`100vw`, `100vh`), flexbox layout.
- **Sidebar (Left):** Fixed width (`250px`), scrollable Y-axis. Contains the list of available repositories.
- **Main Content (Right):** Flex-grow (`1`), scrollable Y-axis. Contains the Topbar, Tabs, and the primary data view (Tasks/Memories).
- **Overlay Layer:** Fixed position (`z-index: 50`) sliding drawer from the right edge for detailed views.

## Widgets & Visualizations
### 1. Stats Widget (Top Bar)
- **Data:** Total DB size, Model loaded status, active repository.
- **Layout:** Horizontal flex row, small badges/chips.

### 2. Task Kanban Board (Tab 1)
- **Data:** Tasks grouped by status (Pending, Active, Completed).
- **Layout:** Horizontal scrollable row of columns. Each column is a vertical flex list of Task Cards.

### 3. Memory Feed (Tab 2)
- **Data:** List of memories ordered by `created_at` or search relevance.
- **Layout:** CSS Grid (`repeat(auto-fill, minmax(300px, 1fr))`) for cards, or a simple dense list view.

## Empty/Loading States
- **Loading:** Skeleton screens mimicking card shapes.
- **Empty Repo:** "Select a repository from the sidebar to view tasks and memories."
- **Empty Search:** "No memories found matching your query."