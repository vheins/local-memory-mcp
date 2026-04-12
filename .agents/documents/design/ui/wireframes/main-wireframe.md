# Screen Wireframe: Main Dashboard

```text
+-----------------------------------------------------------------------------------+
|                                                                                   |
|  [Logo] Local Memory MCP     |  [Search Bar............................] [Stats]  |
|------------------------------+----------------------------------------------------|
|                              |                                                    |
|  REPOSITORIES                |   [ Tasks ]  [ Memories ]  [ Settings ]            |
|                              |                                                    |
|  * vheins/local-memory-mcp   |   +-------------------+  +-------------------+     |
|  - another/project-repo      |   | Pending       (3) |  | Active        (1) |     |
|  - old/project-repo          |   |-------------------|  |-------------------|     |
|                              |   | [TM-01] Setup DB  |  | [TM-02] Create    |     |
|                              |   |                   |  | Task logic        |     |
|                              |   |                   |  |                   |     |
|                              |   +-------------------+  +-------------------+     |
|                              |                                                    |
|                              |                                                    |
|                              |   +-------------------+                            |
|                              |   | Completed     (1) |                            |
|                              |   |-------------------|                            |
|                              |   | [MM-01] Init      |                            |
|                              |   | SQLite            |                            |
|                              |   +-------------------+                            |
|                              |                                                    |
+-----------------------------------------------------------------------------------+
```

## Slide-out Drawer Overlay

```text
+-----------------------------------------------------------------------------------+
|                                                     |                             |
|                                                     |  < Close                    |
|                                                     |-----------------------------|
|                                                     | Task Details                |
|               (Main Content dimmed/blurred)         |                             |
|                                                     | Title: [TM-02] Create Task  |
|                                                     | Status: [Active]            |
|                                                     |                             |
|                                                     | Description:                |
|                                                     | Implement the `task-create` |
|                                                     | tool for the MCP server.    |
|                                                     |                             |
|                                                     | Related Memories:           |
|                                                     | - [Doc] DB Schema           |
|                                                     |                             |
|                                                     | [ Edit ] [ Delete ]         |
|                                                     |                             |
+-----------------------------------------------------------------------------------+
```