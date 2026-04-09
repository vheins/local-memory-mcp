<script lang="ts">
  import { recentActions, recentActionsPage, recentActionsPageSize, recentActionsTotalItems } from '../lib/stores';
  import { formatDate, renderMarkdown } from '../lib/utils';
  import Icon from '../lib/Icon.svelte';
  import type { RecentAction } from '../lib/stores';
  import { onMount, afterUpdate, tick } from 'svelte';

  export let onLoadPage: (page: number, append?: boolean) => Promise<void> = async () => {};

  let chatContainer: HTMLDivElement | undefined = undefined;
  let expandedResponses = new Set<number>();
  let isLoadingMore = false;
  let hasReachedStart = false; // Whether we've loaded all history

  function toggleExpand(id: number) {
    if (expandedResponses.has(id)) {
      expandedResponses.delete(id);
    } else {
      expandedResponses.add(id);
    }
    expandedResponses = expandedResponses; // trigger reactivity
  }

  // Action → visual config
  const ACTION_CONFIG: Record<string, { icon: string; label: string; gradient: string; color: string; bgAlpha: string }> = {
    search:           { icon: 'search',        label: 'Search',     gradient: 'linear-gradient(135deg,#3b82f6,#2563eb)', color: '#3b82f6', bgAlpha: 'rgba(59,130,246,0.12)' },
    read:             { icon: 'book-open',      label: 'Read',       gradient: 'linear-gradient(135deg,#10b981,#059669)', color: '#10b981', bgAlpha: 'rgba(16,185,129,0.12)' },
    write:            { icon: 'edit',           label: 'Created',    gradient: 'linear-gradient(135deg,#6366f1,#4f46e5)', color: '#6366f1', bgAlpha: 'rgba(99,102,241,0.12)' },
    update:           { icon: 'refresh-cw',     label: 'Updated',    gradient: 'linear-gradient(135deg,#f59e0b,#d97706)', color: '#f59e0b', bgAlpha: 'rgba(245,158,11,0.12)' },
    delete:           { icon: 'trash',          label: 'Deleted',    gradient: 'linear-gradient(135deg,#ef4444,#dc2626)', color: '#ef4444', bgAlpha: 'rgba(239,68,68,0.12)'  },
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
        sub: a.result_count != null ? `${a.result_count} result${a.result_count !== 1 ? 's' : ''} found` : 'Searching memories...',
      };
    }
    if (a.task_id) {
      const verb: Record<string, string> = { write: 'Created', update: 'Updated', delete: 'Deleted' };
      return {
        main: a.task_title || a.task_code || a.task_id.substring(0, 8),
        sub: a.task_code ? `${verb[a.action] || a.action} Task · ${a.task_code}` : (verb[a.action] || a.action) + ' Task',
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

  function parseResponse(response: string | undefined): { text: string; isLong: boolean } {
    if (!response) return { text: '', isLong: false };
    let text = response;
    try {
      const r = typeof response === 'string' ? JSON.parse(response) : response;
      
      // Case 1: Standard MCP Tool Call result (wrapped in content array)
      if (r.content && Array.isArray(r.content)) {
        text = r.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
      } 
      // Case 2: Array of objects (common for list/search results)
      else if (Array.isArray(r)) {
        if (r.length === 0) {
          text = "No items found.";
        } else {
          const first = r[0];
          const isTask = first.task_code || first.task_id;
          const isMemory = first.memory_id || first.memory_type;
          const type = isTask ? 'task' : isMemory ? 'memory' : 'item';
          
          text = `Found ${r.length} ${type}${r.length > 1 ? 's' : ''}:\n` + 
                 r.slice(0, 5).map((item: any) => {
                   const title = item.title || item.task_code || item.name || item.id || 'Untitled';
                   return `- ${title}`;
                 }).join('\n') + 
                 (r.length > 5 ? `\n... and ${r.length - 5} more` : '');
        }
      }
      // Case 3: Structured Content from our standard McpResponse
      else if (r.tasks && Array.isArray(r.tasks)) {
        text = `Found ${r.tasks.length} tasks:\n` + r.tasks.slice(0, 5).map((t: any) => `- [${t.task_code}] ${t.title}`).join('\n') + (r.tasks.length > 5 ? `\n... and ${r.tasks.length - 5} more` : '');
      } else if (r.results && Array.isArray(r.results)) {
        text = `Found ${r.results.length} results:\n` + r.results.slice(0, 5).map((m: any) => `- ${m.title || m.content?.substring(0, 40) + '...'}`).join('\n') + (r.results.length > 5 ? `\n... and ${r.results.length - 5} more` : '');
      } 
      // Case 4: General object
      else if (typeof r === 'object' && r !== null) {
        const keys = Object.keys(r);
        if (keys.length > 5) {
          text = `{ ${keys.slice(0, 4).map(k => `${k}: …`).join(', ')}, +${keys.length - 4} more }`;
        } else {
          text = JSON.stringify(r, null, 2);
        }
      } else {
        text = String(r);
      }
    } catch { 
      text = response; 
    }
    
    return {
      text,
      isLong: text.length > 400 || text.split('\n').length > 8
    };
  }

  $: totalPages = Math.max(1, Math.ceil($recentActionsTotalItems / $recentActionsPageSize));

  // Date Grouping - Sorted CHRONOLOGICALLY (Oldest to Newest)
  $: groupedActions = (() => {
    const groups: { date: string; items: RecentAction[] }[] = [];
    // Reversing the default DESC array to show ASC in the chat
    const chronActions = [...$recentActions].reverse();
    
    chronActions.forEach(a => {
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

  function scrollToBottom(behavior: ScrollBehavior = 'smooth') {
    if (chatContainer) {
      chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior });
    }
  }

  async function handleScroll() {
    if (!chatContainer || isLoadingMore || hasReachedStart) return;

    // Detect if we are near the top (threshold 50px)
    if (chatContainer.scrollTop < 50 && $recentActions.length < $recentActionsTotalItems) {
      isLoadingMore = true;
      const prevScrollHeight = chatContainer.scrollHeight;
      const nextPage = $recentActionsPage + 1;

      // Notify parent to load more
      await onLoadPage(nextPage, true);
      
      // Preserve scroll position relative to the bottom
      await tick();
      if (chatContainer) {
        chatContainer.scrollTop = chatContainer.scrollHeight - prevScrollHeight;
      }
      
      isLoadingMore = false;
      if ($recentActions.length >= $recentActionsTotalItems) {
        hasReachedStart = true;
      }
    }
  }

  afterUpdate(() => {
    // Only auto-scroll to bottom on INITIAL load (first page) or when new items are added to bottom
    // But NOT when loading older history (which is isLoadingMore=true)
    if ($recentActionsPage === 1 && !isLoadingMore) {
      scrollToBottom();
    }
  });

  onMount(() => {
    tick().then(() => {
        scrollToBottom('instant');
        if (chatContainer) {
          chatContainer.addEventListener('scroll', handleScroll);
        }
    });

    return () => {
      if (chatContainer) {
        chatContainer.removeEventListener('scroll', handleScroll);
      }
    };
  });
</script>

<div class="chat-container-viewport" bind:this={chatContainer}>
  <div class="chat-container">
    {#if isLoadingMore}
      <div class="load-more-spinner">
        <Icon name="refresh-cw" size={14} className="animate-spin" />
        <span>Loading older history...</span>
      </div>
    {/if}

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
            {@const parsed = parseResponse(action.response)}
            {@const isExpanded = expandedResponses.has(action.id)}
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
                  <div class="markdown-body" style="font-size:0.82rem; {!isExpanded && parsed.isLong ? 'max-height: 200px; overflow: hidden; mask-image: linear-gradient(to bottom, black 70%, transparent 100%);' : ''}">
                    {@html renderMarkdown(parsed.text)}
                  </div>
                  
                  {#if parsed.isLong}
                    <button class="read-more-btn" on:click={() => toggleExpand(action.id)}>
                      {isExpanded ? 'Show less' : 'Read more'}
                    </button>
                  {/if}

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
  </div>
</div>

<style>
  .chat-container-viewport {
    flex: 1;
    overflow-y: auto;
    padding: 24px 32px;
    background: rgba(0,0,0,0.02);
    scroll-behavior: smooth;
    display: flex;
    flex-direction: column;
  }

  /* WhatsApp-like wallpaper pattern (subtle) */
  :global(html.dark) .chat-container-viewport {
    background-image: radial-gradient(rgba(255,255,255,0.03) 1px, transparent 1px);
    background-size: 20px 20px;
    background-color: #0b141a;
  }

  .chat-container {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-bottom: 20px;
    min-height: min-content;
  }

  /* Date Header */
  .date-header {
    display: flex;
    justify-content: center;
    margin: 24px 0 12px;
    position: sticky;
    top: -12px;
    z-index: 10;
  }

  .date-header span {
    background: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(8px);
    color: #54656f;
    font-size: 0.7rem;
    font-weight: 700;
    padding: 6px 14px;
    border-radius: 10px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    border: 1px solid rgba(0,0,0,0.05);
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
    right: -8px;
    background: radial-gradient(circle at 100% 0, transparent 8px, #dcf8c6 8px);
  }

  .tail-left {
    left: -8px;
    background: radial-gradient(circle at 0% 0, transparent 8px, #ffffff 8px);
  }

  :global(html.dark) .chat-bubble-action {
    --bubble-bg-dark: #056162;
  }

  :global(html.dark) .tail-right {
    background: radial-gradient(circle at 100% 0, transparent 8px, #056162 8px);
  }

  :global(html.dark) .tail-left {
    background: radial-gradient(circle at 0% 0, transparent 8px, #202c33 8px);
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
    color: #34b7f1;
    margin-bottom: 6px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .read-more-btn {
    background: transparent;
    border: none;
    color: #34b7f1;
    font-size: 0.75rem;
    font-weight: 700;
    cursor: pointer;
    padding: 4px 0;
    margin-top: 4px;
    display: block;
    width: 100%;
    text-align: left;
  }

  .read-more-btn:hover {
    text-decoration: underline;
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

  .load-more-spinner {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 12px;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-text-muted);
    opacity: 0.8;
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
