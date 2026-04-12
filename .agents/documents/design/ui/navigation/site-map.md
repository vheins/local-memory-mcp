# Navigation Structure Design

## High-Level Tree
Since this is a lightweight developer tool dashboard, the navigation is flat and primarily tab/sidebar driven.

- `/` (Dashboard Home)
  - **Sidebar:** Repository Selector (Dropdown/List of detected `.git` scopes).
  - **Main Content Area (Tabbed):**
    - **Tab 1: Tasks (Kanban/List view)**
      - `?task={id}` -> Opens Task Detail Drawer.
    - **Tab 2: Memories (Feed/Grid view)**
      - `?memory={id}` -> Opens Memory Detail Drawer.
    - **Tab 3: Settings/Stats**
      - Displays global usage telemetry, DB size, and model loading status.

## Access Levels
- **Local Access Only:** No authentication required as it binds to the local `localhost` IP.

## Site Map Text Representation
```text
Dashboard Root
├── Repo Selector
├── Tasks View
│   └── Task Detail Drawer
├── Memories View
│   ├── Search Bar
│   ├── Filter by Tag
│   └── Memory Detail Drawer
└── System Stats
```