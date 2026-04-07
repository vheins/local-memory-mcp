<script lang="ts">
  import { tasks, currentRepo, taskSearch, dashboardStats } from '../lib/stores';
  import { api } from '../lib/api';
  import TaskCard from './TaskCard.svelte';
  import type { Task } from '../lib/stores';

  export let onTaskClick: (task: Task) => void = () => {};
  export let onAddTask: () => void = () => {};

  const COLUMNS: { status: string; label: string; color: string; dot: string }[] = [
    { status: 'backlog',     label: 'Backlog',      color: 'rgba(100,116,139,0.1)', dot: '#64748b' },
    { status: 'pending',     label: 'To Do',        color: 'rgba(56,189,248,0.08)', dot: '#0ea5e9' },
    { status: 'in_progress', label: 'In Progress',  color: 'rgba(99,102,241,0.08)', dot: '#6366f1' },
    { status: 'completed',   label: 'Completed',    color: 'rgba(16,185,129,0.08)', dot: '#10b981' },
  ];

  let loadingCols = new Set<string>();
  let pagination: Record<string, { page: number; pageSize: number; hasMore: boolean }> = {};
  let columnTasks: Record<string, Task[]> = {};

  COLUMNS.forEach(c => {
    pagination[c.status] = { page: 1, pageSize: 20, hasMore: true };
    columnTasks[c.status] = [];
  });

  export async function loadTasks(repo: string) {
    if (!repo) return;
    // Reset
    COLUMNS.forEach(c => {
      pagination[c.status] = { page: 1, pageSize: 20, hasMore: true };
      columnTasks[c.status] = [];
    });
    await Promise.all(COLUMNS.map(c => loadColumn(repo, c.status)));
    columnTasks = { ...columnTasks };
  }

  async function loadColumn(repo: string, status: string) {
    if (loadingCols.has(status)) return;
    loadingCols = new Set([...loadingCols, status]);
    const p = pagination[status];
    try {
      const data = await api.tasks({
        repo,
        status,
        search: $taskSearch,
        page: p.page,
        pageSize: p.pageSize,
      });
      if (p.page === 1) {
        columnTasks[status] = data.tasks || [];
      } else {
        columnTasks[status] = [...(columnTasks[status] || []), ...(data.tasks || [])];
      }
      pagination[status] = {
        ...p,
        hasMore: (data.tasks?.length || 0) >= p.pageSize,
      };
    } catch (e) {
      console.error(`Failed to load ${status}:`, e);
    }
    loadingCols = new Set([...loadingCols].filter(s => s !== status));
    columnTasks = { ...columnTasks };
  }

  async function loadMore(status: string) {
    if (!$currentRepo) return;
    pagination[status].page++;
    await loadColumn($currentRepo, status);
  }

</script>

<div>
  <!-- Toolbar -->
  <div class="flex items-center justify-between mb-4">
    <div class="flex items-center gap-2">
      <input
        class="form-input"
        style="width:200px;font-size:0.8rem;"
        type="text"
        placeholder="Search tasks..."
        bind:value={$taskSearch}
        on:input={() => $currentRepo && loadTasks($currentRepo)}
      />
    </div>
    <div class="flex gap-2">
      <button class="btn btn-accent btn-sm" on:click={onAddTask}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
        Add Task
      </button>
    </div>
  </div>

  <!-- Kanban -->
  <div class="kanban-board" style="padding-bottom:16px;">
    {#each COLUMNS as col}
      <div class="kanban-col glass" style="background:{col.color};border:1px solid var(--color-border);padding:12px;">
        <!-- Column header -->
        <div class="flex items-center gap-2 mb-3">
          <div style="width:10px;height:10px;border-radius:9999px;background:{col.dot};"></div>
          <span style="font-size:0.78rem;font-weight:700;color:var(--color-text);">{col.label}</span>
          <span style="margin-left:auto;font-size:0.7rem;font-weight:700;background:rgba(148,163,184,0.15);color:var(--color-text-muted);padding:1px 8px;border-radius:9999px;">
            {columnTasks[col.status]?.length || 0}{pagination[col.status]?.hasMore ? '+' : ''}
          </span>
        </div>

        <!-- Task cards -->
        <div class="flex flex-col" style="gap:8px;overflow-y:auto;max-height:calc(100vh - 340px);padding-right:2px;">
          {#if (columnTasks[col.status] || []).length === 0}
            {#if loadingCols.has(col.status)}
              <div class="skeleton" style="height:80px;border-radius:12px;"></div>
              <div class="skeleton" style="height:60px;border-radius:12px;"></div>
            {:else}
              <div style="text-align:center;padding:24px 8px;color:var(--color-text-muted);font-size:0.75rem;">
                <div style="font-size:1.5rem;margin-bottom:6px;">📭</div>
                No tasks
              </div>
            {/if}
          {:else}
            {#each columnTasks[col.status] as task (task.id)}
              <TaskCard {task} onClick={() => onTaskClick(task)} />
            {/each}

            <!-- Load more -->
            {#if pagination[col.status]?.hasMore}
              <button
                class="btn btn-ghost btn-sm w-full"
                style="margin-top:4px;"
                on:click={() => loadMore(col.status)}
                disabled={loadingCols.has(col.status)}
              >
                {loadingCols.has(col.status) ? 'Loading…' : 'Load more'}
              </button>
            {/if}
          {/if}
        </div>
      </div>
    {/each}
  </div>
</div>
