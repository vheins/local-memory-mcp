# Test Scenarios: Dashboard

## Header & Navigation

- [Dashboard Module Overview](../../modules/dashboard/overview.md)
- [Dashboard UI Feature](../../modules/dashboard/dashboard-ui.md)
- [Memories API](../../api/dashboard/api-memories.md)
- [Tasks API](../../api/dashboard/api-tasks.md)
- [System API](../../api/dashboard/api-system.md)

Integration and UI verification for the web-based dashboard (Svelte 5 + Express).

## 1. Multi-Tab Navigation

- **Dashboard Tab:** Verify stats widgets (Total Memories, Active Tasks, Agent Activity) populate correctly upon repo selection.
- **Activity Tab:** Verify chronological stream of interactions with burst condensation. Check tool calls appear at the top.
- **Memories Tab:** Verify infinite scroll load. Check "Bulk Import" modal opens and validates JSON.
- **Tasks Tab:** Verify Kanban swimlanes (backlog, pending, in_progress, completed). Drag a card from `pending` to `in_progress`. Check card status updates visually.
- **Reference Tab:** Filter by "memory". Verify clicking a tool displays its JSON schema correctly.
- **Standards Tab:** Verify coding standards list loads and search filters work.
- **Handoffs Tab:** Verify handoff list with status/agent filters.
- **Knowledge Graph Tab:** Verify entities and relations render as force-directed graph.

## 2. Global State Persistence

- **Theme:** Toggle to Dark Mode. Refresh page. Verify interface remains in Dark Mode.
- **Repo Sticky:** Select "repo-a". Refresh page. Verify "repo-a" remains selected and data is re-fetched.

## 3. CRUD Operations

- **Create Memory:** Via Memory Drawer. Verify new memory appears in list.
- **Edit Task:** Via Detail Drawer. Change status. Verify Kanban updates.
- **Delete Memory:** Via memory context menu. Verify removal from list.
- **Bulk Import:** Upload valid JSON file. Verify all items imported.

## 4. Error Handling & Transitions

- **Constraint Error:** Attempt to drag card from `backlog` to `completed`. Verify card "snaps back" and a Toast notification explains the transition rule.
- **Network Lost:** Disconnect backend. Verify persistent red error banner appears.
- **Empty State:** Switch to a brand-new repo. Verify "No data yet" illustrations display.

## 5. Performance

- **Switching Speed:** Rapidly click different repositories. Verify active requests are aborted and only latest data renders (no race conditions).
- **Large List:** Render 500+ memories. Verify smooth scrolling and search filter responsiveness.

## 6. API Endpoints

- `GET /api/`: Health check with version and uptime.
- `GET /api/stats?repo=`: Repository statistics.
- `GET /api/repos`: List all repositories.
- `GET /api/memories?repo=`: Paginated memories.
- `GET /api/tasks?repo=`: Paginated tasks.
- `GET /api/standards?repo=`: Paginated coding standards.
- `GET /api/graph?repo=`: Knowledge graph data.
- `GET /api/coordination/handoffs?repo=`: Handoff list.
- `GET /api/coordination/claims?repo=`: Claim list.
