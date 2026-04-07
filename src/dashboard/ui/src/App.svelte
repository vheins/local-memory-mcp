<script lang="ts">
  import { onMount } from 'svelte';
  import './app.css';
  import {
    theme, activeTab, currentRepo, availableRepos, dashboardStats,
    taskTimeStats, recentActions, recentActionsPage, recentActionsPageSize,
    recentActionsTotalItems, healthData, isRepoSidebarCollapsed, pinnedRepos,
    initPersistedState
  } from './lib/stores';
  import { api } from './lib/api';
  import type { Memory, Task } from './lib/stores';

  import RepoSidebar from './components/RepoSidebar.svelte';
  import TopBar from './components/TopBar.svelte';
  import StatsWidget from './components/StatsWidget.svelte';
  import TimeStatsWidget from './components/TimeStatsWidget.svelte';
  import KanbanBoard from './components/KanbanBoard.svelte';
  import MemoryList from './components/MemoryList.svelte';
  import RecentActions from './components/RecentActions.svelte';
  import DetailDrawer from './components/DetailDrawer.svelte';

  // Component refs
  let kanbanBoard: KanbanBoard;
  let memoryList: MemoryList;

  // Mobile menu
  let mobileMenuOpen = false;

  // Drawer state — unified via DetailDrawer
  let selectedMemory: Memory | null = null;
  let selectedTask: Task | null = null;
  let drawerOpen = false;

  // Add task modal
  let addTaskModalOpen = false;
  let newTask = { task_code: '', title: '', phase: '', description: '', status: 'pending', priority: 3 };

  // Capabilities
  let capabilities: any = null;

  // ─── Init ──────────────────────────────────────────────────────────────────
  onMount(async () => {
    initPersistedState();
    await loadRepos();
    await loadHealth();
    await loadData();
  });

  async function loadRepos() {
    try {
      const data = await api.repos();
      availableRepos.set(data.repos || []);
      if (data.repos?.length > 0) {
        const saved = localStorage.getItem('selectedRepo');
        const exists = data.repos.find((r: any) => r.repo === saved);
        currentRepo.set(exists ? saved! : data.repos[0].repo);
        localStorage.setItem('selectedRepo', $currentRepo!);
      }
    } catch (e) {
      console.error('Failed to load repos:', e);
    }
  }

  async function loadHealth() {
    try {
      const data = await api.health();
      healthData.set(data);
    } catch {
      healthData.set(null);
    }
  }

  async function loadData() {
    if (!$currentRepo) return;
    await Promise.all([
      loadStats(),
      loadRecentActions(),
    ]);
  }

  async function loadStats() {
    if (!$currentRepo) return;
    try {
      const data = await api.stats($currentRepo);
      dashboardStats.set(data);
    } catch (e) {
      console.error('Failed to load stats:', e);
    }
    // Load task time stats
    try {
      const data = await api.taskTimeStats($currentRepo!);
      taskTimeStats.set(data);
    } catch {}
  }

  async function loadRecentActions(page: number = $recentActionsPage) {
    try {
      const data = await api.recentActions($currentRepo, page, $recentActionsPageSize);
      recentActions.set(data.actions || []);
      recentActionsPage.set(data.pagination?.page ?? page);
      recentActionsTotalItems.set(data.pagination?.totalItems ?? 0);
    } catch (e) {
      console.error('Failed to load recent actions:', e);
    }
  }

  async function onRepoSelect(repo: string) {
    currentRepo.set(repo);
    await loadData();
    memoryList?.refresh();
    kanbanBoard?.loadTasks(repo);
    mobileMenuOpen = false;
  }

  async function onRefresh() {
    await loadHealth();
    await loadData();
    if ($activeTab === 'memories') memoryList?.refresh();
    if ($activeTab === 'tasks' && $currentRepo) kanbanBoard?.loadTasks($currentRepo);
  }

  async function onTabChange(tab: string) {
    activeTab.set(tab);
    if (tab === 'memories') {
      setTimeout(() => memoryList?.refresh(), 50);
    } else if (tab === 'tasks' && $currentRepo) {
      setTimeout(() => kanbanBoard?.loadTasks($currentRepo!), 50);
    } else if (tab === 'reference' && !capabilities) {
      try { capabilities = await api.capabilities(); } catch {}
    }
  }

  function openMemoryDrawer(mem: Memory) {
    selectedMemory = mem;
    selectedTask = null;
    drawerOpen = true;
  }

  function openTaskDrawer(task: Task) {
    selectedTask = task;
    selectedMemory = null;
    drawerOpen = true;
  }

  function closeDrawer() {
    drawerOpen = false;
    setTimeout(() => { selectedMemory = null; selectedTask = null; }, 300);
  }

  function handleTaskUpdated(updated: Task) {
    selectedTask = updated;
    if ($currentRepo) kanbanBoard?.loadTasks($currentRepo);
  }

  async function createTask() {
    if (!$currentRepo || !newTask.task_code || !newTask.title) return;
    try {
      await api.createTask({ ...newTask, repo: $currentRepo });
      addTaskModalOpen = false;
      newTask = { task_code: '', title: '', phase: '', description: '', status: 'pending', priority: 3 };
      if ($currentRepo) kanbanBoard?.loadTasks($currentRepo);
    } catch (e) {
      alert('Failed to create task: ' + (e as any).message);
    }
  }

  const TABS = [
    { id: 'dashboard', label: 'Dashboard', icon: '◈' },
    { id: 'memories', label: 'Memories', icon: '🧠' },
    { id: 'tasks', label: 'Tasks', icon: '📋' },
    { id: 'reference', label: 'Reference', icon: '📚' },
  ];

  // Keyboard shortcuts
  function onKeyDown(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'Escape') closeDrawer();
    if (e.key === 'r' || e.key === 'R') onRefresh();
  }

  $: sidebarCollapsed = $isRepoSidebarCollapsed;

  import { formatDate, getStatusColor, getStatusLabel, getPriorityLabel, renderMarkdown } from './lib/utils';
</script>

<svelte:window on:keydown={onKeyDown} />

<div class="app-layout">
  <!-- Sidebar -->
  <RepoSidebar onRepoSelect={onRepoSelect} />

  <!-- Main content -->
  <div class="main-content" class:sidebar-collapsed={sidebarCollapsed}>
    <!-- Top bar -->
    <TopBar onRefresh={onRefresh} onToggleMobileMenu={() => mobileMenuOpen = !mobileMenuOpen} />

    <!-- Mobile overlay -->
    {#if mobileMenuOpen}
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <div class="drawer-overlay" style="z-index:38;" on:click={() => mobileMenuOpen = false}></div>
      <div style="position:fixed;top:0;left:0;width:280px;height:100dvh;z-index:39;display:flex;flex-direction:column;">
        <RepoSidebar onRepoSelect={onRepoSelect} />
      </div>
    {/if}

    <!-- Content Shell -->
    <div id="dashboardShell" style="padding: 20px; min-height: 100vh;">

      {#if !$currentRepo}
        <div style="text-align:center;padding:80px 20px;">
          <div style="font-size:3rem;margin-bottom:16px;">🧠</div>
          <div style="font-size:1.25rem;font-weight:700;color:var(--color-text);margin-bottom:8px;">No Repository Selected</div>
          <div style="color:var(--color-text-muted);">Select a repository from the sidebar to get started.</div>
        </div>
      {:else}
        <!-- Tab nav -->
        <div style="margin-bottom:20px;">
          <div class="tab-nav" style="display:inline-flex;">
            {#each TABS as tab}
              <button
                class="tab-btn"
                class:active={$activeTab === tab.id}
                on:click={() => onTabChange(tab.id)}
                id="tab-{tab.id}"
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            {/each}
          </div>
        </div>

        <!-- ════ DASHBOARD TAB ════ -->
        {#if $activeTab === 'dashboard'}
          <div style="display:grid;grid-template-columns:1fr 320px;gap:20px;align-items:start;" class="dashboard-grid">
            <!-- Left column -->
            <div style="display:flex;flex-direction:column;gap:20px;">
              <!-- Stats -->
              <div class="glass card">
                <div style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--color-text-muted);margin-bottom:12px;">Overview</div>
                <StatsWidget />
              </div>

              <!-- Task stats grid -->
              {#if $dashboardStats?.taskStats}
                {@const ts = $dashboardStats.taskStats}
                <div class="glass card">
                  <div style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--color-text-muted);margin-bottom:12px;">Task Overview</div>
                  <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;">
                    {#each [
                      {label:'Total',val:ts.total,color:'#6366f1'},
                      {label:'Backlog',val:ts.backlog,color:'#64748b'},
                      {label:'To Do',val:ts.todo,color:'#0ea5e9'},
                      {label:'Active',val:ts.inProgress,color:'#a855f7'},
                      {label:'Done',val:ts.completed,color:'#10b981'},
                    ] as s}
                      <div style="text-align:center;padding:12px 8px;background:rgba({s.color},0.06);border:1px solid rgba({s.color},0.15);border-radius:12px;">
                        <div style="font-size:1.4rem;font-weight:800;color:{s.color};line-height:1;">{s.val}</div>
                        <div style="font-size:0.65rem;font-weight:600;color:var(--color-text-muted);text-transform:uppercase;margin-top:4px;">{s.label}</div>
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}

              <!-- Time stats -->
              <TimeStatsWidget />
            </div>

            <!-- Right column: Recent actions -->
            <div class="glass card" style="max-height:70vh;overflow-y:auto;">
              <div style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--color-text-muted);margin-bottom:12px;">Recent Activity</div>
              <RecentActions onLoadPage={loadRecentActions} />
            </div>
          </div>
        {/if}

        <!-- ════ MEMORIES TAB ════ -->
        {#if $activeTab === 'memories'}
          <div class="glass card">
            <div style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--color-text-muted);margin-bottom:16px;">Memory Explorer</div>
            <MemoryList bind:this={memoryList} onMemoryClick={openMemoryDrawer} />
          </div>
        {/if}

        <!-- ════ TASKS TAB ════ -->
        {#if $activeTab === 'tasks'}
          <div>
            <div class="glass card" style="margin-bottom:20px;">
              <div style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--color-text-muted);margin-bottom:16px;">Task Board</div>
              <KanbanBoard
                bind:this={kanbanBoard}
                onTaskClick={openTaskDrawer}
                onAddTask={() => addTaskModalOpen = true}
              />
            </div>
          </div>
        {/if}

        <!-- ════ REFERENCE TAB ════ -->
        {#if $activeTab === 'reference'}
          <div class="glass card">
            <div style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--color-text-muted);margin-bottom:16px;">MCP Reference</div>
            {#if capabilities}
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
                <!-- Tools -->
                <div>
                  <div style="font-size:0.8rem;font-weight:700;color:var(--color-text);margin-bottom:10px;">🔧 Tools ({capabilities.tools?.length || 0})</div>
                  <div style="display:flex;flex-direction:column;gap:6px;">
                    {#each (capabilities.tools || []) as tool}
                      <div style="padding:10px;border:1px solid var(--color-border);border-radius:10px;background:rgba(241,245,249,0.5);">
                        <div class="font-semibold" style="font-size:0.8rem;color:var(--color-text);">{tool.name}</div>
                        {#if tool.description}
                          <div style="font-size:0.72rem;color:var(--color-text-muted);margin-top:2px;">{tool.description}</div>
                        {/if}
                      </div>
                    {/each}
                  </div>
                </div>
                <!-- Prompts -->
                <div>
                  <div style="font-size:0.8rem;font-weight:700;color:var(--color-text);margin-bottom:10px;">📋 Prompts ({capabilities.prompts?.length || 0})</div>
                  <div style="display:flex;flex-direction:column;gap:6px;">
                    {#each (capabilities.prompts || []) as prompt}
                      <div style="padding:10px;border:1px solid var(--color-border);border-radius:10px;background:rgba(241,245,249,0.5);">
                        <div class="font-semibold" style="font-size:0.8rem;color:var(--color-text);">{prompt.name}</div>
                        {#if prompt.description}
                          <div style="font-size:0.72rem;color:var(--color-text-muted);margin-top:2px;">{prompt.description}</div>
                        {/if}
                      </div>
                    {/each}
                  </div>
                </div>
              </div>
            {:else}
              <div style="text-align:center;padding:40px;color:var(--color-text-muted);">
                <div class="skeleton" style="height:20px;width:60%;margin:auto;border-radius:8px;margin-bottom:10px;"></div>
                <div class="skeleton" style="height:20px;width:40%;margin:auto;border-radius:8px;"></div>
              </div>
            {/if}
          </div>
        {/if}
      {/if}
    </div>
  </div>
</div>

<!-- ════ Unified Detail Drawer (Memory + Task) ════ -->
<DetailDrawer
  memory={selectedMemory}
  task={selectedTask}
  open={drawerOpen}
  onClose={closeDrawer}
  onTaskUpdated={handleTaskUpdated}
/>

<!-- ════ Add Task Modal ════ -->
{#if addTaskModalOpen}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <div class="drawer-overlay" style="display:flex;align-items:center;justify-content:center;z-index:60;" on:click={() => addTaskModalOpen = false}>
    <div
      class="glass card animate-fade-in"
      style="width:500px;max-width:95vw;border:1px solid var(--color-border);"
      on:click|stopPropagation
      role="dialog"
      aria-modal="true"
    >
      <div style="font-size:0.9rem;font-weight:700;color:var(--color-text);margin-bottom:16px;">New Task</div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div>
            <label style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-muted);display:block;margin-bottom:4px;">Task Code *</label>
            <input class="form-input" bind:value={newTask.task_code} placeholder="TASK-001" />
          </div>
          <div>
            <label style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-muted);display:block;margin-bottom:4px;">Phase</label>
            <input class="form-input" bind:value={newTask.phase} placeholder="Implementation" />
          </div>
        </div>
        <div>
          <label style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-muted);display:block;margin-bottom:4px;">Title *</label>
          <input class="form-input" bind:value={newTask.title} placeholder="Task title" />
        </div>
        <div>
          <label style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-muted);display:block;margin-bottom:4px;">Description</label>
          <textarea class="form-textarea" bind:value={newTask.description} placeholder="Task description..." rows="4"></textarea>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div>
            <label style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-muted);display:block;margin-bottom:4px;">Status</label>
            <select class="form-select" bind:value={newTask.status}>
              {#each ['backlog','pending','in_progress'] as s}
                <option value={s}>{getStatusLabel(s)}</option>
              {/each}
            </select>
          </div>
          <div>
            <label style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-muted);display:block;margin-bottom:4px;">Priority</label>
            <select class="form-select" bind:value={newTask.priority}>
              {#each [1,2,3,4,5] as p}
                <option value={p}>{getPriorityLabel(p)}</option>
              {/each}
            </select>
          </div>
        </div>
      </div>
      <div class="flex justify-between" style="margin-top:16px;">
        <button class="btn btn-ghost" on:click={() => addTaskModalOpen = false}>Cancel</button>
        <button class="btn btn-accent" on:click={createTask}>Create Task</button>
      </div>
    </div>
  </div>
{/if}

<style>
  @media (max-width: 900px) {
    .dashboard-grid {
      grid-template-columns: 1fr !important;
    }
  }
</style>
