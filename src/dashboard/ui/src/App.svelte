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

  // Component refs
  let kanbanBoard: KanbanBoard;
  let memoryList: MemoryList;

  // Mobile menu
  let mobileMenuOpen = false;

  // Drawer state
  let selectedMemory: Memory | null = null;
  let selectedTask: Task | null = null;
  let drawerOpen = false;
  let taskDrawerOpen = false;

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
    drawerOpen = true;
  }

  function closeDrawer() {
    drawerOpen = false;
    setTimeout(() => selectedMemory = null, 300);
  }

  function openTaskDrawer(task: Task) {
    selectedTask = task;
    taskDrawerOpen = true;
  }

  function closeTaskDrawer() {
    taskDrawerOpen = false;
    setTimeout(() => selectedTask = null, 300);
  }

  async function saveTaskUpdate(field: string, value: any) {
    if (!selectedTask) return;
    try {
      await api.updateTask(selectedTask.id, { [field]: value });
      selectedTask = { ...selectedTask, [field]: value };
      if ($currentRepo) kanbanBoard?.loadTasks($currentRepo);
    } catch (e) {
      console.error('Failed to update task:', e);
    }
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
    if (e.key === 'Escape') { closeDrawer(); closeTaskDrawer(); }
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
    <div id="dashboardShell" style="padding: 20px; padding-top: 80px; min-height: 100vh;">

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

<!-- ════ Memory Detail Drawer ════ -->
{#if drawerOpen && selectedMemory}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <div class="drawer-overlay" on:click={closeDrawer}></div>
  <div class="drawer-panel animate-fade-in" style="overflow-y:auto;">
    <!-- Header -->
    <div style="padding:20px;border-bottom:1px solid var(--color-border);display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-shrink:0;">
      <div>
        <span class="type-chip type-{selectedMemory.type}" style="margin-bottom:8px;display:inline-flex;">{selectedMemory.type}</span>
        <div style="font-size:1rem;font-weight:700;color:var(--color-text);line-height:1.3;">{selectedMemory.title}</div>
      </div>
      <button class="btn btn-ghost btn-icon" on:click={closeDrawer} aria-label="Close">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M18 6 6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
    <!-- Body -->
    <div style="padding:20px;flex:1;overflow-y:auto;">
      <!-- Meta -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">
        {#each [
          {label:'Importance', val:selectedMemory.importance},
          {label:'Hit Count', val:selectedMemory.hit_count ?? 0},
          {label:'Created', val:formatDate(selectedMemory.created_at)},
          {label:'Updated', val:formatDate(selectedMemory.updated_at)},
        ] as m}
          <div style="padding:10px;background:rgba(241,245,249,0.8);border-radius:10px;border:1px solid var(--color-border);">
            <div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-muted);margin-bottom:2px;">{m.label}</div>
            <div style="font-size:0.9rem;font-weight:600;color:var(--color-text);">{m.val}</div>
          </div>
        {/each}
      </div>

      <!-- Tags -->
      {#if selectedMemory.tags?.length}
        <div style="margin-bottom:16px;">
          <div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-muted);margin-bottom:6px;">Tags</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            {#each selectedMemory.tags as tag}
              <span style="font-size:0.72rem;background:rgba(99,102,241,0.1);color:#6366f1;border:1px solid rgba(99,102,241,0.2);padding:2px 10px;border-radius:9999px;">{tag}</span>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Content -->
      <div>
        <div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-muted);margin-bottom:8px;">Content</div>
        <div class="markdown-body" style="background:rgba(248,250,252,0.8);border:1px solid var(--color-border);border-radius:12px;padding:16px;">
          {@html renderMarkdown(selectedMemory.content)}
        </div>
      </div>

      <!-- Metadata -->
      {#if selectedMemory.metadata && Object.keys(selectedMemory.metadata).length > 0}
        <div style="margin-top:16px;">
          <div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-muted);margin-bottom:8px;">Metadata</div>
          <pre style="font-size:0.75rem;background:rgba(248,250,252,0.8);border:1px solid var(--color-border);border-radius:12px;padding:12px;overflow-x:auto;color:var(--color-text);font-family:'JetBrains Mono',monospace;">{JSON.stringify(selectedMemory.metadata, null, 2)}</pre>
        </div>
      {/if}
    </div>
  </div>
{/if}

<!-- ════ Task Detail Drawer ════ -->
{#if taskDrawerOpen && selectedTask}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <div class="drawer-overlay" on:click={closeTaskDrawer}></div>
  <div class="drawer-panel animate-fade-in" style="overflow-y:auto;">
    <div style="padding:20px;border-bottom:1px solid var(--color-border);display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-shrink:0;">
      <div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <span class="status-chip {getStatusColor(selectedTask.status)}">{getStatusLabel(selectedTask.status)}</span>
          <span style="font-size:0.7rem;font-weight:700;color:var(--color-text-muted);">{selectedTask.task_code}</span>
        </div>
        <div style="font-size:1rem;font-weight:700;color:var(--color-text);line-height:1.3;">{selectedTask.title}</div>
      </div>
      <button class="btn btn-ghost btn-icon" on:click={closeTaskDrawer} aria-label="Close">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M18 6 6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
    <div style="padding:20px;overflow-y:auto;">
      <!-- Status change -->
      <div style="margin-bottom:16px;">
        <div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-muted);margin-bottom:6px;">Status</div>
        <select
          class="form-select"
          style="font-size:0.82rem;"
          value={selectedTask.status}
          on:change={e => saveTaskUpdate('status', (e.target as HTMLSelectElement).value)}
        >
          {#each ['backlog','pending','in_progress','completed','blocked','canceled'] as s}
            <option value={s}>{getStatusLabel(s)}</option>
          {/each}
        </select>
      </div>

      <!-- Meta grid -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">
        {#each [
          {label:'Priority', val:getPriorityLabel(selectedTask.priority)},
          {label:'Phase', val:selectedTask.phase},
          {label:'Agent', val:selectedTask.agent || '—'},
          {label:'Updated', val:formatDate(selectedTask.updated_at)},
        ] as m}
          <div style="padding:10px;background:rgba(241,245,249,0.8);border-radius:10px;border:1px solid var(--color-border);">
            <div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-muted);margin-bottom:2px;">{m.label}</div>
            <div style="font-size:0.85rem;font-weight:600;color:var(--color-text);">{m.val}</div>
          </div>
        {/each}
      </div>

      <!-- Description -->
      {#if selectedTask.description}
        <div style="margin-bottom:16px;">
          <div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-muted);margin-bottom:8px;">Description</div>
          <div class="markdown-body" style="background:rgba(248,250,252,0.8);border:1px solid var(--color-border);border-radius:12px;padding:16px;">
            {@html renderMarkdown(selectedTask.description)}
          </div>
        </div>
      {/if}

      <!-- Comments -->
      {#if selectedTask.comments?.length}
        <div>
          <div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-muted);margin-bottom:8px;">
            Activity ({selectedTask.comments.length})
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            {#each selectedTask.comments as c}
              <div style="padding:10px 14px;border:1px solid var(--color-border);border-radius:10px;background:rgba(241,245,249,0.5);">
                <div class="flex items-center justify-between mb-1">
                  <div class="flex items-center gap-2">
                    <div style="width:20px;height:20px;border-radius:9999px;background:linear-gradient(135deg,#6366f1,#0ea5e9);display:flex;align-items:center;justify-content:center;font-size:9px;color:white;font-weight:700;">
                      {(c.agent || 'U').charAt(0).toUpperCase()}
                    </div>
                    <span style="font-size:0.72rem;font-weight:600;color:var(--color-text);">{c.agent || 'Unknown'}</span>
                    {#if c.previous_status && c.next_status}
                      <span style="font-size:0.65rem;color:var(--color-text-muted);">
                        {getStatusLabel(c.previous_status)} → {getStatusLabel(c.next_status)}
                      </span>
                    {/if}
                  </div>
                  <span style="font-size:0.65rem;color:var(--color-text-muted);">{formatDate(c.created_at)}</span>
                </div>
                <div style="font-size:0.78rem;color:var(--color-text);line-height:1.5;">{c.comment}</div>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}

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
