<script lang="ts">
  import {
    availableRepos, currentRepo, isRepoSidebarCollapsed, orderedRepos, repoSearchQuery
  } from '../lib/stores';
  import { createRepoSidebarHandler } from '../lib/composables/useRepoSidebar';
  import Icon from '../lib/Icon.svelte';

  export let onRepoSelect: (repo: string) => void = () => {};

  const handler = createRepoSidebarHandler(onRepoSelect);

  $: collapsed = $isRepoSidebarCollapsed;
</script>

<aside
  class="sidebar glass-strong flex flex-col"
  class:collapsed
  style="border-right: 1px solid var(--color-border);"
>
  <!-- Header -->
  <div class="sidebar-header" style="border-bottom: 1px solid var(--color-border);">
    {#if !collapsed}
      <div class="flex items-center gap-2">
        <div class="brand-icon">
          <Icon name="brain" size={14} strokeWidth={1.75} />
        </div>
        <div>
          <div class="font-bold text-sm" style="color:var(--color-text);letter-spacing:-0.02em;">Memory MCP</div>
          <div class="section-label" style="font-size:0.6rem;margin-top:0;">Dashboard</div>
        </div>
      </div>
    {:else}
      <div class="brand-icon" style="margin:auto;">
        <Icon name="brain" size={14} strokeWidth={1.75} />
      </div>
    {/if}

    <button
      class="btn btn-ghost btn-icon btn-sm collapse-btn"
      on:click={handler.toggleCollapse}
      title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      aria-label={collapsed ? 'Expand' : 'Collapse'}
    >
      <span style="transition: transform 0.3s ease; display:inline-flex; transform: rotate({collapsed ? '180deg' : '0deg'})">
        <Icon name="chevron-left" size={14} strokeWidth={2} />
      </span>
    </button>
  </div>

  <!-- Search -->
  {#if !collapsed}
    <div class="p-3" style="border-bottom: 1px solid var(--color-border);">
      <div class="search-wrapper">
        <span class="search-icon">
          <Icon name="search" size={13} strokeWidth={2} />
        </span>
        <input
          class="form-input search-input"
          type="text"
          placeholder="Search repos…"
          bind:value={$repoSearchQuery}
        />
      </div>
    </div>
  {/if}

  <!-- Repo List -->
  <div class="overflow-y-auto flex-1 p-2" style="scrollbar-width: thin;">
    {#if !collapsed}
      <!-- Count badge -->
      <div class="flex items-center justify-between px-2 py-1 mb-1">
        <span class="section-label">Repositories</span>
        <span class="repo-count-chip">{$availableRepos.length}</span>
      </div>

      <!-- Pinned -->
      {#if $orderedRepos.pinned.length > 0}
        <div class="group-label">
          <Icon name="star" size={10} strokeWidth={2} />
          Pinned
        </div>
        {#each $orderedRepos.pinned as item}
          <div
            class="repo-item"
            class:active={$currentRepo === item.repo}
            role="button"
            tabindex="0"
            draggable="true"
            on:click={() => handler.selectRepo(item.repo)}
            on:keydown={e => (e.key === 'Enter' || e.key === ' ') && handler.selectRepo(item.repo)}
            on:dragstart={e => handler.onDragStart(item.repo, e)}
            on:dragover={e => handler.onDragOver(item.repo, e)}
            on:drop={e => handler.onDrop(item.repo, e)}
            on:dragend={handler.onDragEnd}
            title="{item.repo} • {item.memory_count} memories"
          >
            {#if $currentRepo === item.repo}
              <div class="repo-active-indicator"></div>
            {/if}
            <div class="repo-avatar">
              {handler.getRepoInitials(item.repo)}
              <span class="pin-star">★</span>
            </div>
            <div class="min-w-0 flex-1">
              <div class="truncate font-semibold" style="font-size:0.82rem;color:var(--color-text);">{item.repo}</div>
              <div class="truncate flex items-center gap-1" style="font-size:0.68rem;color:var(--color-text-muted);margin-bottom:2px;">
                <Icon name="database" size={9} strokeWidth={2} />
                {item.memory_count} memories
              </div>
              {#if (item.in_progress_count || 0) + (item.pending_count || 0) + (item.blocked_count || 0) + (item.backlog_count || 0) > 0}
                <div class="task-badges">
                  {#if item.in_progress_count}
                    <span class="task-badge active"><Icon name="zap" size={8} strokeWidth={2} /> {item.in_progress_count}</span>
                  {/if}
                  {#if item.pending_count}
                    <span class="task-badge todo"><Icon name="circle-dot" size={8} strokeWidth={2} /> {item.pending_count}</span>
                  {/if}
                  {#if item.blocked_count}
                    <span class="task-badge blocked"><Icon name="triangle-alert" size={8} strokeWidth={2} /> {item.blocked_count}</span>
                  {/if}
                  {#if item.backlog_count}
                    <span class="task-badge backlog"><Icon name="archive" size={8} strokeWidth={2} /> {item.backlog_count}</span>
                  {/if}
                </div>
              {/if}
            </div>
            <button
              class="pin-btn"
              on:click={e => handler.togglePin(item.repo, e)}
              title="Unpin"
              aria-label="Unpin repository"
            >
              <Icon name="pin" size={12} strokeWidth={1.75} />
            </button>
          </div>
        {/each}
      {/if}

      <!-- Unpinned -->
      {#if $orderedRepos.unpinned.length > 0}
        {#if $orderedRepos.pinned.length > 0}
          <div class="group-label" style="margin-top:6px;">
            <Icon name="layers" size={10} strokeWidth={2} />
            All
          </div>
        {/if}
        {#each $orderedRepos.unpinned as item}
          <div
            class="repo-item"
            class:active={$currentRepo === item.repo}
            role="button"
            tabindex="0"
            on:click={() => handler.selectRepo(item.repo)}
            on:keydown={e => (e.key === 'Enter' || e.key === ' ') && handler.selectRepo(item.repo)}
            title="{item.repo} • {item.memory_count} memories"
          >
            {#if $currentRepo === item.repo}
              <div class="repo-active-indicator"></div>
            {/if}
            <div class="repo-avatar">{handler.getRepoInitials(item.repo)}</div>
            <div class="min-w-0 flex-1">
              <div class="truncate font-semibold" style="font-size:0.82rem;color:var(--color-text);">{item.repo}</div>
              <div class="truncate flex items-center gap-1" style="font-size:0.68rem;color:var(--color-text-muted);margin-bottom:2px;">
                <Icon name="database" size={9} strokeWidth={2} />
                {item.memory_count} memories
              </div>
              {#if (item.in_progress_count || 0) + (item.pending_count || 0) + (item.blocked_count || 0) + (item.backlog_count || 0) > 0}
                <div class="task-badges">
                  {#if item.in_progress_count}
                    <span class="task-badge active"><Icon name="zap" size={8} strokeWidth={2} /> {item.in_progress_count}</span>
                  {/if}
                  {#if item.pending_count}
                    <span class="task-badge todo"><Icon name="circle-dot" size={8} strokeWidth={2} /> {item.pending_count}</span>
                  {/if}
                  {#if item.blocked_count}
                    <span class="task-badge blocked"><Icon name="triangle-alert" size={8} strokeWidth={2} /> {item.blocked_count}</span>
                  {/if}
                  {#if item.backlog_count}
                    <span class="task-badge backlog"><Icon name="archive" size={8} strokeWidth={2} /> {item.backlog_count}</span>
                  {/if}
                </div>
              {/if}
            </div>
            <button
              class="pin-btn"
              on:click={e => handler.togglePin(item.repo, e)}
              title="Pin"
              aria-label="Pin repository"
            >
              <Icon name="pin" size={12} strokeWidth={1.75} />
            </button>
          </div>
        {/each}
      {/if}

      {#if $availableRepos.length === 0}
        <div style="text-align:center;padding:24px 16px;color:var(--color-text-muted);">
          <Icon name="inbox" size={24} strokeWidth={1.5} />
          <div style="font-size:0.82rem;margin-top:8px;">No repositories found</div>
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
          on:click={() => handler.selectRepo(item.repo)}
          on:keydown={e => (e.key === 'Enter' || e.key === ' ') && handler.selectRepo(item.repo)}
          title={item.repo}
        >
          {#if $currentRepo === item.repo}
            <div class="repo-active-indicator"></div>
          {/if}
          <div class="repo-avatar" style="margin:auto;">{handler.getRepoInitials(item.repo)}</div>
        </div>
      {/each}
    {/if}
  </div>
</aside>

<style>
  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    min-height: 60px;
  }

  .brand-icon {
    width: 30px;
    height: 30px;
    border-radius: 9px;
    background: linear-gradient(135deg, #0ea5e9, #6366f1);
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    flex-shrink: 0;
    box-shadow: 0 4px 12px rgba(14, 165, 233, 0.3);
    transition: box-shadow 0.2s ease, transform 0.2s ease;
  }

  .brand-icon:hover {
    box-shadow: 0 4px 18px rgba(14, 165, 233, 0.5);
    transform: scale(1.05);
  }

  .collapse-btn {
    flex-shrink: 0;
  }

  .search-wrapper {
    position: relative;
  }

  .search-icon {
    position: absolute;
    left: 10px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--color-text-muted);
    display: flex;
    pointer-events: none;
  }

  .search-input {
    padding-left: 32px;
    font-size: 0.8rem;
    background: rgba(255, 255, 255, 0.5);
  }

  :global(html.dark) .search-input {
    background: rgba(10, 18, 38, 0.5);
  }

  .group-label {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 0.6rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--color-text-muted);
    padding: 6px 10px 4px;
    opacity: 0.75;
  }

  .repo-count-chip {
    font-size: 0.62rem;
    font-weight: 700;
    background: rgba(14, 165, 233, 0.12);
    color: #0ea5e9;
    padding: 1px 7px;
    border-radius: 9999px;
    border: 1px solid rgba(14, 165, 233, 0.22);
  }

  .pin-star {
    position: absolute;
    top: -4px;
    right: -4px;
    font-size: 8px;
    background: #0ea5e9;
    border-radius: 9999px;
    width: 14px;
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    line-height: 1;
    box-shadow: 0 2px 6px rgba(14, 165, 233, 0.4);
  }

  .task-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    margin-top: 4px;
  }

  .task-badge {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    font-size: 0.6rem;
    font-weight: 700;
    padding: 1px 5px;
    border-radius: 9999px;
    white-space: nowrap;
    border: 1px solid transparent;
    transition: all 0.15s ease;
  }

  .task-badge.active {
    background: rgba(168, 85, 247, 0.12);
    color: #a855f7;
    border-color: rgba(168, 85, 247, 0.25);
  }

  .task-badge.todo {
    background: rgba(14, 165, 233, 0.12);
    color: #0ea5e9;
    border-color: rgba(14, 165, 233, 0.25);
  }

  .task-badge.blocked {
    background: rgba(239, 68, 68, 0.12);
    color: #ef4444;
    border-color: rgba(239, 68, 68, 0.25);
  }

  .task-badge.backlog {
    background: rgba(100, 116, 139, 0.12);
    color: #64748b;
    border-color: rgba(100, 116, 139, 0.25);
  }

  :global(html.dark) .task-badge.active { background: rgba(168, 85, 247, 0.18); color: #c084fc; }
  :global(html.dark) .task-badge.todo { background: rgba(56, 189, 248, 0.18); color: #7dd3fc; }
  :global(html.dark) .task-badge.blocked { background: rgba(252, 165, 165, 0.18); color: #fca5a5; }
  :global(html.dark) .task-badge.backlog { background: rgba(148, 163, 184, 0.18); color: #94a3b8; }

  .pin-btn {
    opacity: 0;
    transition: opacity 0.15s ease, transform 0.15s ease, color 0.15s ease;
    color: var(--color-text-muted);
    padding: 5px;
    flex-shrink: 0;
    background: transparent;
    border: none;
    cursor: pointer;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .repo-item:hover .pin-btn {
    opacity: 1;
  }

  .pin-btn:hover {
    color: #0ea5e9;
    transform: scale(1.15);
    background: rgba(14, 165, 233, 0.1);
  }
</style>
