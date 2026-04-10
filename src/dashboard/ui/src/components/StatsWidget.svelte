<script lang="ts">
  import { dashboardStats } from '../lib/stores';
  import { formatTokens, formatDuration } from '../lib/utils';
  import Icon from '../lib/Icon.svelte';

  $: stats = $dashboardStats;

  const typeColors: Record<string, string> = {
    code_fact: '#a855f7',
    decision: '#3b82f6',
    mistake: '#ef4444',
    pattern: '#10b981',
    agent_handoff: '#f97316',
    agent_registered: '#84cc16',
    file_claim: '#06b6d4',
    task_archive: '#78716c',
  };

  const typeLabels: Record<string, string> = {
    code_fact: 'Code Facts',
    decision: 'Decisions',
    mistake: 'Mistakes',
    pattern: 'Patterns',
    agent_handoff: 'Handoffs',
    agent_registered: 'Registered',
    file_claim: 'Claims',
    task_archive: 'Archives',
  };

  $: summaryItems = [
    { label: 'Total Memories', val: stats?.total ?? '—', icon: 'layers', color: '#0ea5e9', glow: 'rgba(14,165,233,0.12)' },
    { label: 'Avg Importance', val: stats?.avgImportance ? Number(stats.avgImportance).toFixed(1) : '—', icon: 'star', color: '#f59e0b', glow: 'rgba(245,158,11,0.12)' },
    { label: 'Total Hits', val: stats?.totalHitCount ?? '—', icon: 'mouse-pointer-2', color: '#10b981', glow: 'rgba(16,185,129,0.12)' },
    { label: 'Expiring Soon', val: stats?.expiringSoon ?? '—', icon: 'clock', color: '#ef4444', glow: 'rgba(239,68,68,0.12)' },
  ];
</script>

<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));gap:10px;margin-bottom:12px;">
  {#each summaryItems as item}
    <div class="stat-card" style="text-align:center;background:{item.glow};border:1px solid {item.glow};padding:10px 8px;">
      <div style="display:flex;justify-content:center;margin-bottom:2px;color:{item.color};opacity:0.8;">
        <Icon name={item.icon} size={14} strokeWidth={1.75} />
      </div>
      <div style="font-size:1.25rem;font-weight:900;color:{item.color};line-height:1;letter-spacing:-0.03em;">{item.val}</div>
      <div style="font-size:0.6rem;font-weight:700;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-top:2px;">{item.label}</div>
    </div>
  {/each}
</div>

<!-- By Type -->
{#if stats?.byType}
  <div style="margin-top:4px;">
    <div class="stat-label" style="font-size:0.6rem;margin-bottom:6px;">By Type</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;">
      {#each Object.entries(stats.byType) as [type, count]}
        {#if count > 0}
          <div class="flex items-center gap-1.5" style="background:rgba({typeColors[type] || '#64748b'},0.12);border:1px solid rgba({typeColors[type] || '#64748b'},0.2);border-radius:9999px;padding:2px 10px;box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
            <div style="width:5px;height:5px;border-radius:9999px;background:{typeColors[type] || '#64748b'};"></div>
            <span style="font-size:0.65rem;font-weight:700;color:{typeColors[type] || 'var(--color-text)'};margin-right:2px;">{count}</span>
            <span style="font-size:0.62rem;color:var(--color-text);font-weight:500;">{typeLabels[type] || type}</span>
          </div>
        {/if}
      {/each}
    </div>
  </div>
{/if}

