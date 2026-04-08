<script lang="ts">
  import { dashboardStats, taskTimeStats } from '../lib/stores';
  import { formatTokens, formatDuration } from '../lib/utils';

  type Period = 'daily' | 'weekly' | 'monthly' | 'overall';
  let activePeriod: Period = 'daily';

  $: tStats = $taskTimeStats;
  $: periodData = tStats?.[activePeriod];

  const periods: { key: Period; label: string }[] = [
    { key: 'daily', label: 'Today' },
    { key: 'weekly', label: 'Week' },
    { key: 'monthly', label: 'Month' },
    { key: 'overall', label: 'All' },
  ];
</script>

<div class="glass card animate-fade-in">
  <!-- Header + period tabs -->
  <div class="flex items-center justify-between mb-3">
    <div>
      <div style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#6366f1;">Task Stats</div>
      <div style="font-size:0.75rem;color:var(--color-text-muted);">Performance over time</div>
    </div>
    <div class="flex gap-1" style="background:rgba(241,245,249,0.8);padding:3px;border-radius:10px;">
      {#each periods as p}
        <button
          class="tab-btn"
          class:active={activePeriod === p.key}
          on:click={() => activePeriod = p.key}
          style="padding:4px 10px;font-size:0.65rem;"
        >
          {p.label}
        </button>
      {/each}
    </div>
  </div>

  <!-- Metrics grid -->
  <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;">
    <div style="background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.15);border-radius:12px;padding:12px;">
      <div style="font-size:0.65rem;color:#6366f1;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Completed</div>
      <div style="font-size:1.5rem;font-weight:800;color:var(--color-text);line-height:1;">
        {periodData?.completed ?? '—'}
      </div>
    </div>
    <div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.15);border-radius:12px;padding:12px;">
      <div style="font-size:0.65rem;color:#10b981;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Added</div>
      <div style="font-size:1.5rem;font-weight:800;color:var(--color-text);line-height:1;">
        {periodData?.added ?? '—'}
      </div>
    </div>
    <div style="background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.15);border-radius:12px;padding:12px;">
      <div style="font-size:0.65rem;color:#0ea5e9;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Tokens</div>
      <div style="font-size:1.5rem;font-weight:800;color:var(--color-text);line-height:1;">
        {periodData?.tokens ? formatTokens(periodData.tokens) : '—'}
      </div>
    </div>
    <div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.15);border-radius:12px;padding:12px;">
      <div style="font-size:0.65rem;color:#f59e0b;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Avg Time</div>
      <div style="font-size:1.5rem;font-weight:800;color:var(--color-text);line-height:1;">
        {periodData?.avgDuration ? formatDuration(periodData.avgDuration) : '—'}
      </div>
    </div>
  </div>
</div>
