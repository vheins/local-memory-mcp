<script lang="ts">
  import { formatTokens, formatDuration } from '../lib/utils';
  import { createTimeStatsHandler, TIME_PERIODS } from '../lib/composables/useTimeStats';

  const handler = createTimeStatsHandler();
  const { activePeriod, periodData, history, maxVal, setActivePeriod } = handler;
</script>

<div class="glass card animate-fade-in">
  <!-- Header + period tabs -->
  <div class="flex items-center justify-between mb-3">
    <div>
      <div style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#6366f1;">Task Stats</div>
      <div style="font-size:0.75rem;color:var(--color-text-muted);">Performance over time</div>
    </div>
    <div class="flex gap-1" style="background:rgba(241,245,249,0.8);padding:3px;border-radius:10px;">
      {#each TIME_PERIODS as p}
        <button
          class="tab-btn"
          class:active={$activePeriod === p.key}
          on:click={() => setActivePeriod(p.key)}
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
        {$periodData?.completed ?? '—'}
      </div>
    </div>
    <div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.15);border-radius:12px;padding:12px;">
      <div style="font-size:0.65rem;color:#10b981;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Added</div>
      <div style="font-size:1.5rem;font-weight:800;color:var(--color-text);line-height:1;">
        {$periodData?.added ?? '—'}
      </div>
    </div>
    <div style="background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.15);border-radius:12px;padding:12px;">
      <div style="font-size:0.65rem;color:#0ea5e9;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Tokens</div>
      <div style="font-size:1.5rem;font-weight:800;color:var(--color-text);line-height:1;">
        {$periodData?.tokens ? formatTokens($periodData.tokens) : '—'}
      </div>
    </div>
    <div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.15);border-radius:12px;padding:12px;">
      <div style="font-size:0.65rem;color:#f59e0b;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Avg Time</div>
      <div style="font-size:1.5rem;font-weight:800;color:var(--color-text);line-height:1;">
        {$periodData?.avgDuration ? formatDuration($periodData.avgDuration) : '—'}
      </div>
    </div>
  </div>

  <!-- Bar Chart Comparison -->
  {#if $periodData?.history && $periodData.history.length > 0}
    <div class="mt-4 pt-4 border-t border-dashed" style="border-color:var(--color-border);">
      <div class="flex items-center justify-between mb-3">
        <div style="font-size:0.65rem;font-weight:700;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.05em;">Throughput vs Inflow</div>
        <div class="flex gap-2">
          <div class="flex items-center gap-1">
            <div style="width:8px;height:8px;border-radius:2px;background:#10b981;"></div>
            <span style="font-size:0.6rem;color:var(--color-text-muted);">Created</span>
          </div>
          <div class="flex items-center gap-1">
            <div style="width:8px;height:8px;border-radius:2px;background:#6366f1;"></div>
            <span style="font-size:0.6rem;color:var(--color-text-muted);">Completed</span>
          </div>
        </div>
      </div>

      <div style="height:120px;display:flex;align-items:flex-end;gap:4px;padding-bottom:20px;position:relative;">
        {#each $history as h}
          <div class="flex-1 flex flex-col items-center group relative" style="height:100%;">
            <div class="flex h-full w-full items-end justify-center gap-[2px]">
              <!-- Created Bar -->
              <div 
                class="bar created-bar" 
                style="width:35%; height:{( (h.created || 0) / $maxVal ) * 100}%; background:#10b981; border-radius:3px 3px 0 0; opacity:0.8; transition: height 0.3s ease;"
              ></div>
              <!-- Completed Bar -->
              <div 
                class="bar completed-bar" 
                style="width:35%; height:{( (h.completed || 0) / $maxVal ) * 100}%; background:#6366f1; border-radius:3px 3px 0 0; opacity:0.8; transition: height 0.3s ease;"
              ></div>
            </div>
            
            <!-- Tooltip -->
            <div class="absolute bottom-full mb-1 bg-slate-800 text-white p-1.5 rounded text-[10px] hidden group-hover:block z-10 whitespace-nowrap shadow-lg">
              <div class="font-bold border-b border-slate-600 mb-1">{h.label}</div>
              <div>Added: {h.created}</div>
              <div>Done: {h.completed}</div>
            </div>

            <!-- X-Axis Label (Truncated if too many) -->
            <div class="absolute bottom-0 translate-y-[20px] text-[8px] text-slate-400 whitespace-nowrap overflow-hidden max-w-full">
              {h.label.includes(':00') ? h.label.split(':')[0] : h.label.replace('2026-', '').replace('2025-', '')}
            </div>
          </div>
        {/each}
      </div>
    </div>
  {:else}
     <div class="mt-4 pt-4 border-t border-dashed flex items-center justify-center" style="border-color:var(--color-border);height:140px;color:var(--color-text-muted);font-size:0.75rem;">
        No trend data available for this period
     </div>
  {/if}
</div>
