# Test Scenarios: Dashboard

Integration and UI verification for the user interface.

## 1. Multi-Tab Navigation
- **Dashboard Tab:** Verify stats widgets (Memories, Tasks, Hits/Misses) populate correctly upon repo selection.
- **Activity Tab:** Verify "Live" stream of interactions. Check if latest tool calls appear at the top.
- **Memories Tab:** Verify infinite scroll load. Check if "Bulk Import" modal opens and validates JSON.
- **Tasks Tab:** Verify Kanban swimlanes. Drag a card from `pending` to `in_progress`. Check if card status updates visually.
- **Reference Tab:** Filter by "memory". Verify that clicking a tool displays its JSON schema correctly.

## 2. Global State Persistence
- **Theme:** Toggle to Dark Mode. Refresh page. Verify interface remains in Dark Mode.
- **Repo Sticky:** Select "repo-a". Refresh page. Verify "repo-a" remains selected and data is re-fetched.

## 3. Error Handling & Transitions
- **Constraint Error:** Attempt to drag card from `backlog` to `completed`. Verify that card "snaps back" and a Toast notification explains the transition rule violation.
- **Network Lost:** Disconnect backend. Verify persistent red error banner appears.
- **Empty State:** Switch to a brand-new repo. Verify that the Dashboard displays "No memories yet - start by storing context" illustration.

## 4. Performance
- **Switching Speed:** Rapidly click different repositories. Verify that active requests are aborted and only the latest data is rendered (no race conditions).
- **Large List:** Render 500+ memories. Verify smooth scrolling and search filter responsiveness.
