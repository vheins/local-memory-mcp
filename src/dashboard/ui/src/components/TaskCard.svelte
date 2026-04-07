<script lang="ts">
  import type { Task } from '../lib/stores';
  import { getStatusColor, getStatusLabel, getPriorityColor, getPriorityLabel, formatDate } from '../lib/utils';

  export let task: Task;
  export let onClick: () => void = () => {};

  const priorityDots: Record<number, string> = {
    1: '#94a3b8', 2: '#3b82f6', 3: '#f59e0b', 4: '#f97316', 5: '#ef4444'
  };
</script>

<div
  class="task-card animate-fade-in"
  role="button"
  tabindex="0"
  on:click={onClick}
  on:keydown={e => e.key === 'Enter' && onClick()}
>
  <!-- Priority + code -->
  <div class="flex items-center justify-between mb-2">
    <div class="flex items-center gap-2">
      <div style="width:8px;height:8px;border-radius:9999px;background:{priorityDots[task.priority] || '#94a3b8'};flex-shrink:0;"></div>
      <span style="font-size:0.65rem;font-weight:700;color:var(--color-text-muted);">{task.task_code}</span>
    </div>
    {#if task.phase}
      <span style="font-size:0.6rem;background:rgba(99,102,241,0.1);color:#6366f1;padding:1px 6px;border-radius:9999px;font-weight:600;">
        {task.phase}
      </span>
    {/if}
  </div>

  <!-- Title -->
  <div style="font-size:0.82rem;font-weight:600;color:var(--color-text);margin-bottom:8px;line-height:1.3;">
    {task.title}
  </div>

  <!-- Description preview -->
  {#if task.description}
    <div style="font-size:0.72rem;color:var(--color-text-muted);line-height:1.5;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;margin-bottom:8px;">
      {task.description.replace(/[#*`\[\]]/g, '').substring(0, 100)}...
    </div>
  {/if}

  <!-- Footer: agent + time -->
  <div class="flex items-center justify-between" style="margin-top:6px;">
    {#if task.agent}
      <div class="flex items-center gap-1">
        <div style="width:18px;height:18px;border-radius:9999px;background:linear-gradient(135deg,#6366f1,#0ea5e9);display:flex;align-items:center;justify-content:center;font-size:9px;color:white;font-weight:700;">
          {task.agent.charAt(0).toUpperCase()}
        </div>
        <span style="font-size:0.65rem;color:var(--color-text-muted);max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{task.agent}</span>
      </div>
    {:else}
      <span></span>
    {/if}
    <span style="font-size:0.65rem;color:var(--color-text-muted);">{formatDate(task.updated_at)}</span>
  </div>

  <!-- Token badge -->
  {#if task.est_tokens && task.est_tokens > 0}
    <div style="margin-top:6px;">
      <span style="font-size:0.6rem;background:rgba(56,189,248,0.1);color:#0ea5e9;border:1px solid rgba(56,189,248,0.2);padding:1px 6px;border-radius:9999px;font-weight:600;">
        ~{task.est_tokens >= 1000 ? (task.est_tokens/1000).toFixed(1)+'k' : task.est_tokens} tokens
      </span>
    </div>
  {/if}
</div>
