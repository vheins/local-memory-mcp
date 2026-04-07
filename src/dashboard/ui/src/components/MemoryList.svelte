<script lang="ts">
  import {
    memories, memoriesTotal, memoriesPage, memoriesPageSize,
    memoriesTotalPages, memoriesSearch, memoriesTypeFilter,
    memoriesImportanceMin, memoriesImportanceMax,
    memoriesSortBy, memoriesSortOrder, selectedMemoryIds,
    currentRepo
  } from '../lib/stores';
  import { api } from '../lib/api';
  import { formatDate, debounce, exportToJSON, exportToCSV } from '../lib/utils';
  import type { Memory } from '../lib/stores';

  export let onMemoryClick: (mem: Memory) => void = () => {};

  let loading = false;

  const TYPES = [
    'code_fact', 'decision', 'mistake', 'pattern',
    'agent_handoff', 'agent_registered', 'file_claim', 'task_archive'
  ];

  const TYPE_LABELS: Record<string, string> = {
    code_fact: 'Code Fact', decision: 'Decision', mistake: 'Mistake',
    pattern: 'Pattern', agent_handoff: 'Handoff', agent_registered: 'Registered',
    file_claim: 'File Claim', task_archive: 'Task Archive'
  };

  async function loadMemories() {
    const repo = $currentRepo;
    if (!repo) { memories.set([]); return; }
    loading = true;
    try {
      const data = await api.memories({
        repo,
        type: $memoriesTypeFilter || undefined,
        search: $memoriesSearch || undefined,
        minImportance: $memoriesImportanceMin,
        maxImportance: $memoriesImportanceMax,
        sortBy: $memoriesSortBy,
        sortOrder: $memoriesSortOrder,
        page: $memoriesPage,
        pageSize: $memoriesPageSize,
      });
      memories.set(data.memories || []);
      memoriesTotal.set(data.pagination?.totalItems || 0);
    } catch (e) {
      console.error('Failed to load memories:', e);
    }
    loading = false;
  }

  export function refresh() { loadMemories(); }

  const debouncedSearch = debounce(() => {
    memoriesPage.set(1);
    loadMemories();
  }, 300);

  function onSearchInput() { debouncedSearch(); }

  function onFilterChange() {
    memoriesPage.set(1);
    loadMemories();
  }

  function goToPage(p: number) {
    if (p < 1 || p > $memoriesTotalPages) return;
    memoriesPage.set(p);
    loadMemories();
  }

  function toggleSort(col: string) {
    if ($memoriesSortBy === col) {
      memoriesSortOrder.update(o => o === 'desc' ? 'asc' : 'desc');
    } else {
      memoriesSortBy.set(col);
      memoriesSortOrder.set('desc');
    }
    loadMemories();
  }

  function toggleSelect(id: string) {
    selectedMemoryIds.update(ids => {
      const next = new Set(ids);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    selectedMemoryIds.update(ids => {
      if (ids.size === $memories.length) return new Set();
      return new Set($memories.map(m => m.id));
    });
  }

  async function handleExport(format: 'json' | 'csv') {
    if (!$currentRepo) return;
    const data = await api.export($currentRepo);
    const filename = `${$currentRepo.replace('/', '_')}_export`;
    if (format === 'json') exportToJSON(data, filename + '.json');
    else exportToCSV(data.memories || [], filename + '.csv');
  }

  $: allSelected = $memories.length > 0 && $selectedMemoryIds.size === $memories.length;

  const importanceBg: Record<number, string> = {
    1: 'rgba(100,116,139,0.15)',
    2: 'rgba(59,130,246,0.15)',
    3: 'rgba(245,158,11,0.15)',
    4: 'rgba(249,115,22,0.15)',
    5: 'rgba(239,68,68,0.15)',
  };
  const importanceColor: Record<number, string> = {
    1: '#64748b', 2: '#3b82f6', 3: '#f59e0b', 4: '#f97316', 5: '#ef4444'
  };
</script>

<div>
  <!-- Toolbar -->
  <div class="flex items-center gap-2 mb-3" style="flex-wrap:wrap;">
    <div style="position:relative;flex:1;min-width:160px;">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--color-text-muted);">
        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
      </svg>
      <input
        class="form-input"
        style="padding-left:32px;font-size:0.8rem;"
        type="text"
        placeholder="Search memories..."
        bind:value={$memoriesSearch}
        on:input={onSearchInput}
      />
    </div>

    <select class="form-select" style="width:140px;font-size:0.8rem;" bind:value={$memoriesTypeFilter} on:change={onFilterChange}>
      <option value="">All Types</option>
      {#each TYPES as t}
        <option value={t}>{TYPE_LABELS[t]}</option>
      {/each}
    </select>

    <select class="form-select" style="width:100px;font-size:0.8rem;" bind:value={$memoriesImportanceMin} on:change={onFilterChange}>
      <option value={null}>Min Imp.</option>
      {#each [1,2,3,4,5] as i}
        <option value={i}>{i}</option>
      {/each}
    </select>

    <select class="form-select" style="width:100px;font-size:0.8rem;" bind:value={$memoriesPageSize} on:change={() => { memoriesPage.set(1); loadMemories(); }}>
      {#each [10, 25, 50, 100] as n}
        <option value={n}>{n} / page</option>
      {/each}
    </select>

    <div class="flex gap-1">
      <button class="btn btn-ghost btn-sm" on:click={() => handleExport('json')} title="Export JSON">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        JSON
      </button>
      <button class="btn btn-ghost btn-sm" on:click={() => handleExport('csv')} title="Export CSV">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        CSV
      </button>
    </div>
  </div>

  <!-- Count -->
  <div style="font-size:0.72rem;color:var(--color-text-muted);margin-bottom:8px;">
    {$memoriesTotal} memories
    {$selectedMemoryIds.size > 0 ? `· ${$selectedMemoryIds.size} selected` : ''}
  </div>

  <!-- Table -->
  <div style="overflow-x:auto;border-radius:14px;border:1px solid var(--color-border);">
    <table style="width:100%;border-collapse:collapse;min-width:600px;">
      <thead>
        <tr style="border-bottom:1px solid var(--color-border);background:rgba(248,250,252,0.8);">
          <th style="padding:10px 12px;text-align:left;width:36px;">
            <input type="checkbox" checked={allSelected} on:change={toggleSelectAll} aria-label="Select all" />
          </th>
          <th
            style="padding:10px 12px;text-align:left;font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-muted);cursor:pointer;white-space:nowrap;"
            on:click={() => toggleSort('title')}
          >
            Title {$memoriesSortBy === 'title' ? ($memoriesSortOrder === 'desc' ? '↓' : '↑') : ''}
          </th>
          <th style="padding:10px 12px;text-align:left;font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-muted);">Type</th>
          <th
            style="padding:10px 12px;text-align:center;font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-muted);cursor:pointer;"
            on:click={() => toggleSort('importance')}
          >
            Imp. {$memoriesSortBy === 'importance' ? ($memoriesSortOrder === 'desc' ? '↓' : '↑') : ''}
          </th>
          <th
            style="padding:10px 12px;text-align:left;font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-muted);cursor:pointer;"
            on:click={() => toggleSort('updated_at')}
          >
            Updated {$memoriesSortBy === 'updated_at' ? ($memoriesSortOrder === 'desc' ? '↓' : '↑') : ''}
          </th>
          <th style="padding:10px 12px;text-align:center;font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-muted);">Hits</th>
        </tr>
      </thead>
      <tbody>
        {#if loading}
          {#each Array(5) as _}
            <tr>
              <td colspan="6" style="padding:10px 12px;">
                <div class="skeleton" style="height:20px;border-radius:6px;"></div>
              </td>
            </tr>
          {/each}
        {:else if $memories.length === 0}
          <tr>
            <td colspan="6" style="padding:40px;text-align:center;color:var(--color-text-muted);">
              <div style="font-size:2rem;margin-bottom:8px;">🔍</div>
              No memories found
            </td>
          </tr>
        {:else}
          {#each $memories as mem (mem.id)}
            <tr
              style="border-bottom:1px solid var(--color-border);cursor:pointer;transition:background 0.15s;"
              on:click={() => onMemoryClick(mem)}
              class:selected={$selectedMemoryIds.has(mem.id)}
            >
              <td style="padding:10px 12px;" on:click|stopPropagation>
                <input type="checkbox" checked={$selectedMemoryIds.has(mem.id)} on:change={() => toggleSelect(mem.id)} />
              </td>
              <td style="padding:10px 12px;max-width:300px;">
                <div class="truncate font-semibold" style="font-size:0.82rem;color:var(--color-text);">{mem.title}</div>
                {#if mem.tags?.length}
                  <div style="margin-top:3px;display:flex;gap:4px;flex-wrap:wrap;">
                    {#each mem.tags.slice(0, 3) as tag}
                      <span style="font-size:0.6rem;background:rgba(99,102,241,0.1);color:#6366f1;padding:1px 5px;border-radius:9999px;">{tag}</span>
                    {/each}
                  </div>
                {/if}
              </td>
              <td style="padding:10px 12px;">
                <span class="type-chip type-{mem.type}">{TYPE_LABELS[mem.type] || mem.type}</span>
              </td>
              <td style="padding:10px 12px;text-align:center;">
                <span style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:8px;font-size:0.75rem;font-weight:700;background:{importanceBg[mem.importance] || importanceBg[1]};color:{importanceColor[mem.importance] || importanceColor[1]};">
                  {mem.importance}
                </span>
              </td>
              <td style="padding:10px 12px;font-size:0.75rem;color:var(--color-text-muted);white-space:nowrap;">{formatDate(mem.updated_at)}</td>
              <td style="padding:10px 12px;text-align:center;font-size:0.75rem;font-weight:600;color:var(--color-text-muted);">{mem.hit_count ?? 0}</td>
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>

  <!-- Pagination -->
  {#if $memoriesTotalPages > 1}
    <div class="flex items-center justify-between mt-3">
      <span style="font-size:0.75rem;color:var(--color-text-muted);">
        Page {$memoriesPage} of {$memoriesTotalPages}
      </span>
      <div class="flex gap-1">
        <button class="btn btn-ghost btn-sm" on:click={() => goToPage(1)} disabled={$memoriesPage <= 1}>«</button>
        <button class="btn btn-ghost btn-sm" on:click={() => goToPage($memoriesPage - 1)} disabled={$memoriesPage <= 1}>‹</button>
        {#each Array.from({length: Math.min(5, $memoriesTotalPages)}, (_, i) => {
          const start = Math.max(1, Math.min($memoriesPage - 2, $memoriesTotalPages - 4));
          return start + i;
        }) as p}
          <button
            class="btn btn-sm"
            class:btn-primary={p === $memoriesPage}
            class:btn-ghost={p !== $memoriesPage}
            on:click={() => goToPage(p)}
          >{p}</button>
        {/each}
        <button class="btn btn-ghost btn-sm" on:click={() => goToPage($memoriesPage + 1)} disabled={$memoriesPage >= $memoriesTotalPages}>›</button>
        <button class="btn btn-ghost btn-sm" on:click={() => goToPage($memoriesTotalPages)} disabled={$memoriesPage >= $memoriesTotalPages}>»</button>
      </div>
    </div>
  {/if}
</div>

<style>
  tr:hover { background: rgba(241,245,249,0.5); }
  :global(.dark) tr:hover { background: rgba(30,41,59,0.4); }
  tr.selected { background: rgba(14,165,233,0.05); }
</style>
