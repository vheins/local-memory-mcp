<script lang="ts">
  import { tasks, currentRepo, taskSearch, dashboardStats } from '../lib/stores';
  import { api } from '../lib/api';
  import TaskCard from './TaskCard.svelte';
  import Icon from '../lib/Icon.svelte';
  import type { Task } from '../lib/stores';

  export let onTaskClick: (task: Task) => void = () => {};
  export let onAddTask: () => void = () => {};

  const COLUMNS: { status: string; label: string; bg: string; border: string; icon: string; color: string }[] = [
    { status: 'backlog',     label: 'Backlog',      bg: 'rgba(100,116,139,0.07)', border: 'rgba(100,116,139,0.18)', icon: 'archive',      color: '#64748b' },
    { status: 'pending',     label: 'To Do',        bg: 'rgba(14,165,233,0.06)',  border: 'rgba(14,165,233,0.18)',  icon: 'circle-dot',   color: '#0ea5e9' },
    { status: 'in_progress', label: 'In Progress',  bg: 'rgba(168,85,247,0.07)', border: 'rgba(168,85,247,0.18)', icon: 'zap',           color: '#a855f7' },
    { status: 'completed',   label: 'Completed',    bg: 'rgba(16,185,129,0.06)', border: 'rgba(16,185,129,0.18)', icon: 'circle-check',  color: '#10b981' },
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
    <div class="search-wrap">
      <span class="search-icon-inner">
        <Icon name="search" size={13} strokeWidth={2} />
      </span>
      <input
        class="form-input"
        style="padding-left:32px;width:220px;font-size:0.8rem;"
        type="text"
        placeholder="Search tasks…"
        bind:value={$taskSearch}
        on:input={() => $currentRepo && loadTasks($currentRepo)}
      />
    </div>
    <button class="btn btn-accent btn-sm" on:click={onAddTask}>
      <Icon name="plus" size={14} strokeWidth={2.5} />
      Add Task
    </button>
  </div>

  <!-- Kanban Board -->
  <div class="kanban-board" style="padding-bottom:16px;">
    {#each COLUMNS as col}
      <div class="kanban-col" style="background:{col.bg};border:1px solid {col.border};padding:12px;border-radius:16px;">
        <!-- Column header -->
        <div class="flex items-center gap-2 mb-3">
          <span style="color:{col.color};display:flex;flex-shrink:0;">
            <Icon name={col.icon} size={13} strokeWidth={2} />
          </span>
          <span style="font-size:0.78rem;font-weight:700;color:var(--color-text);">{col.label}</span>
          <span class="col-count" style="margin-left:auto;background:{col.bg};color:{col.color};border:1px solid {col.border};">
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
              <div class="empty-col">
                <span style="color:{col.color};opacity:0.5;"><Icon name={col.icon} size={22} strokeWidth={1.25} /></span>
                <div style="font-size:0.75rem;color:var(--color-text-muted);margin-top:6px;">No tasks</div>
              </div>
            {/if}
          {:else}
            {#each columnTasks[col.status] as task (task.id)}
              <TaskCard {task} on:click={() => onTaskClick(task)} />
            {/each}

            <!-- Load more -->
            {#if pagination[col.status]?.hasMore}
              <button
                class="btn btn-ghost btn-sm w-full"
                style="margin-top:4px;justify-content:center;"
                on:click={() => loadMore(col.status)}
                disabled={loadingCols.has(col.status)}
              >
                {#if loadingCols.has(col.status)}
                  <span class="animate-spin"><Icon name="refresh-cw" size={12} strokeWidth={2} /></span>
                {:else}
                  <Icon name="chevron-down" size={12} strokeWidth={2} />
                {/if}
                {loadingCols.has(col.status) ? 'Loading…' : 'Load more'}
              </button>
            {/if}
          {/if}
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .search-wrap {
    position: relative;
  }

  .search-icon-inner {
    position: absolute;
    left: 10px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--color-text-muted);
    display: flex;
    pointer-events: none;
  }

  .col-count {
    font-size: 0.65rem;
    font-weight: 700;
    padding: 1px 8px;
    border-radius: 9999px;
  }

  .empty-col {
    text-align: center;
    padding: 28px 8px;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
</style>
