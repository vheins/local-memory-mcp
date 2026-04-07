<script lang="ts">
  import { get } from 'svelte/store';
  import {
    availableRepos, currentRepo, pinnedRepos, repoSearchQuery,
    isRepoSidebarCollapsed, orderedRepos, theme
  } from '../lib/stores';
  import { getRepoInitials, formatDate } from '../lib/utils';
  import { api } from '../lib/api';

  export let onRepoSelect: (repo: string) => void = () => {};

  let draggedRepo: string | null = null;

  function selectRepo(repo: string) {
    currentRepo.set(repo);
    localStorage.setItem('selectedRepo', repo);
    onRepoSelect(repo);
  }

  function togglePin(repo: string, e: Event) {
    e.preventDefault();
    e.stopPropagation();
    pinnedRepos.update(pinned => {
      if (pinned.includes(repo)) return pinned.filter(p => p !== repo);
      return [...pinned, repo];
    });
  }

  function toggleCollapse() {
    isRepoSidebarCollapsed.update(v => !v);
  }

  function onDragStart(repo: string, e: DragEvent) {
    draggedRepo = repo;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', repo);
    }
    (e.currentTarget as HTMLElement).classList.add('opacity-50');
  }

  function onDragOver(target: string, e: DragEvent) {
    if (!draggedRepo || draggedRepo === target) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  }

  function onDrop(target: string, e: DragEvent) {
    e.preventDefault();
    const dragged = draggedRepo || e.dataTransfer?.getData('text/plain');
    if (!dragged || dragged === target) return;
    pinnedRepos.update(pinned => {
      const next = pinned.filter(p => p !== dragged);
      const idx = next.indexOf(target);
      next.splice(idx, 0, dragged);
      return next;
    });
    draggedRepo = null;
  }

  function onDragEnd(e: DragEvent) {
    draggedRepo = null;
    (e.currentTarget as HTMLElement).classList.remove('opacity-50');
    document.querySelectorAll('.repo-item.drag-over').forEach(el => el.classList.remove('drag-over'));
  }

  $: collapsed = $isRepoSidebarCollapsed;
</script>

<aside
  class="sidebar glass-strong flex flex-col"
  class:collapsed
  style="border-right: 1px solid var(--color-border);"
>
  <!-- Header -->
  <div class="flex items-center justify-between p-4" style="border-bottom: 1px solid var(--color-border); min-height: 60px;">
    {#if !collapsed}
      <div class="flex items-center gap-2">
        <div style="width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#0ea5e9,#6366f1);display:flex;align-items:center;justify-content:center;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z"/></svg>
        </div>
        <div>
          <div class="font-bold text-sm" style="color:var(--color-text)">Memory MCP</div>
          <div style="font-size:0.65rem;color:var(--color-text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Dashboard</div>
        </div>
      </div>
    {:else}
      <div style="width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#0ea5e9,#6366f1);display:flex;align-items:center;justify-content:center;margin:auto;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z"/></svg>
      </div>
    {/if}

    <button
      class="btn btn-ghost btn-icon btn-sm"
      on:click={toggleCollapse}
      title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      aria-label={collapsed ? 'Expand' : 'Collapse'}
      style="flex-shrink:0;"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"
        style="transition: transform 0.3s; transform: rotate({collapsed ? '180deg' : '0deg'})">
        <path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6z"/>
      </svg>
    </button>
  </div>

  <!-- Search -->
  {#if !collapsed}
    <div class="p-3" style="border-bottom: 1px solid var(--color-border);">
      <div style="position:relative;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--color-text-muted);">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input
          class="form-input"
          type="text"
          placeholder="Search repos..."
          bind:value={$repoSearchQuery}
          style="padding-left: 32px; font-size: 0.8rem;"
        />
      </div>
    </div>
  {/if}

  <!-- Repo List -->
  <div class="overflow-y-auto flex-1 p-2" style="scrollbar-width: thin;">
    {#if !collapsed}
      <!-- Count badge -->
      <div class="flex items-center justify-between px-2 py-1 mb-1">
        <span style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-muted);">
          Repositories
        </span>
        <span style="font-size:0.65rem;font-weight:700;background:rgba(14,165,233,0.12);color:#0ea5e9;padding:1px 6px;border-radius:9999px;">
          {$availableRepos.length}
        </span>
      </div>

      <!-- Pinned -->
      {#if $orderedRepos.pinned.length > 0}
        <div style="font-size:0.6rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--color-text-muted);padding:6px 10px 4px;">Pinned</div>
        {#each $orderedRepos.pinned as item}
          <div
            class="repo-item"
            class:active={$currentRepo === item.repo}
            role="button"
            tabindex="0"
            draggable="true"
            on:click={() => selectRepo(item.repo)}
            on:keydown={e => (e.key === 'Enter' || e.key === ' ') && selectRepo(item.repo)}
            on:dragstart={e => onDragStart(item.repo, e)}
            on:dragover={e => onDragOver(item.repo, e)}
            on:drop={e => onDrop(item.repo, e)}
            on:dragend={onDragEnd}
            title="{item.repo} • {item.memory_count} memories"
          >
            {#if $currentRepo === item.repo}
              <div class="repo-active-indicator"></div>
            {/if}
            <div class="repo-avatar">
              {getRepoInitials(item.repo)}
              <span style="position:absolute;top:-4px;right:-4px;font-size:8px;background:#0ea5e9;border-radius:9999px;width:14px;height:14px;display:flex;align-items:center;justify-content:center;">★</span>
            </div>
            <div class="min-w-0 flex-1">
              <div class="truncate font-semibold" style="font-size:0.82rem;color:var(--color-text);">{item.repo}</div>
              <div class="truncate" style="font-size:0.7rem;color:var(--color-text-muted);margin-bottom:2px;">
                {item.memory_count} memories
              </div>
              {#if (item.in_progress_count || 0) + (item.pending_count || 0) + (item.blocked_count || 0) + (item.backlog_count || 0) > 0}
                <div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:3px;">
                  {#if item.in_progress_count}
                    <span style="font-size:0.6rem;font-weight:700;background:rgba(168,85,247,0.12);color:#a855f7;border:1px solid rgba(168,85,247,0.25);padding:1px 5px;border-radius:9999px;white-space:nowrap;">▶ {item.in_progress_count} active</span>
                  {/if}
                  {#if item.pending_count}
                    <span style="font-size:0.6rem;font-weight:700;background:rgba(14,165,233,0.12);color:#0ea5e9;border:1px solid rgba(14,165,233,0.25);padding:1px 5px;border-radius:9999px;white-space:nowrap;">● {item.pending_count} todo</span>
                  {/if}
                  {#if item.blocked_count}
                    <span style="font-size:0.6rem;font-weight:700;background:rgba(239,68,68,0.12);color:#ef4444;border:1px solid rgba(239,68,68,0.25);padding:1px 5px;border-radius:9999px;white-space:nowrap;">⚠ {item.blocked_count} blocked</span>
                  {/if}
                  {#if item.backlog_count}
                    <span style="font-size:0.6rem;font-weight:700;background:rgba(100,116,139,0.12);color:#64748b;border:1px solid rgba(100,116,139,0.25);padding:1px 5px;border-radius:9999px;white-space:nowrap;">☕ {item.backlog_count} backlog</span>
                  {/if}
                </div>
              {/if}
            </div>
            <button
              class="btn-ghost btn-icon btn-sm"
              on:click={e => togglePin(item.repo, e)}
              title="Unpin"
              style="color:#0ea5e9;padding:4px;flex-shrink:0;"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12.586 2.586a2 2 0 0 1 2.828 0l2 2a2 2 0 0 1 0 2.828l-1.793 1.793-.914 4.57a1 1 0 0 1-.271.51l-1.414 1.414a1 1 0 0 1-1.414 0l-2.122-2.121-4.172 4.171a1 1 0 1 1-1.414-1.414l4.171-4.172-2.12-2.12a1 1 0 0 1 0-1.415l1.413-1.414a1 1 0 0 1 .51-.27l4.57-.915 1.792-1.793Z"/>
              </svg>
            </button>
          </div>
        {/each}
      {/if}

      <!-- Unpinned -->
      {#if $orderedRepos.unpinned.length > 0}
        {#if $orderedRepos.pinned.length > 0}
          <div style="font-size:0.6rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--color-text-muted);padding:8px 10px 4px;">All</div>
        {/if}
        {#each $orderedRepos.unpinned as item}
          <div
            class="repo-item"
            class:active={$currentRepo === item.repo}
            role="button"
            tabindex="0"
            on:click={() => selectRepo(item.repo)}
            on:keydown={e => (e.key === 'Enter' || e.key === ' ') && selectRepo(item.repo)}
            title="{item.repo} • {item.memory_count} memories"
          >
            {#if $currentRepo === item.repo}
              <div class="repo-active-indicator"></div>
            {/if}
            <div class="repo-avatar">{getRepoInitials(item.repo)}</div>
            <div class="min-w-0 flex-1">
              <div class="truncate font-semibold" style="font-size:0.82rem;color:var(--color-text);">{item.repo}</div>
              <div class="truncate" style="font-size:0.7rem;color:var(--color-text-muted);margin-bottom:2px;">
                {item.memory_count} memories
              </div>
              {#if (item.in_progress_count || 0) + (item.pending_count || 0) + (item.blocked_count || 0) + (item.backlog_count || 0) > 0}
                <div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:3px;">
                  {#if item.in_progress_count}
                    <span style="font-size:0.6rem;font-weight:700;background:rgba(168,85,247,0.12);color:#a855f7;border:1px solid rgba(168,85,247,0.25);padding:1px 5px;border-radius:9999px;white-space:nowrap;">▶ {item.in_progress_count} active</span>
                  {/if}
                  {#if item.pending_count}
                    <span style="font-size:0.6rem;font-weight:700;background:rgba(14,165,233,0.12);color:#0ea5e9;border:1px solid rgba(14,165,233,0.25);padding:1px 5px;border-radius:9999px;white-space:nowrap;">● {item.pending_count} todo</span>
                  {/if}
                  {#if item.blocked_count}
                    <span style="font-size:0.6rem;font-weight:700;background:rgba(239,68,68,0.12);color:#ef4444;border:1px solid rgba(239,68,68,0.25);padding:1px 5px;border-radius:9999px;white-space:nowrap;">⚠ {item.blocked_count} blocked</span>
                  {/if}
                  {#if item.backlog_count}
                    <span style="font-size:0.6rem;font-weight:700;background:rgba(100,116,139,0.12);color:#64748b;border:1px solid rgba(100,116,139,0.25);padding:1px 5px;border-radius:9999px;white-space:nowrap;">☕ {item.backlog_count} backlog</span>
                  {/if}
                </div>
              {/if}
            </div>
            <button
              class="pin-btn"
              on:click={e => togglePin(item.repo, e)}
              title="Pin"
              style="opacity:0;transition:opacity 0.2s;color:var(--color-text-muted);padding:4px;flex-shrink:0;background:transparent;border:none;cursor:pointer;"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12.586 2.586a2 2 0 0 1 2.828 0l2 2a2 2 0 0 1 0 2.828l-1.793 1.793-.914 4.57a1 1 0 0 1-.271.51l-1.414 1.414a1 1 0 0 1-1.414 0l-2.122-2.121-4.172 4.171a1 1 0 1 1-1.414-1.414l4.171-4.172-2.12-2.12a1 1 0 0 1 0-1.415l1.413-1.414a1 1 0 0 1 .51-.27l4.57-.915 1.792-1.793Z"/>
              </svg>
            </button>
          </div>
        {/each}
      {/if}

      {#if $availableRepos.length === 0}
        <div style="text-align:center;padding:24px 16px;color:var(--color-text-muted);font-size:0.85rem;">
          No repositories found
        </div>
      {/if}
    {:else}
      <!-- Collapsed: show initials only -->
      {#each $availableRepos as item}
        <div
          class="repo-item collapsed"
          class:active={$currentRepo === item.repo}
          role="button"
          tabindex="0"
          on:click={() => selectRepo(item.repo)}
          on:keydown={e => (e.key === 'Enter' || e.key === ' ') && selectRepo(item.repo)}
          title={item.repo}
        >
          {#if $currentRepo === item.repo}
            <div class="repo-active-indicator"></div>
          {/if}
          <div class="repo-avatar" style="margin:auto;">{getRepoInitials(item.repo)}</div>
        </div>
      {/each}
    {/if}
  </div>
</aside>

<style>
  .repo-item:hover .pin-btn { opacity: 1 !important; }
</style>
