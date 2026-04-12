# Test Scenarios: Dashboard

## 1. Frontend Component Testing
- **Positive:** Selecting a repo in the sidebar updates the URL and triggers a data fetch for the Kanban board.
- **Negative:** Attempting to view a repo with zero data displays a "Empty State" illustration and message.

## 2. API Integration Testing
- **Positive (Task Update):** Dragging a card between columns sends a `POST /api/tasks/:id/status` and updates the DB correctly.
- **Negative (Network Failure):** If the backend is unreachable, the UI should display a persistent error banner at the top.

## 3. Database Sync Testing
- **Positive:** Deleting a memory in the dashboard successfully reflects as a "Not Found" error when the MCP server tries to access it via its internal `memory-detail` tool.
- **Edge Case:** Rapidly switching between repositories while data is loading should cancel pending requests to prevent race conditions in the UI state.
