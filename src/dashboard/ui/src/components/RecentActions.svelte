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
      const keys = Object.keys(r);
      if (keys.length > 4) {
        return `{ ${keys.slice(0, 3).map(k => `${k}: …`).join(', ')}, +${keys.length - 3} more }`;
      }
      return JSON.stringify(r, null, 2);
    } catch { return response; }
  }

  $: totalPages = Math.max(1, Math.ceil($recentActionsTotalItems / $recentActionsPageSize));

  // Date Grouping
  $: groupedActions = (() => {
    const groups: { date: string; items: RecentAction[] }[] = [];
    $recentActions.forEach(a => {
      const d = new Date(a.created_at);
      const today = new Date();
      const yesterday = new Date();
      yesterday.setDate(today.getDate() - 1);
      
      let dateStr = d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
      if (d.toDateString() === today.toDateString()) dateStr = 'Today';
      else if (d.toDateString() === yesterday.toDateString()) dateStr = 'Yesterday';
      
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.date === dateStr) {
        lastGroup.items.push(a);
      } else {
        groups.push({ date: dateStr, items: [a] });
      }
    });
    return groups;
  })();

  function formatTime(dateStr: string) {
    const d = new Date(dateStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
</script>

<div class="chat-container">
  {#if $recentActions.length === 0}
    <div style="text-align:center;padding:80px 20px;color:var(--color-text-muted);">
      <Icon name="activity" size={48} strokeWidth={1} />
      <div style="font-size:1rem;margin-top:16px;font-weight:600;">No activity found</div>
      <div style="font-size:0.875rem;opacity:0.7;">Events will appear here as they happen.</div>
    </div>
  {:else}
    {#each groupedActions as group}
      <div class="date-header">
        <span>{group.date}</span>
      </div>
      
      {#each group.items as action (action.id)}
        {@const label = getLabel(action)}
        {@const cfg = getConfig(action.action)}
        
        <!-- Action Row (Right/Agent) -->
        <div class="bubble-row bubble-row-right animate-slide-in-right">
          <div class="bubble-wrap">
            <div class="chat-bubble chat-bubble-action" style="--bubble-bg-light: #dcf8c6; --bubble-bg-dark: #056162;">
              <div class="action-badge" style="color:{cfg.color};background:{cfg.bgAlpha};">
                <Icon name={cfg.icon} size={10} strokeWidth={2.5} />
                <span>{cfg.label}</span>
              </div>
              <div class="action-main">{label.main}</div>
              {#if label.sub}<div class="action-sub">{label.sub}</div>{/if}
              <div class="bubble-meta">
                <span class="bubble-time">{formatTime(action.created_at)}</span>
                <span class="bubble-status"><Icon name="check-check" size={12} strokeWidth={2} /></span>
              </div>
            </div>
            <!-- Tail -->
            <div class="tail tail-right"></div>
          </div>
          <!-- Avatar -->
          <div class="chat-avatar agent-avatar">
            <Icon name="bot" size={14} strokeWidth={2} />
          </div>
        </div>

        {#if action.response}
          <!-- Response Row (Left/MCP) -->
          <div class="bubble-row bubble-row-left animate-slide-in-left">
            <!-- Avatar -->
            <div class="chat-avatar mcp-avatar">
              <Icon name="cpu" size={14} strokeWidth={2} />
            </div>
            <div class="bubble-wrap">
              <!-- Tail -->
              <div class="tail tail-left"></div>
              <div class="chat-bubble chat-bubble-mcp" style="--bubble-bg-light: #ffffff; --bubble-bg-dark: #202c33;">
                <div class="mcp-sender">MCP Node</div>
                <div class="markdown-body" style="font-size:0.82rem;">
                  {@html renderMarkdown(parseResponse(action.response))}
                </div>
                <div class="bubble-meta">
                  <span class="bubble-time">{formatTime(action.created_at)}</span>
                </div>
              </div>
            </div>
          </div>
        {/if}
      {/each}
    {/each}
  {/if}

  <!-- Pagination -->
  {#if totalPages > 1}
    <div class="pagination-area">
      <div class="pagination-glass">
        <button class="pag-btn" on:click={() => onLoadPage($recentActionsPage - 1)} disabled={$recentActionsPage <= 1}>
          <Icon name="chevron-left" size={14} strokeWidth={2} />
        </button>
        <span class="pag-info">Page {$recentActionsPage} of {totalPages}</span>
        <button class="pag-btn" on:click={() => onLoadPage($recentActionsPage + 1)} disabled={$recentActionsPage >= totalPages}>
          <Icon name="chevron-right" size={14} strokeWidth={2} />
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .chat-container {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-bottom: 40px;
  }

  /* Date Header */
  .date-header {
    display: flex;
    justify-content: center;
    margin: 20px 0 10px;
    position: sticky;
    top: 0;
    z-index: 5;
  }

  .date-header span {
    background: rgba(255, 255, 255, 0.9);
    color: #54656f;
    font-size: 0.75rem;
    font-weight: 700;
    padding: 6px 12px;
    border-radius: 8px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.1);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  :global(html.dark) .date-header span {
    background: #182229;
    color: #8696a0;
  }

  /* Bubble Rows */
  .bubble-row {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    margin-bottom: 4px;
    width: 100%;
  }

  .bubble-row-right {
    justify-content: flex-end;
  }

  .bubble-row-left {
    justify-content: flex-start;
  }

  .bubble-wrap {
    position: relative;
    max-width: 80%;
  }

  /* Bubbles */
  .chat-bubble {
    padding: 8px 10px 18px;
    border-radius: 12px;
    box-shadow: 0 1px 0.5px rgba(0,0,0,0.13);
    position: relative;
    font-size: 0.875rem;
    line-height: 1.4;
    transition: transform 0.2s ease;
  }

  .chat-bubble-action {
    background: var(--bubble-bg-light);
    color: #111b21;
    border-top-right-radius: 0;
  }

  .chat-bubble-mcp {
    background: var(--bubble-bg-light);
    color: #111b21;
    border-top-left-radius: 0;
  }

  :global(html.dark) .chat-bubble-action {
    background: var(--bubble-bg-dark);
    color: #e9edef;
  }

  :global(html.dark) .chat-bubble-mcp {
    background: var(--bubble-bg-dark);
    color: #e9edef;
  }

  /* Tails */
  .tail {
    position: absolute;
    top: 0;
    width: 12px;
    height: 12px;
  }

  .tail-right {
    right: -10px;
    background: radial-gradient(circle at 100% 0, transparent 10px, var(--bubble-bg-light) 10px);
  }

  .tail-left {
    left: -10px;
    background: radial-gradient(circle at 0% 0, transparent 10px, var(--bubble-bg-light) 10px);
  }

  :global(html.dark) .tail-right {
    background: radial-gradient(circle at 100% 0, transparent 10px, var(--bubble-bg-dark) 10px);
  }

  :global(html.dark) .tail-left {
    background: radial-gradient(circle at 0% 0, transparent 10px, var(--bubble-bg-dark) 10px);
  }

  /* Avatars */
  .chat-avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  }

  .agent-avatar {
    background: linear-gradient(135deg, #0ea5e9, #6366f1);
    color: white;
  }

  .mcp-avatar {
    background: #f0f2f5;
    color: #54656f;
  }

  :global(html.dark) .mcp-avatar {
    background: #182229;
    color: #8696a0;
  }

  /* Content Styling */
  .action-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.62rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 4px;
  }

  .action-main {
    font-weight: 600;
    color: inherit;
    word-break: break-word;
  }

  .action-sub {
    font-size: 0.75rem;
    opacity: 0.7;
    margin-top: 2px;
  }

  .mcp-sender {
    font-size: 0.72rem;
    font-weight: 800;
    color: #0ea5e9;
    margin-bottom: 4px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  /* Meta (Time & Status) */
  .bubble-meta {
    position: absolute;
    bottom: 4px;
    right: 7px;
    display: flex;
    align-items: center;
    gap: 3px;
    pointer-events: none;
  }

  .bubble-time {
    font-size: 0.65rem;
    color: #667781;
  }

  :global(html.dark) .bubble-time {
    color: rgba(255,255,255,0.5);
  }

  .bubble-status {
    display: flex;
    color: #53bdeb; /* WhatsApp Blue Read Ticks */
  }

  /* Pagination */
  .pagination-area {
    display: flex;
    justify-content: center;
    margin-top: 24px;
  }

  .pagination-glass {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    background: rgba(255, 255, 255, 0.7);
    backdrop-filter: blur(12px);
    border: 1px solid var(--color-border);
    padding: 6px 16px;
    border-radius: 9999px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.05);
  }

  :global(html.dark) .pagination-glass {
    background: rgba(30, 41, 59, 0.7);
  }

  .pag-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--color-primary);
    display: flex;
    padding: 4px;
    border-radius: 50%;
    transition: background 0.2s;
  }

  .pag-btn:hover:not(:disabled) {
    background: rgba(0,0,0,0.05);
  }

  .pag-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .pag-info {
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--color-text-muted);
  }

  /* Animations */
  @keyframes slideInRight {
    from { opacity: 0; transform: translateX(20px); }
    to { opacity: 1; transform: translateX(0); }
  }

  @keyframes slideInLeft {
    from { opacity: 0; transform: translateX(-20px); }
    to { opacity: 1; transform: translateX(0); }
  }

  .animate-slide-in-right { animation: slideInRight 0.3s ease-out forwards; }
  .animate-slide-in-left { animation: slideInLeft 0.3s ease-out forwards; }
</style>
