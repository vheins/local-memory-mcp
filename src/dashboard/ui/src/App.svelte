<script lang="ts">
	import { onMount } from "svelte";
	import { get } from "svelte/store";
	import "./app.css";
	import { activeTab, currentRepo, initPersistedState } from "./lib/stores";
	import { createAppHandler } from "./lib/composables/useApp";
	import { api } from "./lib/api";
	import { getNavItem } from "./lib/navigation";

	import RepoSidebar from "./components/RepoSidebar.svelte";
	import TopBar from "./components/TopBar.svelte";
	import KanbanBoard from "./components/KanbanBoard.svelte";
	import MemoryList from "./components/MemoryList.svelte";
	import DetailDrawer from "./components/DetailDrawer.svelte";
	import ReferenceDrawer from "./components/ReferenceDrawer.svelte";
	import MemoryDrawer from "./components/MemoryDrawer.svelte";
	import BulkImportModal from "./components/BulkImportModal.svelte";
	import AddTaskModal from "./components/AddTaskModal.svelte";
	import FloatingChat from "./components/FloatingChat.svelte";

	import OverviewView from "./views/OverviewView.svelte";
	import ActivityView from "./views/ActivityView.svelte";
	import MemoriesView from "./views/MemoriesView.svelte";
	import TasksView from "./views/TasksView.svelte";
	import ViewLoader from "./views/ViewLoader.svelte";
	import WorkspaceGate from "./views/WorkspaceGate.svelte";

	/**
	 * App — application shell only: sidebar, top bar, route outlet, overlays.
	 *
	 * This file used to be a 520-line god component that also owned the layout
	 * and markup of the Overview and Activity pages, nine blocks of inline
	 * `style="..."` (including a `calc(100vh - 180px)` magic number and a
	 * hardcoded gradient avatar), the chat-to-task submit handler, and a
	 * per-route bespoke loading/error banner.
	 *
	 * All page composition now lives in `views/`. The shell's only jobs are:
	 * mount lifecycle, which view is active, and the overlay layer. If page
	 * markup starts creeping back in here, it belongs in a view.
	 */

	let kanbanBoard: KanbanBoard;
	let memoryList: MemoryList;

	const app = createAppHandler({
		get kanbanBoard() {
			return kanbanBoard;
		},
		get memoryList() {
			return memoryList;
		}
	});

	const appState = { subscribe: app.subscribe, set: app.set, update: app.update };
	const { filteredTools, filteredPrompts, filteredResources, sidebarCollapsed } = app;

	function handleTabSelect(tab: string) {
		app.onTabChange(tab);
		if (get(appState).mobileMenuOpen) app.toggleMobileMenu();
	}

	// `dashboard`, `arena` and `queue` are server-wide by design (MEM-1457), so
	// they render without a workspace. Everything else is workspace-scoped.
	const GLOBAL_VIEWS = new Set(["dashboard", "arena", "queue"]);
	$: requiresWorkspace = !GLOBAL_VIEWS.has($activeTab) && !$currentRepo;
	$: activeLabel = getNavItem($activeTab)?.label ?? "view";

	onMount(() => {
		void (async () => {
			initPersistedState();
			await app.loadRepos();
			await app.loadHealth();
			await app.loadData();
		})();
	});

	$: if ($activeTab === "reference") {
		const s = get(app);
		if (!s.capabilities) {
			api
				.capabilities()
				.then((cap) => app.update((curr) => ({ ...curr, capabilities: cap })))
				.catch((err) => console.error("Failed to load capabilities:", err));
		}
	}
</script>

<svelte:window on:keydown={app.onKeyDown} />

<div class="app-layout">
	<RepoSidebar onRepoSelect={app.onRepoSelect} onTabSelect={handleTabSelect} />

	<div class="main-content" class:sidebar-collapsed={$sidebarCollapsed}>
		<TopBar
			onRefresh={app.onRefresh}
			onToggleMobileMenu={app.toggleMobileMenu}
			onEcosystem={app.onEcosystemClick}
			mobileMenuOpen={$appState.mobileMenuOpen}
		/>

		{#if $appState.mobileMenuOpen}
			<div
				class="drawer-overlay mobile-overlay"
				on:click={() => app.toggleMobileMenu()}
				on:keydown={(e) => e.key === "Escape" && app.toggleMobileMenu()}
				role="button"
				tabindex="0"
				aria-label="Close menu"
			></div>
			<div class="mobile-sidebar-shell">
				<RepoSidebar onRepoSelect={app.onRepoSelect} onTabSelect={handleTabSelect} />
			</div>
		{/if}

		<main id="dashboardShell" class="dashboard-shell">
			{#if requiresWorkspace}
				<WorkspaceGate onOpenReference={() => handleTabSelect("reference")} />
			{:else if $activeTab === "dashboard"}
				<OverviewView />
			{:else if $activeTab === "activity"}
				<ActivityView onLoadPage={app.loadRecentActions} onRefresh={app.onRefresh} />
			{:else if $activeTab === "memories"}
				<MemoriesView
					bind:list={memoryList}
					onMemoryClick={app.openMemoryDrawer}
					onNewMemory={app.openNewMemoryDrawer}
					onBulkImport={() => app.openBulkImport("memories")}
				/>
			{:else if $activeTab === "tasks"}
				<TasksView
					bind:board={kanbanBoard}
					onTaskClick={app.openTaskDrawer}
					onAddTask={() => app.toggleAddTaskModal(true)}
					onBulkImport={() => app.openBulkImport("tasks")}
				/>
			{:else if $activeTab === "standards"}
				{#await import("./components/StandardsPanel.svelte")}
					<ViewLoader label={activeLabel} />
				{:then { default: View }}
					<View repo={$currentRepo || ""} />
				{:catch}
					<ViewLoader state="error" label={activeLabel} />
				{/await}
			{:else if $activeTab === "codebase"}
				{#await import("./components/CodebasePage.svelte")}
					<ViewLoader label={activeLabel} />
				{:then { default: View }}
					<View repo={$currentRepo || ""} />
				{:catch}
					<ViewLoader state="error" label={activeLabel} />
				{/await}
			{:else if $activeTab === "handoffs"}
				{#await import("./components/HandoffsPanel.svelte")}
					<ViewLoader label={activeLabel} />
				{:then { default: View }}
					<View repo={$currentRepo || ""} />
				{:catch}
					<ViewLoader state="error" label={activeLabel} />
				{/await}
			{:else if $activeTab === "queue"}
				{#await import("./components/QueuePage.svelte")}
					<ViewLoader label={activeLabel} />
				{:then { default: View }}
					<View repo={$currentRepo || ""} />
				{:catch}
					<ViewLoader state="error" label={activeLabel} />
				{/await}
			{:else if $activeTab === "knowledge-graph"}
				{#await import("./components/KGGraph.svelte")}
					<ViewLoader label={activeLabel} />
				{:then { default: View }}
					<View repo={$currentRepo || ""} />
				{:catch}
					<ViewLoader state="error" label={activeLabel} />
				{/await}
			{:else if $activeTab === "arena"}
				<div class="arena-fullwidth">
					{#await import("./components/AgentArena.svelte")}
						<ViewLoader label={activeLabel} />
					{:then { default: View }}
						<View />
					{:catch}
						<ViewLoader state="error" label={activeLabel} />
					{/await}
				</div>
			{:else if $activeTab === "reference"}
				{#await import("./components/ReferenceTab.svelte")}
					<ViewLoader label={activeLabel} />
				{:then { default: View }}
					<View handler={app} {appState} {filteredTools} {filteredPrompts} {filteredResources} />
				{:catch}
					<ViewLoader state="error" label={activeLabel} />
				{/await}
			{/if}
		</main>
	</div>
</div>

<DetailDrawer
	drawerMode={$appState.selectedMemory ? "memory" : "task"}
	memory={$appState.selectedMemory}
	task={$appState.selectedTask}
	open={$appState.drawerOpen}
	onClose={app.closeDrawer}
	onTaskUpdated={app.handleTaskUpdated}
	onTaskDeleted={() => {
		if ($currentRepo) kanbanBoard?.loadTasks($currentRepo);
	}}
/>

<ReferenceDrawer
	item={$appState.selectedReference}
	open={$appState.referenceDrawerOpen}
	onClose={() => app.toggleReferenceDrawer(false)}
/>

<MemoryDrawer
	memory={$appState.memoryDrawerItem}
	open={$appState.memoryDrawerOpen}
	onClose={() => app.toggleMemoryDrawer(false)}
	onSaved={app.handleMemorySaved}
	onDeleted={app.handleMemoryDeleted}
/>

<AddTaskModal
	open={$appState.addTaskModalOpen}
	newTask={$appState.newTask}
	onClose={() => app.toggleAddTaskModal(false)}
	onSave={app.createTask}
/>

<BulkImportModal
	repo={$currentRepo || ""}
	importTarget={$appState.bulkImportTarget}
	isOpen={$appState.bulkImportOpen}
	on:close={() => app.toggleBulkImport(false)}
	on:success={() => {
		if ($appState.bulkImportTarget === "memories") memoryList?.refresh();
		if ($appState.bulkImportTarget === "tasks" && $currentRepo) kanbanBoard?.loadTasks($currentRepo);
	}}
/>

<FloatingChat onRefresh={app.onRefresh} />

<style>
	/* Content is capped so text lines stay readable on ultrawide displays
	   instead of stretching to 2500px. */
	.dashboard-shell {
		max-width: var(--content-max);
		width: 100%;
		margin: 0 auto;
	}

	/* Arena renders its own canvas and manages its own bounds, so it opts out of
	   the shell's horizontal padding.

	   Two rules make this safe. It cancels the shell's padding by referencing
	   the SAME `--shell-pad` custom property rather than restating a value — the
	   previous code hardcoded `--space-5` (24px) against a `20px` padding, a 4px
	   mismatch per side that produced a permanent horizontal scrollbar. And it
	   uses negative margins ONLY, never `width: calc(100% + ...)`, which would
	   override the centred shell's computed width and overflow again. */
	.arena-fullwidth {
		margin-left: calc(var(--shell-pad) * -1);
		margin-right: calc(var(--shell-pad) * -1);
		overflow-y: auto;
	}
</style>
