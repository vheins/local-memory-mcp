<script lang="ts">
  import { recentActions, recentActionsPage, recentActionsPageSize, recentActionsTotalItems } from '../lib/stores';
  import { formatDate, renderMarkdown } from '../lib/utils';
  import Icon from '../lib/Icon.svelte';
  import type { RecentAction } from '../lib/stores';

  export let onLoadPage: (page: number) => void = () => {};

  // Action → visual config
  const ACTION_CONFIG: Record<string, { icon: string; label: string; gradient: string; color: string; bgAlpha: string }> = {
    search:           { icon: 'search',        label: 'Search',     gradient: 'linear-gradient(135deg,#3b82f6,#2563eb)', color: '#3b82f6', bgAlpha: 'rgba(59,130,246,0.12)' },
    read:             { icon: 'book-open',      label: 'Read',       gradient: 'linear-gradient(135deg,#10b981,#059669)', color: '#10b981', bgAlpha: 'rgba(16,185,129,0.12)' },
    write:            { icon: 'edit',           label: 'Write',      gradient: 'linear-gradient(135deg,#6366f1,#4f46e5)', color: '#6366f1', bgAlpha: 'rgba(99,102,241,0.12)' },
    update:           { icon: 'refresh-cw',     label: 'Update',     gradient: 'linear-gradient(135deg,#f59e0b,#d97706)', color: '#f59e0b', bgAlpha: 'rgba(245,158,11,0.12)' },
    delete:           { icon: 'trash',          label: 'Delete',     gradient: 'linear-gradient(135deg,#ef4444,#dc2626)', color: '#ef4444', bgAlpha: 'rgba(239,68,68,0.12)'  },
    agent_handoff:    { icon: 'bot',            label: 'Handoff',    gradient: 'linear-gradient(135deg,#0ea5e9,#6366f1)', color: '#0ea5e9', bgAlpha: 'rgba(14,165,233,0.12)' },
    agent_registered: { icon: 'sparkle',        label: 'Registered', gradient: 'linear-gradient(135deg,#a855f7,#6366f1)', color: '#a855f7', bgAlpha: 'rgba(168,85,247,0.12)' },
    list:             { icon: 'list',           label: 'List',       gradient: 'linear-gradient(135deg,#64748b,#475569)', color: '#64748b', bgAlpha: 'rgba(100,116,139,0.12)'},
  };

  function getConfig(action: string) {
    return ACTION_CONFIG[action] ?? { icon: 'activity', label: action, gradient: 'linear-gradient(135deg,#64748b,#475569)', color: '#64748b', bgAlpha: 'rgba(100,116,139,0.12)' };
  }

  function getLabel(a: RecentAction): { main: string; sub: string } {
    if (a.action === 'search') {
      return {
        main: a.query ? `"${a.query}"` : 'Query',
        sub: a.result_count != null ? `${a.result_count} result${a.result_count !== 1 ? 's' : ''} found` : '',
      };
    }
    if (a.task_id) {
      const verb: Record<string, string> = { write: 'Created Task', update: 'Updated Task', delete: 'Deleted Task' };
      return {
        main: a.task_title || a.task_code || a.task_id.substring(0, 8),
        sub: a.task_code ? `${verb[a.action] || a.action} · ${a.task_code}` : (verb[a.action] || a.action),
      };
    }
    const verb: Record<string, string> = {
      write: 'Stored', update: 'Updated', delete: 'Deleted', read: 'Read',
      agent_handoff: 'Handoff', agent_registered: 'Registered',
    };
    const typeLabel = a.memory_type ? `[${a.memory_type}]` : '';
    return {
      main: a.memory_title || (a.memory_id ? a.memory_id.substring(0, 8) + '…' : '—'),
      sub: [verb[a.action] || a.action, typeLabel].filter(Boolean).join(' '),
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
      // Provide summarized JSON for readability
      const keys = Object.keys(r);
      if (keys.length > 4) {
        return `{ ${keys.slice(0, 3).map(k => `${k}: …`).join(', ')}, +${keys.length - 3} more }`;
      }
      return JSON.stringify(r, null, 2);
    } catch { return response; }
  }

  $: totalPages = Math.max(1, Math.ceil($recentActionsTotalItems / $recentActionsPageSize));
</script>

<div style="display:flex;flex-direction:column;gap:10px;">
  {#if $recentActions.length === 0}
    <div style="text-align:center;padding:32px 16px;color:var(--color-text-muted);">
      <Icon name="activity" size={28} strokeWidth={1.25} />
      <div style="font-size:0.82rem;margin-top:10px;">No recent actions</div>
    </div>
  {:else}
    {#each $recentActions as action (action.id)}
      {@const label = getLabel(action)}
      {@const cfg = getConfig(action.action)}
      {#if action.response}
        <!-- Chat pair layout -->
        <div class="action-pair">
          <!-- Agent action bubble (right) -->
          <div class="bubble-row bubble-row-right">
            <div class="chat-bubble chat-bubble-action" style="--action-gradient:{cfg.gradient};--action-color:{cfg.color};--action-bg:{cfg.bgAlpha};">
              <div class="action-header">
                <span class="action-icon-wrap" style="background:{cfg.bgAlpha};color:{cfg.color};">
                  <Icon name={cfg.icon} size={11} strokeWidth={2} />
                </span>
                <span class="action-type-label" style="color:{cfg.color};">{cfg.label}</span>
                {#if action.burstCount && action.burstCount > 1}
                  <span class="burst-badge">×{action.burstCount}</span>
                {/if}
              </div>
              <div class="action-main">{label.main}</div>
              {#if label.sub}<div class="action-sub">{label.sub}</div>{/if}
            </div>
            <span class="bubble-time">{formatDate(action.created_at)}</span>
          </div>
          <!-- MCP reply bubble (left) -->
          <div class="bubble-row bubble-row-left">
            <div class="chat-bubble chat-bubble-mcp">
              <div class="mcp-header">
                <span class="mcp-dot"></span>
                <span class="mcp-label">MCP Reply</span>
              </div>
              <div class="markdown-body" style="font-size:0.78rem;">
                {@html renderMarkdown(parseResponse(action.response))}
              </div>
            </div>
          </div>
        </div>
      {:else}
        <!-- Single action bubble (right) -->
        <div class="bubble-row bubble-row-right">
          <div class="chat-bubble chat-bubble-action" style="--action-gradient:{cfg.gradient};--action-color:{cfg.color};--action-bg:{cfg.bgAlpha};">
            <div class="action-header">
              <span class="action-icon-wrap" style="background:{cfg.bgAlpha};color:{cfg.color};">
                <Icon name={cfg.icon} size={11} strokeWidth={2} />
              </span>
              <span class="action-type-label" style="color:{cfg.color};">{cfg.label}</span>
              {#if action.burstCount && action.burstCount > 1}
                <span class="burst-badge">×{action.burstCount}</span>
              {/if}
            </div>
            <div class="action-main">{label.main}</div>
            {#if label.sub}<div class="action-sub">{label.sub}</div>{/if}
          </div>
          <span class="bubble-time">{formatDate(action.created_at)}</span>
        </div>
      {/if}
    {/each}
  {/if}

  <!-- Pagination -->
  {#if totalPages > 1}
    <div class="pagination-row">
      <span class="page-label">{$recentActionsPage} / {totalPages}</span>
      <div style="display:flex;gap:4px;">
        <button class="btn btn-ghost btn-sm" on:click={() => onLoadPage($recentActionsPage - 1)} disabled={$recentActionsPage <= 1}>
          <Icon name="chevron-left" size={12} strokeWidth={2} />
        </button>
        <button class="btn btn-ghost btn-sm" on:click={() => onLoadPage($recentActionsPage + 1)} disabled={$recentActionsPage >= totalPages}>
          <Icon name="chevron-right" size={12} strokeWidth={2} />
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .action-pair {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .bubble-row {
    display: flex;
    flex-direction: column;
  }

  .bubble-row-right {
    align-items: flex-end;
  }

  .bubble-row-left {
    align-items: flex-start;
  }

  .chat-bubble {
    max-width: 88%;
    border-radius: 14px;
    padding: 9px 12px;
    transition: transform 0.15s ease, box-shadow 0.15s ease;
  }

  .chat-bubble:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  }

  .chat-bubble-action {
    background: var(--action-bg);
    border: 1px solid color-mix(in srgb, var(--action-color) 25%, transparent);
  }

  .chat-bubble-mcp {
    background: rgba(14, 165, 233, 0.06);
    border: 1px solid rgba(14, 165, 233, 0.18);
  }

  :global(html.dark) .chat-bubble-mcp {
    background: rgba(14, 165, 233, 0.08);
    border-color: rgba(14, 165, 233, 0.22);
  }

  .action-header {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-bottom: 5px;
  }

  .action-icon-wrap {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 5px;
    flex-shrink: 0;
  }

  .action-type-label {
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
  }

  .burst-badge {
    font-size: 0.58rem;
    font-weight: 700;
    background: rgba(255, 255, 255, 0.15);
    border-radius: 9999px;
    padding: 1px 5px;
    margin-left: auto;
    color: var(--color-text-muted);
  }

  .action-main {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--color-text);
    line-height: 1.4;
    word-break: break-word;
  }

  .action-sub {
    font-size: 0.68rem;
    color: var(--color-text-muted);
    margin-top: 3px;
  }

  .mcp-header {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-bottom: 5px;
  }

  .mcp-dot {
    width: 6px;
    height: 6px;
    border-radius: 9999px;
    background: #0ea5e9;
    flex-shrink: 0;
  }

  .mcp-label {
    font-size: 0.6rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #0ea5e9;
    opacity: 0.8;
  }

  .bubble-time {
    font-size: 0.62rem;
    color: var(--color-text-muted);
    margin-top: 3px;
    padding: 0 4px;
  }

  .pagination-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-top: 1px solid var(--color-border);
    padding-top: 8px;
    margin-top: 4px;
  }

  .page-label {
    font-size: 0.7rem;
    color: var(--color-text-muted);
  }
</style>
