<script lang="ts">
  import { recentActions, recentActionsPage, recentActionsPageSize, recentActionsTotalItems } from '../lib/stores';
  import { formatDate, renderMarkdown } from '../lib/utils';
  import type { RecentAction } from '../lib/stores';

  export let onLoadPage: (page: number) => void = () => {};

  const actionGradients: Record<string, string> = {
    search: 'from-blue-500 to-blue-600',
    read: 'from-emerald-500 to-emerald-600',
    write: 'from-indigo-500 to-indigo-600',
    update: 'from-amber-500 to-amber-600',
    delete: 'from-rose-500 to-rose-600',
  };

  const gradientMap: Record<string, string> = {
    search: 'linear-gradient(135deg,#3b82f6,#2563eb)',
    read: 'linear-gradient(135deg,#10b981,#059669)',
    write: 'linear-gradient(135deg,#6366f1,#4f46e5)',
    update: 'linear-gradient(135deg,#f59e0b,#d97706)',
    delete: 'linear-gradient(135deg,#ef4444,#dc2626)',
  };

  function getGradient(action: string): string {
    return gradientMap[action] || gradientMap.search;
  }

  function getLabel(a: RecentAction): { main: string; sub: string } {
    if (a.action === 'search') {
      return {
        main: `"${a.query || ''}"`,
        sub: a.result_count != null ? `${a.result_count} result${a.result_count !== 1 ? 's' : ''} found` : '',
      };
    }
    if (a.task_id) {
      const verb: Record<string, string> = { write: '💾 Created Task', update: '🔄 Updated Task', delete: '🗑️ Deleted Task' };
      return {
        main: a.task_title || a.task_code || a.task_id.substring(0, 8),
        sub: a.task_code ? `${verb[a.action] || a.action} [${a.task_code}]` : (verb[a.action] || a.action),
      };
    }
    const verbs: Record<string, string> = {
      write: '💾 Stored', update: '🔄 Updated', delete: '🗑️ Deleted', read: '📖 Read',
      agent_handoff: '🤝 Handoff', agent_registered: '📝 Registration',
    };
    const verb = verbs[a.action] || a.action;
    const typeLabel = a.memory_type ? `[${a.memory_type}]` : '';
    return {
      main: a.memory_title || (a.memory_id ? a.memory_id.substring(0, 8) + '…' : '—'),
      sub: [verb, typeLabel].filter(Boolean).join(' '),
    };
  }

  function parseResponse(response: string | undefined): string {
    if (!response) return '';
    try {
      const r = typeof response === 'string' ? JSON.parse(response) : response;
      if (r.content && Array.isArray(r.content)) {
        return r.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
      }
      if (r.message) return r.message;
      return JSON.stringify(r, null, 2);
    } catch { return response; }
  }

  $: totalPages = Math.max(1, Math.ceil($recentActionsTotalItems / $recentActionsPageSize));
</script>

<div style="display:flex;flex-direction:column;gap:12px;">
  {#if $recentActions.length === 0}
    <div style="text-align:center;padding:24px;color:var(--color-text-muted);font-size:0.82rem;">
      No recent actions
    </div>
  {:else}
    {#each $recentActions as action (action.id)}
      {@const label = getLabel(action)}
      {#if action.response}
        <!-- Chat pair layout -->
        <div style="display:flex;flex-direction:column;gap:6px;">
          <!-- Agent bubble (right-aligned) -->
          <div style="display:flex;flex-direction:column;align-items:flex-end;">
            <div class="chat-bubble chat-bubble-agent" style="background:{getGradient(action.action)};">
              <div style="font-size:0.7rem;font-weight:700;opacity:0.8;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">{action.action}</div>
              <div style="font-size:0.82rem;font-weight:500;">{label.main}</div>
              {#if label.sub}<div style="font-size:0.65rem;opacity:0.75;margin-top:2px;">{label.sub}</div>{/if}
              {#if action.burstCount && action.burstCount > 1}
                <div style="font-size:0.6rem;margin-top:4px;opacity:0.7;">×{action.burstCount}</div>
              {/if}
            </div>
            <span style="font-size:0.65rem;color:var(--color-text-muted);margin-top:2px;padding-right:4px;">{formatDate(action.created_at)}</span>
          </div>
          <!-- MCP reply bubble (left-aligned) -->
          <div style="display:flex;flex-direction:column;align-items:flex-start;">
            <div class="chat-bubble chat-bubble-mcp">
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;opacity:0.6;">
                <div style="width:7px;height:7px;border-radius:9999px;background:#0ea5e9;"></div>
                <span style="font-size:0.6rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">MCP Reply</span>
              </div>
              <div class="markdown-body" style="font-size:0.78rem;">
                {@html renderMarkdown(parseResponse(action.response))}
              </div>
            </div>
          </div>
        </div>
      {:else}
        <!-- Single bubble -->
        <div style="display:flex;flex-direction:column;align-items:flex-end;">
          <div class="chat-bubble chat-bubble-agent" style="background:{getGradient(action.action)};">
            <div style="font-size:0.7rem;font-weight:700;opacity:0.8;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">{action.action}</div>
            <div style="font-size:0.82rem;font-weight:500;">{label.main}</div>
            {#if label.sub}<div style="font-size:0.65rem;opacity:0.75;margin-top:2px;">{label.sub}</div>{/if}
            {#if action.burstCount && action.burstCount > 1}
              <div style="font-size:0.6rem;margin-top:4px;opacity:0.7;">×{action.burstCount}</div>
            {/if}
          </div>
          <span style="font-size:0.65rem;color:var(--color-text-muted);margin-top:2px;">{formatDate(action.created_at)}</span>
        </div>
      {/if}
    {/each}
  {/if}

  <!-- Pagination -->
  {#if totalPages > 1}
    <div class="flex items-center justify-between" style="border-top:1px solid var(--color-border);padding-top:8px;margin-top:4px;">
      <span style="font-size:0.7rem;color:var(--color-text-muted);">{$recentActionsPage} / {totalPages}</span>
      <div class="flex gap-1">
        <button class="btn btn-ghost btn-sm" on:click={() => onLoadPage($recentActionsPage - 1)} disabled={$recentActionsPage <= 1}>←</button>
        <button class="btn btn-ghost btn-sm" on:click={() => onLoadPage($recentActionsPage + 1)} disabled={$recentActionsPage >= totalPages}>→</button>
      </div>
    </div>
  {/if}
</div>
