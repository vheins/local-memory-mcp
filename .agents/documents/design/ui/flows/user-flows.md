# User Flow Descriptions

This document maps the primary user journeys within the Local Memory Dashboard.

## Flow 1: Contextual Information Audit
1. **Entry Point:** User opens the dashboard.
2. **Action:** User selects a repository from the sidebar.
3. **Observation:** Dashboard widgets update to show the memory count, task status, and recent hits/misses for that specific repo.
4. **Transition:** User clicks the **Activity** tab to see the latest agent queries and ensure the memory is being retrieved as expected.

## Flow 2: Knowledge Seeding (Bulk Import)
1. **Entry Point:** User navigates to the **Memories** tab.
2. **Action:** User clicks the "Bulk Import" button (Icon: upload).
3. **Modal:** A specialized modal appears requesting a JSON or Markdown file.
4. **Validation:** System checks file format and provides immediate feedback.
5. **Execution:** User clicks "Import".
6. **Result:** The memory list refreshes dynamically without a full page reload, showing the newly seeded knowledge items.

## Flow 3: Inspecting Agent Capabilities
1. **Entry Point:** User needs to know what tools the agent has available for the current context.
2. **Action:** User clicks the **Reference** tab.
3. **Filter:** User types "task" into the Filter bar.
4. **Inspection:** User clicks on `task-list`.
5. **Detail:** A drawer opens showing the **JSON Schema** for parameters, the expected output format, and the tool's intended use case (description).

## Flow 4: Task Recovery & Promotion
1. **Entry Point:** User identifies a "Stalled" task in the Kanban board.
2. **Action:** User clicks the task card.
3. **Audit:** User reads the `Action Log` within the task detail to see which agent last interacted with it.
4. **Correction**: User updates the task status to **In Progress** to resume the work, or **Completed** to finalize it. 
5. **Promotion**: For best results, user follows the **Gradual Promotion** model (Transitions should pass through `in_progress`).
6. **Refresh**: The Kanban board updates real-time.