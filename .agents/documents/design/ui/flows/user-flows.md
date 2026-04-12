# User Flow Descriptions

## Flow 1: Inspecting the Current Active Task
1. **Entry Point:** User opens the local dashboard URL in the browser (`localhost:3000`).
2. **Node 1 (Repo Sidebar):** User selects the desired project repository from the sidebar.
3. **Node 2 (Kanban Board / Task View):** The dashboard loads tasks for the selected repository.
4. **Decision:** Is there an active task?
   - **Yes:** The active task is highlighted at the top/center of the screen.
   - **No:** The system displays a "No Active Task" empty state.
5. **Node 3 (Task Detail):** User clicks on a task card. A detail drawer slides out to show task description, status, and related memories.
6. **Exit Point:** User closes the drawer or navigates to the Memory list.

## Flow 2: Auditing Contextual Memories
1. **Entry Point:** User clicks the "Memories" tab in the main navigation.
2. **Node 1 (Memory List):** System displays a paginated list of all stored memories for the active repository.
3. **Decision:** User searches for a specific concept.
   - **Action:** User types into the search bar.
   - **Result:** The list filters dynamically (or triggers a backend hybrid search if enter is pressed).
4. **Node 2 (Memory Detail):** User clicks on a memory card. A detail drawer slides out showing full markdown content, embedding status, and usage telemetry.
5. **Node 3 (Delete Action):** User identifies obsolete memory and clicks "Delete".
6. **Confirmation:** System prompts for confirmation. Upon confirming, the memory is deleted and the list is refreshed.
7. **Exit Point:** Memory is removed, user returns to the list view.