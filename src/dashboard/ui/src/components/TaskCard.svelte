<script lang="ts">
  import type { Task } from '../lib/stores';
  import { formatDate } from '../lib/utils';
  import Icon from '../lib/Icon.svelte';

  export let task: Task;
  export let onClick: () => void = () => {};

  const priorityColors: Record<number, string> = {
    1: '#94a3b8', 2: '#3b82f6', 3: '#f59e0b', 4: '#f97316', 5: '#ef4444'
  };

  const statusIconMap: Record<string, string> = {
    'backlog': 'archive',
    'pending': 'circle-dot',
    'in_progress': 'zap',
    'completed': 'circle-check',
    'blocked': 'circle-x',
    'canceled': 'circle-pause-alt',
  };

  $: priorityColor = priorityColors[task.priority] || '#94a3b8';
  $: statusIcon = statusIconMap[task.status] || 'circle-dot';
</script>

<div
  class="task-card animate-fade-in"
  role="button"
  tabindex="0"
  on:click={onClick}
  on:keydown={e => e.key === 'Enter' && onClick()}
>
  <!-- Priority indicator bar -->
  <div class="priority-bar" style="background:{priorityColor};"></div>

  <!-- Header: priority dot + code + phase -->
  <div class="flex items-center justify-between mb-2">
    <div class="flex items-center gap-2">
      <div class="priority-dot" style="background:{priorityColor};{task.priority >= 4 ? 'box-shadow: 0 0 6px ' + priorityColor + '88;' : ''}"></div>
      <span style="font-size:0.65rem;font-weight:700;color:var(--color-text-muted);font-family:'JetBrains Mono',monospace;">{task.task_code}</span>
    </div>
    {#if task.phase}
      <span class="phase-chip">{task.phase}</span>
    {/if}
  </div>

  <!-- Title -->
  <div class="task-title">{task.title}</div>

  <!-- Description preview -->
  {#if task.description}
    <div class="task-desc">
      {task.description.replace(/[#*`\[\]]/g, '').substring(0, 100)}…
    </div>
  {/if}

  <!-- Footer: agent + time -->
  <div class="flex items-center justify-between" style="margin-top:8px;">
    {#if task.agent}
      <div class="flex items-center gap-1">
        <div class="agent-avatar">
          <Icon name="bot" size={9} strokeWidth={2} />
        </div>
        <span class="agent-name">{task.agent}</span>
      </div>
    {:else}
      <span></span>
    {/if}
    <div class="flex items-center gap-1" style="color:var(--color-text-faint);">
      <Icon name="clock" size={10} strokeWidth={2} />
      <span style="font-size:0.62rem;">{formatDate(task.updated_at)}</span>
    </div>
  </div>

  <!-- Token badge -->
  {#if task.est_tokens && task.est_tokens > 0}
    <div style="margin-top:6px;">
      <span class="token-badge">
        <Icon name="cpu" size={9} strokeWidth={2} />
        ~{task.est_tokens >= 1000 ? (task.est_tokens/1000).toFixed(1)+'k' : task.est_tokens} tokens
      </span>
    </div>
  {/if}
</div>

<style>
  .priority-bar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    border-radius: 12px 12px 0 0;
    opacity: 0;
    transition: opacity 0.2s ease;
  }

  .task-card:hover .priority-bar {
    opacity: 1;
  }

  .task-title {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--color-text);
    margin-bottom: 6px;
    line-height: 1.35;
    letter-spacing: -0.01em;
  }

  .task-desc {
    font-size: 0.72rem;
    color: var(--color-text-muted);
    line-height: 1.55;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    margin-bottom: 4px;
  }

  .phase-chip {
    font-size: 0.6rem;
    background: rgba(99, 102, 241, 0.1);
    color: #6366f1;
    padding: 2px 7px;
    border-radius: 9999px;
    font-weight: 700;
    border: 1px solid rgba(99, 102, 241, 0.2);
    letter-spacing: 0.02em;
  }

  :global(html.dark) .phase-chip {
    background: rgba(129, 140, 248, 0.15);
    color: #a5b4fc;
    border-color: rgba(129, 140, 248, 0.25);
  }

  .agent-avatar {
    width: 18px;
    height: 18px;
    border-radius: 9999px;
    background: linear-gradient(135deg, #6366f1, #0ea5e9);
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    flex-shrink: 0;
  }

  .agent-name {
    font-size: 0.65rem;
    color: var(--color-text-muted);
    max-width: 90px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .token-badge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 0.6rem;
    background: rgba(56, 189, 248, 0.1);
    color: #0ea5e9;
    border: 1px solid rgba(56, 189, 248, 0.2);
    padding: 2px 7px;
    border-radius: 9999px;
    font-weight: 600;
  }

  :global(html.dark) .token-badge {
    background: rgba(56, 189, 248, 0.12);
    color: #7dd3fc;
    border-color: rgba(56, 189, 248, 0.22);
  }
</style>
