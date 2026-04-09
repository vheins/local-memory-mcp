<script lang="ts">
  import { dashboardStats } from '../lib/stores';
  import { formatTokens, formatDuration } from '../lib/utils';

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
</script>

<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
  <!-- Total memories -->
  <div class="glass stat-card animate-fade-in flex items-baseline justify-between" style="border:1px solid rgba(14,165,233,0.12);padding:6px 12px;min-width:160px;flex:1;">
    <div style="font-size:0.62rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--color-text-muted);">Total Memories</div>
    <div class="stat-number" style="color:var(--color-text);font-size:1.1rem;margin-left:8px;">{stats?.total ?? '—'}</div>
  </div>

  <!-- Avg importance -->
  <div class="glass stat-card animate-fade-in flex items-baseline justify-between" style="border:1px solid rgba(245,158,11,0.12);padding:6px 12px;min-width:160px;flex:1;">
    <div style="font-size:0.62rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--color-text-muted);">Avg Importance</div>
    <div class="stat-number" style="color:var(--color-text);font-size:1.1rem;margin-left:8px;">{stats?.avgImportance ? Number(stats.avgImportance).toFixed(1) : '—'}</div>
  </div>

  <!-- Total hits -->
  <div class="glass stat-card animate-fade-in flex items-baseline justify-between" style="border:1px solid rgba(16,185,129,0.12);padding:6px 12px;min-width:160px;flex:1;">
    <div style="font-size:0.62rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--color-text-muted);">Total Hits</div>
    <div class="stat-number" style="color:var(--color-text);font-size:1.1rem;margin-left:8px;">{stats?.totalHitCount ?? '—'}</div>
  </div>

  <!-- Expiring -->
  <div class="glass stat-card animate-fade-in flex items-baseline justify-between" style="border:1px solid rgba(239,68,68,0.12);padding:6px 12px;min-width:160px;flex:1;">
    <div style="font-size:0.62rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--color-text-muted);">Expiring Soon</div>
    <div class="stat-number" style="color:var(--color-text);font-size:1.1rem;margin-left:8px;">{stats?.expiringSoon ?? '—'}</div>
  </div>
</div>

<!-- By Type -->
{#if stats?.byType}
  <div style="margin-top:4px;">
    <div class="stat-label" style="font-size:0.6rem;margin-bottom:6px;">By Type</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;">
      {#each Object.entries(stats.byType) as [type, count]}
        {#if count > 0}
          <div class="flex items-center gap-1.5" style="background:rgba({typeColors[type] || '#64748b'},0.06);border:1px solid rgba({typeColors[type] || '#64748b'},0.15);border-radius:8px;padding:4px 10px;">
            <div style="width:6px;height:6px;border-radius:9999px;background:{typeColors[type] || '#64748b'};"></div>
            <span style="font-size:0.68rem;font-weight:600;color:var(--color-text);">{count}</span>
            <span style="font-size:0.62rem;color:var(--color-text-muted);">{typeLabels[type] || type}</span>
          </div>
        {/if}
      {/each}
    </div>
  </div>
{/if}
