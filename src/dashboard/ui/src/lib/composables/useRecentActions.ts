import { writable, get, derived, type Writable } from 'svelte/store';
import { 
  recentActions, recentActionsPage, recentActionsTotalItems, 
  recentActionsPageSize 
} from '../stores';
import { renderMarkdown } from '../utils';
import type { RecentAction } from '../stores';

export interface RecentActionsState {
  expandedResponses: Set<number>;
  isLoadingMore: boolean;
  hasReachedStart: boolean;
}

export function createRecentActionsHandler(onLoadPage: (page: number, append?: boolean) => Promise<void>) {
  const state = writable<RecentActionsState>({
    expandedResponses: new Set(),
    isLoadingMore: false,
    hasReachedStart: false
  });

  const { subscribe, update } = state;

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
      
      if (r.content && Array.isArray(r.content)) {
        text = r.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
      } 
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
      else if (r.tasks && Array.isArray(r.tasks)) {
        text = `Found ${r.tasks.length} tasks:\n` + r.tasks.slice(0, 5).map((t: any) => `- [${t.task_code}] ${t.title}`).join('\n') + (r.tasks.length > 5 ? `\n... and ${r.tasks.length - 5} more` : '');
      } else if (r.results && Array.isArray(r.results)) {
        text = `Found ${r.results.length} results:\n` + r.results.slice(0, 5).map((m: any) => `- ${m.title || m.content?.substring(0, 40) + '...'}`).join('\n') + (r.results.length > 5 ? `\n... and ${r.results.length - 5} more` : '');
      } 
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

  const groupedActions = derived(recentActions, ($recentActions) => {
    const groups: { date: string; items: RecentAction[] }[] = [];
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
  });

  function formatTime(dateStr: string) {
    const d = new Date(dateStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function toggleExpand(id: number) {
    update(s => {
      const next = new Set(s.expandedResponses);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...s, expandedResponses: next };
    });
  }

  function scrollToBottom(chatContainer: HTMLDivElement | undefined, behavior: ScrollBehavior = 'smooth') {
    if (chatContainer) {
      chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior });
    }
  }

  async function handleScroll(e: Event, chatContainer: HTMLDivElement | undefined) {
    const s = get(state);
    if (!chatContainer || s.isLoadingMore || s.hasReachedStart) return;

    const currentActions = get(recentActions);
    const totalItems = get(recentActionsTotalItems);
    const currentPage = get(recentActionsPage);

    if (chatContainer.scrollTop < 50 && currentActions.length < totalItems) {
      update(curr => ({ ...curr, isLoadingMore: true }));
      const prevScrollHeight = chatContainer.scrollHeight;
      const nextPage = currentPage + 1;

      await onLoadPage(nextPage, true);
      
      if (chatContainer) {
        setTimeout(() => {
          chatContainer.scrollTop = chatContainer.scrollHeight - prevScrollHeight;
        }, 0);
      }
      
      const updatedActions = get(recentActions);
      update(curr => ({ 
        ...curr, 
        isLoadingMore: false,
        hasReachedStart: updatedActions.length >= totalItems
      }));
    }
  }

  return {
    subscribe,
    state,
    groupedActions,
    recentActions,
    recentActionsPage,
    getConfig,
    getLabel,
    parseResponse,
    formatTime,
    renderMarkdown,
    toggleExpand,
    scrollToBottom,
    handleScroll
  };
}
