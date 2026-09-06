<script lang="ts">
	import { onMount } from "svelte";
	import { get } from "svelte/store";
	import "./app.css";
	import {
		activeTab,
		currentRepo,
		recentActionsTotalItems,
		initPersistedState,
		dashboardStats,
		taskTimeStats
	} from "./lib/stores";
	import { createAppHandler } from "./lib/composables/useApp";
	import { api } from "./lib/api";
	import { createChatTask } from "./lib/utils";

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
	import FloatingChat from "./components/FloatingChat.svelte";
	import GlobalCommandCenter from "./components/GlobalCommandCenter.svelte";
	import Icon from "./lib/Icon.svelte";

	let kanbanBoard: KanbanBoard;
	let memoryList: MemoryList;

	let chatMessage = "";
	let isSendingChat = false;

	async function sendChat() {
		const msg = chatMessage.trim();
		if (!msg || isSendingChat) return;
		const repo = get(currentRepo);
		if (!repo) return;
		isSendingChat = true;
		try {
			await createChatTask(msg, repo);
			chatMessage = "";
			await app.onRefresh();
		} catch (e) {
			console.error("Failed to create task from chat:", e);
		} finally {
			isSendingChat = false;
		}
	}

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
	const { filteredTools, filteredPrompts, filteredResources, sidebarCollapsed } = app;

	// ARIA live region (STD-002 / TASK-400): scoped sr-only announcement for
	// the dashboard view's async stats refresh. Subscribes announce on every
	// stats load (initial + 30s polling), never wrap the whole shell.
	let dashboardLiveText = "";

	// TASK-425: the sidebar nav is the single navigation surface. Route tab
	// switches through app.onTabChange (same handler the old horizontal tablist
	// used) so lazy loads (memories/tasks/reference) keep working, and close
	// the mobile menu when navigating from it.
	function handleTabSelect(tab: string) {
		app.onTabChange(tab);
		if (get(appState).mobileMenuOpen) app.toggleMobileMenu();
	}

	onMount(() => {
		const unsubStats = dashboardStats.subscribe((s) => {
			if (s) dashboardLiveText = "Dashboard stats refreshed";
		});
		const unsubTimeStats = taskTimeStats.subscribe((ts) => {
			if (ts) dashboardLiveText = "Dashboard stats refreshed";
		});
		void (async () => {
			initPersistedState();
			await app.loadRepos();
			await app.loadHealth();
			await app.loadData();
		})();
		return () => {
			unsubStats();
			unsubTimeStats();
		};
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
	<!-- Sidebar -->
	<RepoSidebar onRepoSelect={app.onRepoSelect} onTabSelect={handleTabSelect} />

	<!-- Main content -->
	<div class="main-content" class:sidebar-collapsed={$sidebarCollapsed}>
		<!-- Top bar -->
		<TopBar
			onRefresh={app.onRefresh}
			onToggleMobileMenu={app.toggleMobileMenu}
			onEcosystem={app.onEcosystemClick}
			mobileMenuOpen={$appState.mobileMenuOpen}
		/>

		<!-- Mobile overlay -->
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

		<!-- Content Shell -->
		<main id="dashboardShell" class="dashboard-shell">
			<!-- TASK-418: `queue` is global-scope by design (server-wide embedding/KG
			     outbox — MEM-1457), so it must stay reachable without a repo like
			     dashboard/arena. All other tabs are per-repo and stay gated. -->
			{#if !$currentRepo && $activeTab !== "dashboard" && $activeTab !== "arena" && $activeTab !== "queue"}
				<div class="empty-state animate-fade-in">
					<div class="empty-state-icon animate-float">
						<Icon name="brain" size={32} strokeWidth={1.5} />
					</div>
					<div class="empty-state-title">No Repository Selected</div>
					<div class="empty-state-text">Select a repository from the sidebar to get started.</div>
				</div>
			{:else}
				<!-- TASK-425: no horizontal tablist in the content area — all
				     navigation (Arena/Dashboard/Activity/Memories/Tasks/Codebase/
				     Handoffs/Queue/Knowledge Graph/Standards/Reference) lives in
				     the RepoSidebar nav (lib/navigation.ts, single source). The
				     active view below is gated by the same activeTab store. -->

				<!-- ════ DASHBOARD TAB ════ -->
				{#if $activeTab === "dashboard"}
					<!-- ARIA live region (STD-002 / TASK-400): scoped, never the whole shell -->
					<div class="sr-only" aria-live="polite" aria-atomic="true">{dashboardLiveText}</div>
					<div style="display:grid;grid-template-columns:1fr;gap:12px;align-items:start;" class="dashboard-grid">
						<GlobalCommandCenter />

						<div class="flex flex-col" style="gap:12px;">
							{#if $currentRepo}
								<div class="glass card hover-glow card-body">
									<div class="flex items-center justify-between card-section-title">
										<h2 class="section-label">Selected Repo Pulse</h2>
										<div class="repo-badge">
											{$currentRepo}
										</div>
									</div>
									<div
										class="repo-pulse-grid"
										style="display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:12px;"
									>
										<div class="glass card card-body">
											<h2 class="section-label card-section-title">Memory Overview</h2>
											<StatsWidget />
										</div>
										<div class="glass card card-body">
											<h2 class="section-label card-section-title">Task Overview</h2>
											<TaskStatsWidget />
										</div>
									</div>
								</div>
								<TimeStatsWidget />
							{:else}
								<div class="glass card hover-glow card-body">
									<h2 class="section-label card-section-title">Per-Repository Pulse</h2>
									<div class="muted-text">
										Select a repository from the sidebar to inspect repo-specific memory, task, and execution metrics.
									</div>
								</div>
							{/if}
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
									<h1 style="font-size:0.95rem;font-weight:800;color:var(--color-text);letter-spacing:-0.01em;">
										Recent Activity
									</h1>
									<div style="font-size:0.68rem;color:var(--color-text-muted);font-weight:600;">
										{$recentActionsTotalItems} events tracked
									</div>
								</div>
							</div>
						</div>
						<RecentActions onLoadPage={app.loadRecentActions} />
						<div class="chat-send-panel">
							<div class="chat-input-row">
								<input
									type="text"
									placeholder="Type a message to create a backlog task..."
									value={chatMessage}
									on:input={(e) => (chatMessage = e.currentTarget.value)}
									on:keydown={(e) => e.key === "Enter" && !e.shiftKey && sendChat()}
									disabled={isSendingChat}
								/>
								<button class="chat-send-btn" on:click={sendChat} disabled={!chatMessage.trim() || isSendingChat}>
									<Icon name="send" size={16} strokeWidth={2} />
								</button>
							</div>
						</div>
					</div>
				{/if}

				<!-- ════ MEMORIES TAB ════ -->
				{#if $activeTab === "memories"}
					<div class="glass card hover-glow animate-fade-in">
						<div class="flex items-center gap-2" style="margin-bottom:16px;">
							<Icon name="brain" size={14} strokeWidth={1.75} />
							<h1 class="section-label">Memory Explorer</h1>
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
								<h1 class="stat-label">Task Overview</h1>
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

				<!-- ════ STANDARDS TAB ════ -->
				{#if $activeTab === "standards"}
					{#await import("./components/StandardsPanel.svelte")}
						<div class="view-loading">Loading standards…</div>
					{:then { default: View }}
						<View repo={$currentRepo || ""} />
					{:catch error}
						<div class="error-banner" role="alert">{error.message}</div>
					{/await}
				{/if}

				<!-- ════ CODEBASE TAB ════ -->
				{#if $activeTab === "codebase"}
					{#await import("./components/CodebasePage.svelte")}
						<div class="view-loading">Loading codebase…</div>
					{:then { default: View }}
						<View repo={$currentRepo || ""} />
					{:catch error}
						<div class="error-banner" role="alert">{error.message}</div>
					{/await}
				{/if}

				<!-- ════ HANDOFFS TAB ════ -->
				{#if $activeTab === "handoffs"}
					{#await import("./components/HandoffsPanel.svelte")}
						<div class="view-loading">Loading coordination…</div>
					{:then { default: View }}
						<View repo={$currentRepo || ""} />
					{:catch error}
						<div class="error-banner" role="alert">{error.message}</div>
					{/await}
				{/if}

				<!-- ════ QUEUE TAB ════ -->
				{#if $activeTab === "queue"}
					{#await import("./components/QueuePage.svelte")}
						<div class="view-loading">Loading queue…</div>
					{:then { default: View }}
						<View repo={$currentRepo || ""} />
					{:catch error}
						<div class="error-banner" role="alert">{error.message}</div>
					{/await}
				{/if}

				<!-- ════ KNOWLEDGE GRAPH TAB ════ -->
				{#if $activeTab === "knowledge-graph"}
					{#await import("./components/KGGraph.svelte")}
						<div class="view-loading">Loading knowledge graph…</div>
					{:then { default: View }}
						<View repo={$currentRepo || ""} />
					{:catch error}
						<div class="error-banner" role="alert">{error.message}</div>
					{/await}
				{/if}

				<!-- ════ AGENT ARENA TAB ════ -->
				{#if $activeTab === "arena"}
					<div class="arena-fullwidth">
						{#await import("./components/AgentArena.svelte")}
							<div class="view-loading">Loading agent arena…</div>
						{:then { default: View }}
							<View />
						{:catch error}
							<div class="error-banner" role="alert">{error.message}</div>
						{/await}
					</div>
				{/if}

				<!-- ════ REFERENCE TAB ════ -->
				{#if $activeTab === "reference"}
					{#await import("./components/ReferenceTab.svelte")}
						<div class="view-loading">Loading reference…</div>
					{:then { default: View }}
						<View handler={app} {appState} {filteredTools} {filteredPrompts} {filteredResources} />
					{:catch error}
						<div class="error-banner" role="alert">{error.message}</div>
					{/await}
				{/if}
			{/if}
		</main>
	</div>
</div>

<!-- ════ Unified Detail Drawer (Memory + Task) ════ -->
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

<!-- ════ Quick Create FAB ════ -->
<FloatingChat onRefresh={app.onRefresh} />

<style>
	/* ── Card body padding utility ── */
	:global(.card-body) {
		padding: 16px;
	}

	/* ── Section title spacing inside cards ── */
	:global(.card-section-title) {
		margin-bottom: 10px;
	}

	.view-loading {
		display: grid;
		place-items: center;
		min-height: 280px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		color: var(--color-text-muted);
		font-size: 0.85rem;
	}
	.error-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-top: 16px;
		padding: 12px 16px;
		border: 1px solid rgba(239, 68, 68, 0.25);
		border-radius: var(--radius-md);
		background: rgba(239, 68, 68, 0.08);
		color: var(--color-danger);
	}

	/* ── Empty state layout ── */
	.empty-state {
		text-align: center;
		padding: 80px 20px;
	}

	.empty-state-icon {
		display: inline-flex;
		width: 72px;
		height: 72px;
		border-radius: 20px;
		background: linear-gradient(135deg, rgba(14, 165, 233, 0.15), rgba(99, 102, 241, 0.15));
		border: 1px solid rgba(14, 165, 233, 0.2);
		align-items: center;
		justify-content: center;
		margin-bottom: 20px;
	}

	.empty-state-title {
		font-size: 1.25rem;
		font-weight: 800;
		color: var(--color-text);
		margin-bottom: 8px;
		letter-spacing: -0.02em;
	}

	.empty-state-text {
		color: var(--color-text-muted);
		font-size: 0.875rem;
	}

	.repo-badge {
		font-size: 0.68rem;
		font-weight: 800;
		color: var(--color-primary);
		background: rgba(99, 102, 241, 0.08);
		border: 1px solid rgba(99, 102, 241, 0.16);
		padding: 4px 8px;
		border-radius: 999px;
	}

	.muted-text {
		color: var(--color-text-muted);
		font-size: 0.8rem;
	}

	@media (max-width: 900px) {
		.dashboard-grid {
			grid-template-columns: 1fr !important;
		}
		.repo-pulse-grid {
			grid-template-columns: 1fr !important;
		}
	}

	/* Arena full-width: break out of dashboard-shell padding */
	.arena-fullwidth {
		margin-left: -20px;
		margin-right: -20px;
		width: calc(100% + 40px);
		overflow-y: auto;
	}

	@media (max-width: 1024px) {
		.arena-fullwidth {
			margin-left: -12px;
			margin-right: -12px;
			width: calc(100% + 24px);
		}
	}
</style>
