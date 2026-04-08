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

<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;">
  <!-- Total memories -->
  <div class="glass stat-card animate-fade-in" style="border:1px solid rgba(14,165,233,0.2);">
    <div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#0ea5e9;margin-bottom:6px;">Total</div>
    <div class="stat-number" style="color:var(--color-text);">{stats?.total ?? '—'}</div>
    <div class="stat-label">memories</div>
  </div>

  <!-- Avg importance -->
  <div class="glass stat-card animate-fade-in" style="border:1px solid rgba(245,158,11,0.2);">
    <div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#f59e0b;margin-bottom:6px;">Avg Imp.</div>
    <div class="stat-number" style="color:var(--color-text);">{stats?.avgImportance ? Number(stats.avgImportance).toFixed(1) : '—'}</div>
    <div class="stat-label">importance</div>
  </div>

  <!-- Total hits -->
  <div class="glass stat-card animate-fade-in" style="border:1px solid rgba(16,185,129,0.2);">
    <div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#10b981;margin-bottom:6px;">Hit Rate</div>
    <div class="stat-number" style="color:var(--color-text);">{stats?.totalHitCount ?? '—'}</div>
    <div class="stat-label">total hits</div>
  </div>

  <!-- Expiring -->
  <div class="glass stat-card animate-fade-in" style="border:1px solid rgba(239,68,68,0.2);">
    <div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#ef4444;margin-bottom:6px;">Expiring</div>
    <div class="stat-number" style="color:var(--color-text);">{stats?.expiringSoon ?? '—'}</div>
    <div class="stat-label">soon</div>
  </div>
</div>

<!-- By Type -->
{#if stats?.byType}
  <div style="margin-top:16px;">
    <div class="stat-label" style="margin-bottom:10px;">By Type</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;">
      {#each Object.entries(stats.byType) as [type, count]}
        {#if count > 0}
          <div class="flex items-center gap-2" style="background:rgba({typeColors[type] || '#64748b'},0.08);border:1px solid rgba({typeColors[type] || '#64748b'},0.2);border-radius:10px;padding:6px 12px;">
            <div style="width:8px;height:8px;border-radius:9999px;background:{typeColors[type] || '#64748b'};"></div>
            <span style="font-size:0.72rem;font-weight:600;color:var(--color-text);">{count}</span>
            <span style="font-size:0.65rem;color:var(--color-text-muted);">{typeLabels[type] || type}</span>
          </div>
        {/if}
      {/each}
    </div>
  </div>
{/if}
