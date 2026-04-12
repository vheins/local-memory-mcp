<script lang="ts">
	import { onMount } from "svelte";
	import { get } from "svelte/store";
	import "./app.css";
	import { activeTab, currentRepo, recentActionsTotalItems, initPersistedState } from "./lib/stores";
	import { createAppHandler } from "./lib/composables/useApp";
	import { api } from "./lib/api";

	import RepoSidebar from "./components/RepoSidebar.svelte";
	import TopBar from "./components/TopBar.svelte";
	import KanbanBoard from "./components/KanbanBoard.svelte";
	import StatsWidget from "./components/StatsWidget.svelte";
	import TaskStatsWidget from "./components/TaskStatsWidget.svelte";
	import TimeStatsWidget from "./components/TimeStatsWidget.svelte";
	import MemoryList from "./components/MemoryList.svelte";
	import RecentActions from "./components/RecentActions.svelte";
	import DetailDrawer from "./components/DetailDrawer.svelte";
	import ReferenceDrawer from "./components/ReferenceDrawer.svelte";
	import MemoryDrawer from "./components/MemoryDrawer.svelte";
	import BulkImportModal from "./components/BulkImportModal.svelte";
	import AddTaskModal from "./components/AddTaskModal.svelte";
	import ReferenceTab from "./components/ReferenceTab.svelte";
	import Icon from "./lib/Icon.svelte";

	let kanbanBoard: KanbanBoard;
	let memoryList: MemoryList;

	// Init app handler, passing component refs
	const app = createAppHandler({
		get kanbanBoard() {
			return kanbanBoard;
		},
		get memoryList() {
			return memoryList;
		}
	});

	const appState = { subscribe: app.subscribe, set: app.set, update: app.update };
	const { filteredTools, filteredPrompts, filteredResources, sidebarCollapsed, TABS } = app;

	onMount(async () => {
		initPersistedState();
		await app.loadRepos();
		await app.loadHealth();
		await app.loadData();
		const tab = $activeTab;
		if (tab === "reference") {
			if (!get(app).capabilities) {
				try {
					const cap = await api.capabilities();
					app.update((curr) => ({ ...curr, capabilities: cap }));
				} catch (err) {
					console.error("Failed to load capabilities:", err);
				}
			}
		}
	});
</script>

<svelte:window on:keydown={app.onKeyDown} />

<div class="app-layout">
	<!-- Sidebar -->
	<RepoSidebar onRepoSelect={app.onRepoSelect} />

	<!-- Main content -->
	<div class="main-content" class:sidebar-collapsed={$sidebarCollapsed}>
		<!-- Top bar -->
		<TopBar onRefresh={app.onRefresh} onToggleMobileMenu={app.toggleMobileMenu} />

		<!-- Mobile overlay -->
		{#if $appState.mobileMenuOpen}
			<div
				class="drawer-overlay"
				style="z-index:38;"
				on:click={() => app.toggleMobileMenu()}
				on:keydown={(e) => e.key === "Escape" && app.toggleMobileMenu()}
				role="button"
				tabindex="0"
				aria-label="Close menu"
			></div>
			<div style="position:fixed;top:0;left:0;width:280px;height:100dvh;z-index:39;display:flex;flex-direction:column;">
				<RepoSidebar onRepoSelect={app.onRepoSelect} />
			</div>
		{/if}

		<!-- Content Shell -->
		<div id="dashboardShell" style="padding: 20px; min-height: 100vh;">
			{#if !$currentRepo}
				<div style="text-align:center;padding:80px 20px;" class="animate-fade-in">
					<div
						style="display:inline-flex;width:72px;height:72px;border-radius:20px;background:linear-gradient(135deg,rgba(14,165,233,0.15),rgba(99,102,241,0.15));border:1px solid rgba(14,165,233,0.2);align-items:center;justify-content:center;margin-bottom:20px;"
						class="animate-float"
					>
						<Icon name="brain" size={32} strokeWidth={1.5} className="" />
					</div>
					<div
						style="font-size:1.25rem;font-weight:800;color:var(--color-text);margin-bottom:8px;letter-spacing:-0.02em;"
					>
						No Repository Selected
					</div>
					<div style="color:var(--color-text-muted);font-size:0.875rem;">
						Select a repository from the sidebar to get started.
					</div>
				</div>
			{:else}
				<!-- Tab nav -->
				<div style="margin-bottom:20px;">
					<div class="tab-nav" style="display:inline-flex;">
						{#each TABS as tab}
							<button
								class="tab-btn"
								class:active={$activeTab === tab.id}
								on:click={() => app.onTabChange(tab.id)}
								id="tab-{tab.id}"
							>
								<Icon name={tab.icon} size={14} strokeWidth={1.75} />
								<span>{tab.label}</span>
							</button>
						{/each}
					</div>
				</div>

				<!-- ════ DASHBOARD TAB ════ -->
				{#if $activeTab === "dashboard"}
					<div style="display:grid;grid-template-columns:1fr;gap:12px;align-items:start;" class="dashboard-grid">
						<div style="display:flex;flex-direction:column;gap:12px;">
							<div class="glass card hover-glow" style="padding:16px;">
								<div class="section-label" style="margin-bottom:10px;">Memory Overview</div>
								<StatsWidget />
							</div>
							<div class="glass card hover-glow" style="padding:16px;">
								<div class="section-label" style="margin-bottom:10px;">Task Overview</div>
								<TaskStatsWidget />
							</div>
							<TimeStatsWidget />
						</div>
					</div>
				{/if}

				<!-- ════ ACTIVITY TAB ════ -->
				{#if $activeTab === "activity"}
					<div
						class="glass card animate-fade-in"
						style="height:calc(100vh - 180px);display:flex;flex-direction:column;padding:0;overflow:hidden;border-radius:24px;"
					>
						<div
							style="padding:16px 20px;border-bottom:1px solid var(--color-border);display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,0.05);"
						>
							<div class="flex items-center gap-3">
								<div
									style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,var(--color-primary),var(--color-accent));display:flex;align-items:center;justify-content:center;color:white;box-shadow:0 4px 12px var(--glow-primary);"
								>
									<Icon name="activity" size={18} strokeWidth={2.2} />
								</div>
								<div>
									<div style="font-size:0.95rem;font-weight:800;color:var(--color-text);letter-spacing:-0.01em;">
										Recent Activity
									</div>
									<div style="font-size:0.68rem;color:var(--color-text-muted);font-weight:600;">
										{$recentActionsTotalItems} events tracked
									</div>
								</div>
							</div>
						</div>
						<div style="flex:1;overflow-y:auto;padding:24px 32px;background:rgba(0,0,0,0.02);">
							<RecentActions onLoadPage={app.loadRecentActions} />
						</div>
					</div>
				{/if}

				<!-- ════ MEMORIES TAB ════ -->
				{#if $activeTab === "memories"}
					<div class="glass card hover-glow animate-fade-in">
						<div class="flex items-center gap-2" style="margin-bottom:16px;">
							<Icon name="brain" size={14} strokeWidth={1.75} />
							<div class="section-label">Memory Explorer</div>
						</div>
						<MemoryList
							bind:this={memoryList}
							onMemoryClick={app.openMemoryDrawer}
							onNewMemory={app.openNewMemoryDrawer}
							onBulkImport={() => app.openBulkImport("memories")}
						/>
					</div>
				{/if}

				<!-- ════ TASKS TAB ════ -->
				{#if $activeTab === "tasks"}
					<div class="animate-fade-in">
						<div class="glass card hover-glow" style="margin-bottom:20px;">
							<div class="flex items-center gap-2" style="margin-bottom:16px;">
								<Icon name="columns" size={14} strokeWidth={1.75} />
								<div class="stat-label">Task Overview</div>
							</div>
							<KanbanBoard
								bind:this={kanbanBoard}
								onTaskClick={app.openTaskDrawer}
								onAddTask={() => app.toggleAddTaskModal(true)}
								onBulkImport={() => app.openBulkImport("tasks")}
							/>
						</div>
					</div>
				{/if}

				<!-- ════ REFERENCE TAB ════ -->
				{#if $activeTab === "reference"}
					<ReferenceTab handler={app} {appState} {filteredTools} {filteredPrompts} {filteredResources} />
				{/if}
			{/if}
		</div>
	</div>
</div>

<!-- ════ Unified Detail Drawer (Memory + Task) ════ -->
<DetailDrawer
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

<!-- ════ Add Task Modal ════ -->
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

<style>
	@media (max-width: 900px) {
		.dashboard-grid {
			grid-template-columns: 1fr !important;
		}
	}
</style>
