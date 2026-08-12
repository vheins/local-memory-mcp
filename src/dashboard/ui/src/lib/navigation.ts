/**
 * Navigation model — single source of truth for the dashboard's view
 * navigation (TASK-425 / TASK-405).
 *
 * The unified nav model (previously rendered as the content-area horizontal
 * tablist in App.svelte) now lives here and is rendered as the primary
 * navigation surface in the left sidebar (RepoSidebar). Every view — Arena,
 * Dashboard, Activity, Memories, Tasks, Codebase, Handoffs, Queue, Knowledge
 * Graph, Standards, Reference — is reachable from exactly ONE surface; no
 * dual navigation for the same view.
 *
 * `id` maps 1:1 to the `activeTab` store value that gates the view in
 * App.svelte's content shell.
 */
export interface NavItem {
	id: string;
	label: string;
	icon: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
	{ id: "arena", label: "Arena", icon: "cpu" },
	{ id: "dashboard", label: "Dashboard", icon: "layout-dashboard" },
	{ id: "activity", label: "Activity", icon: "activity" },
	{ id: "memories", label: "Memories", icon: "brain" },
	{ id: "tasks", label: "Tasks", icon: "clipboard-list" },
	{ id: "codebase", label: "Codebase", icon: "code" },
	{ id: "handoffs", label: "Handoffs", icon: "git-branch" },
	{ id: "queue", label: "Queue", icon: "list" },
	{ id: "knowledge-graph", label: "Knowledge Graph", icon: "share-2" },
	{ id: "standards", label: "Standards", icon: "check" },
	{ id: "reference", label: "Reference", icon: "book-open" }
];
