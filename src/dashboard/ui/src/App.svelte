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
  import Icon from './lib/Icon.svelte';

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

  // Reference Tab state
  let referenceSearch = '';
  let referenceFilter: 'all' | 'tools' | 'prompts' = 'all';

  $: filteredTools = (capabilities?.tools || []).filter((t: any) =>
    (referenceFilter === 'all' || referenceFilter === 'tools') &&
    (!referenceSearch || t.name.toLowerCase().includes(referenceSearch.toLowerCase()) || (t.description || '').toLowerCase().includes(referenceSearch.toLowerCase()))
  );
  $: filteredPrompts = (capabilities?.prompts || []).filter((p: any) =>
    (referenceFilter === 'all' || referenceFilter === 'prompts') &&
    (!referenceSearch || p.name.toLowerCase().includes(referenceSearch.toLowerCase()) || (p.description || '').toLowerCase().includes(referenceSearch.toLowerCase()))
  );

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

  async function openTaskDrawer(task: Task) {
    selectedTask = task;
    selectedMemory = null;
    drawerOpen = true;
    try {
      const fullTask = await api.taskById(task.id);
      if (selectedTask?.id === fullTask.id) {
        selectedTask = fullTask;
      }
    } catch (err) {
      console.error('Failed to fetch full task details:', err);
    }
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
    { id: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard' },
    { id: 'memories', label: 'Memories', icon: 'brain' },
    { id: 'tasks', label: 'Tasks', icon: 'clipboard-list' },
    { id: 'reference', label: 'Reference', icon: 'book-open' },
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
        <div style="text-align:center;padding:80px 20px;" class="animate-fade-in">
          <div style="display:inline-flex;width:72px;height:72px;border-radius:20px;background:linear-gradient(135deg,rgba(14,165,233,0.15),rgba(99,102,241,0.15));border:1px solid rgba(14,165,233,0.2);align-items:center;justify-content:center;margin-bottom:20px;" class="animate-float">
            <Icon name="brain" size={32} strokeWidth={1.5} className="" />
          </div>
          <div style="font-size:1.25rem;font-weight:800;color:var(--color-text);margin-bottom:8px;letter-spacing:-0.02em;">No Repository Selected</div>
          <div style="color:var(--color-text-muted);font-size:0.875rem;">Select a repository from the sidebar to get started.</div>
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
                <Icon name={tab.icon} size={14} strokeWidth={1.75} />
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
                <div class="glass card hover-glow">
                  <div class="section-label" style="margin-bottom:12px;">Task Overview</div>
                  <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;">
                    {#each [
                      {label:'Total', val:ts.total, icon:'layers', color:'#6366f1', glow:'rgba(99,102,241,0.18)'},
                      {label:'Backlog', val:ts.backlog, icon:'inbox', color:'#64748b', glow:'rgba(100,116,139,0.18)'},
                      {label:'To Do', val:ts.todo, icon:'circle-dot', color:'#0ea5e9', glow:'rgba(14,165,233,0.18)'},
                      {label:'Active', val:ts.inProgress, icon:'zap', color:'#a855f7', glow:'rgba(168,85,247,0.18)'},
                      {label:'Done', val:ts.completed, icon:'circle-check', color:'#10b981', glow:'rgba(16,185,129,0.18)'},
                    ] as s}
                      <div class="stat-card" style="text-align:center;background:{s.glow};border:1px solid {s.glow};">
                        <div style="display:flex;justify-content:center;margin-bottom:6px;color:{s.color};opacity:0.8;">
                          <Icon name={s.icon} size={16} strokeWidth={1.75} />
                        </div>
                        <div style="font-size:1.5rem;font-weight:900;color:{s.color};line-height:1;letter-spacing:-0.03em;">{s.val}</div>
                        <div style="font-size:0.62rem;font-weight:700;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-top:4px;">{s.label}</div>
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
          <div class="glass card hover-glow animate-fade-in">
            <div class="flex items-center gap-2" style="margin-bottom:16px;">
              <Icon name="brain" size={14} strokeWidth={1.75} />
              <div class="section-label">Memory Explorer</div>
            </div>
            <MemoryList bind:this={memoryList} onMemoryClick={openMemoryDrawer} />
          </div>
        {/if}

        <!-- ════ TASKS TAB ════ -->
        {#if $activeTab === 'tasks'}
          <div class="animate-fade-in">
            <div class="glass card hover-glow" style="margin-bottom:20px;">
              <div class="flex items-center gap-2" style="margin-bottom:16px;">
                <Icon name="columns" size={14} strokeWidth={1.75} />
                <div class="section-label">Task Board</div>
              </div>
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
          <div class="animate-fade-in">
            <!-- Header -->
            <div class="glass card" style="margin-bottom:16px;padding:14px 18px;">
              <div class="ref-header">
                <div class="flex items-center gap-2">
                  <Icon name="book-open" size={15} strokeWidth={1.75} />
                  <span style="font-size:0.9rem;font-weight:800;color:var(--color-text);letter-spacing:-0.02em;">MCP Reference</span>
                  {#if capabilities}
                    <span class="ref-total-badge">{(capabilities.tools?.length || 0) + (capabilities.prompts?.length || 0)} items</span>
                  {/if}
                </div>
                <!-- Quick Search -->
                <div class="ref-search-wrap">
                  <span class="ref-search-icon"><Icon name="search" size={12} strokeWidth={2} /></span>
                  <input
                    class="form-input ref-search-input"
                    type="text"
                    placeholder="Search tools & prompts…"
                    bind:value={referenceSearch}
                  />
                  {#if referenceSearch}
                    <button class="ref-clear-btn" on:click={() => referenceSearch = ''}>
                      <Icon name="x" size={11} strokeWidth={2.5} />
                    </button>
                  {/if}
                </div>
              </div>
            </div>

            <!-- Body: sidebar + main -->
            <div class="ref-body">
              <!-- Category sidebar -->
              <div class="glass ref-sidebar">
                <div class="ref-sidebar-label">Category</div>
                {#each [
                  { id: 'all',     icon: 'layers',  label: 'All',     count: (capabilities?.tools?.length || 0) + (capabilities?.prompts?.length || 0) },
                  { id: 'tools',   icon: 'tool',    label: 'Tools',   count: capabilities?.tools?.length || 0 },
                  { id: 'prompts', icon: 'sparkle', label: 'Prompts', count: capabilities?.prompts?.length || 0 },
                ] as cat}
                  <button
                    class="ref-cat-btn"
                    class:active={referenceFilter === cat.id}
                    on:click={() => referenceFilter = cat.id as any}
                  >
                    <Icon name={cat.icon} size={13} strokeWidth={1.75} />
                    <span>{cat.label}</span>
                    <span class="ref-cat-count">{cat.count}</span>
                  </button>
                {/each}
              </div>

              <!-- Main content -->
              <div class="ref-main">
                {#if !capabilities}
                  <div style="padding:40px;text-align:center;">
                    <div class="skeleton" style="height:60px;border-radius:12px;margin-bottom:10px;"></div>
                    <div class="skeleton" style="height:60px;border-radius:12px;margin-bottom:10px;"></div>
                    <div class="skeleton" style="height:60px;border-radius:12px;"></div>
                  </div>
                {:else}
                  <!-- Tools section -->
                  {#if filteredTools.length > 0}
                    <div class="ref-section-header">
                      <Icon name="tool" size={13} strokeWidth={1.75} />
                      <span>Tools</span>
                      <span class="ref-section-count">{filteredTools.length}</span>
                    </div>
                    <div class="ref-grid">
                      {#each filteredTools as tool}
                        <div class="ref-card ref-card-tool animate-fade-in">
                          <div class="ref-card-top">
                            <span class="ref-type-badge ref-type-tool">
                              <Icon name="tool" size={10} strokeWidth={2} />
                              Tool
                            </span>
                          </div>
                          <div class="ref-card-name">{tool.name}</div>
                          {#if tool.description}
                            <div class="ref-card-desc">{tool.description}</div>
                          {/if}
                          {#if tool.inputSchema?.properties}
                            <div class="ref-params">
                              {#each Object.entries(tool.inputSchema.properties).slice(0, 4) as [param]}
                                <code class="ref-param-tag">{param}</code>
                              {/each}
                              {#if Object.keys(tool.inputSchema.properties).length > 4}
                                <code class="ref-param-tag ref-param-more">+{Object.keys(tool.inputSchema.properties).length - 4}</code>
                              {/if}
                            </div>
                          {/if}
                        </div>
                      {/each}
                    </div>
                  {/if}

                  <!-- Prompts section -->
                  {#if filteredPrompts.length > 0}
                    <div class="ref-section-header" style="margin-top:{filteredTools.length > 0 ? '20px' : '0'}">
                      <Icon name="sparkle" size={13} strokeWidth={1.75} />
                      <span>Prompts</span>
                      <span class="ref-section-count">{filteredPrompts.length}</span>
                    </div>
                    <div class="ref-grid">
                      {#each filteredPrompts as prompt}
                        <div class="ref-card ref-card-prompt animate-fade-in">
                          <div class="ref-card-top">
                            <span class="ref-type-badge ref-type-prompt">
                              <Icon name="sparkle" size={10} strokeWidth={2} />
                              Prompt
                            </span>
                          </div>
                          <div class="ref-card-name">{prompt.name}</div>
                          {#if prompt.description}
                            <div class="ref-card-desc">{prompt.description}</div>
                          {/if}
                        </div>
                      {/each}
                    </div>
                  {/if}

                  {#if filteredTools.length === 0 && filteredPrompts.length === 0}
                    <div style="text-align:center;padding:48px 16px;color:var(--color-text-muted);">
                      <Icon name="search" size={28} strokeWidth={1.25} />
                      <div style="font-size:0.82rem;margin-top:10px;">No results for "{referenceSearch}"</div>
                    </div>
                  {/if}
                {/if}
              </div>
            </div>
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
      <div class="flex items-center gap-2" style="margin-bottom:16px;">
        <Icon name="plus" size={16} strokeWidth={2} />
        <span style="font-size:0.9rem;font-weight:700;color:var(--color-text);">New Task</span>
      </div>
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

  /* ── Reference Tab ── */
  .ref-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }

  .ref-total-badge {
    font-size: 0.62rem;
    font-weight: 700;
    background: rgba(14, 165, 233, 0.1);
    color: #0ea5e9;
    padding: 2px 8px;
    border-radius: 9999px;
    border: 1px solid rgba(14, 165, 233, 0.2);
  }

  .ref-search-wrap {
    position: relative;
    flex: 1;
    max-width: 300px;
  }

  .ref-search-icon {
    position: absolute;
    left: 10px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--color-text-muted);
    display: flex;
    pointer-events: none;
  }

  .ref-search-input {
    padding-left: 32px;
    padding-right: 28px;
    font-size: 0.8rem;
    width: 100%;
  }

  .ref-clear-btn {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--color-text-muted);
    display: flex;
    padding: 2px;
    border-radius: 4px;
    transition: color 0.15s ease;
  }

  .ref-clear-btn:hover { color: var(--color-text); }

  .ref-body {
    display: grid;
    grid-template-columns: 160px 1fr;
    gap: 16px;
    align-items: start;
  }

  @media (max-width: 700px) {
    .ref-body { grid-template-columns: 1fr; }
  }

  .ref-sidebar {
    padding: 12px;
    border-radius: 16px;
    border: 1px solid var(--color-border);
    display: flex;
    flex-direction: column;
    gap: 3px;
    position: sticky;
    top: 80px;
  }

  .ref-sidebar-label {
    font-size: 0.6rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--color-text-muted);
    padding: 4px 8px 8px;
  }

  .ref-cat-btn {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 7px 10px;
    border-radius: 9px;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--color-text-muted);
    background: transparent;
    border: none;
    cursor: pointer;
    width: 100%;
    text-align: left;
    transition: all 0.15s ease;
  }

  .ref-cat-btn:hover {
    background: rgba(14, 165, 233, 0.06);
    color: var(--color-text);
  }

  .ref-cat-btn.active {
    background: rgba(14, 165, 233, 0.1);
    color: #0ea5e9;
    border: 1px solid rgba(14, 165, 233, 0.2);
  }

  :global(html.dark) .ref-cat-btn.active {
    background: rgba(14, 165, 233, 0.15);
    color: #38bdf8;
    border-color: rgba(56, 189, 248, 0.25);
  }

  .ref-cat-count {
    margin-left: auto;
    font-size: 0.62rem;
    font-weight: 700;
    background: rgba(100, 116, 139, 0.12);
    color: var(--color-text-muted);
    padding: 1px 6px;
    border-radius: 9999px;
  }

  .ref-main {
    display: flex;
    flex-direction: column;
  }

  .ref-section-header {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--color-text-muted);
    margin-bottom: 10px;
  }

  .ref-section-count {
    font-size: 0.6rem;
    background: rgba(100, 116, 139, 0.1);
    color: var(--color-text-muted);
    padding: 1px 6px;
    border-radius: 9999px;
    font-weight: 700;
  }

  .ref-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 10px;
  }

  .ref-card {
    padding: 12px 14px;
    border-radius: 14px;
    border: 1px solid var(--color-border);
    background: rgba(241, 245, 249, 0.45);
    transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .ref-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(14, 165, 233, 0.1);
    border-color: rgba(14, 165, 233, 0.3);
  }

  :global(html.dark) .ref-card {
    background: rgba(10, 18, 38, 0.5);
  }

  :global(html.dark) .ref-card:hover {
    border-color: rgba(56, 189, 248, 0.3);
    box-shadow: 0 6px 20px rgba(14, 165, 233, 0.08);
  }

  .ref-card-tool:hover { border-color: rgba(99, 102, 241, 0.3); }
  .ref-card-prompt:hover { border-color: rgba(168, 85, 247, 0.3); }

  .ref-card-top {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .ref-type-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 0.6rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 2px 7px;
    border-radius: 9999px;
    border: 1px solid transparent;
  }

  .ref-type-tool {
    background: rgba(99, 102, 241, 0.1);
    color: #6366f1;
    border-color: rgba(99, 102, 241, 0.2);
  }

  .ref-type-prompt {
    background: rgba(168, 85, 247, 0.1);
    color: #a855f7;
    border-color: rgba(168, 85, 247, 0.2);
  }

  :global(html.dark) .ref-type-tool { color: #818cf8; }
  :global(html.dark) .ref-type-prompt { color: #c084fc; }

  .ref-card-name {
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--color-text);
    word-break: break-word;
  }

  .ref-card-desc {
    font-size: 0.72rem;
    color: var(--color-text-muted);
    line-height: 1.55;
  }

  .ref-params {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 4px;
  }

  .ref-param-tag {
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 0.65rem;
    background: rgba(14, 165, 233, 0.08);
    color: #0ea5e9;
    padding: 1px 6px;
    border-radius: 5px;
    border: 1px solid rgba(14, 165, 233, 0.18);
  }

  .ref-param-more {
    background: rgba(100, 116, 139, 0.1);
    color: var(--color-text-muted);
    border-color: rgba(100, 116, 139, 0.2);
  }

  :global(html.dark) .ref-param-tag {
    background: rgba(14, 165, 233, 0.12);
    color: #38bdf8;
    border-color: rgba(56, 189, 248, 0.2);
  }
</style>
