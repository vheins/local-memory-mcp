# Main Wireframe (Glass Interface)

This document provides a low-fidelity visual map of the primary dashboard screen.

## 1. Global Shell

```text
+-------------------------------------------------------------+
| [O] [O] [O] | Logo  | Search Agents...                [☼] | TopBar
+-------------------------------------------------------------+
| Side  |                                                     |
| Bar   |  [ Dashboard ] [ Activity ] [ Memories ] [ Tasks ]  | Tab Nav
| (Repo)|                                                     |
+-------+-----------------------------------------------------+
| [R]   |                                                     |
| [R]   |  +-----------------------------------------------+  |
| [R]   |  |                                               |  |
| [R]   |  |   MAIN CONTENT AREA (Glass Card Container)   |  |
| [R]   |  |                                               |  |
| [R]   |  +-----------------------------------------------+  |
|       |                                                     |
| [<<]  |                                                     |
+-------+-----------------------------------------------------+
```

## 2. Component Placement

- **Sidebar (Left)**: Floating glass panel with repository avatars and names. Collapsible to icons only.
- **Header (Top)**: Sticky glass bar with global actions (Refresh, Sync Status, Theme Toggle).
- **Tab Bar (Sub-header)**: Centered pill-shaped navigation group.
- **Main View**: A grid-based playground that swaps content based on the active tab.

## 3. Interaction Zones

1. **Repo Selector**: Triggers a global data reload (Stats, Tasks, Memories).
2. **Search Bar**: Hybrid search spanning both Task codes and Memory content.
3. **Detail Layer**: Any card click triggers an overlaying **Detail Drawer** from the right edge, maintaining the scroll position of the main view.