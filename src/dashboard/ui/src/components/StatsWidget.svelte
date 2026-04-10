<script lang="ts">
  import { createStatsHandler } from '../lib/composables/useStatsWidget';
  import Icon from '../lib/Icon.svelte';

  const handler = createStatsHandler();
  const { summaryItems, byTypeStats } = handler;
</script>

<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));gap:10px;margin-bottom:12px;">
  {#each $summaryItems as item}
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
{#if $byTypeStats.length > 0}
  <div style="margin-top:4px;">
    <div class="stat-label" style="font-size:0.6rem;margin-bottom:6px;">By Type</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;">
      {#each $byTypeStats as item}
        <div class="flex items-center gap-2" style="background:{item.color}15;border:1px solid {item.color}33;border-left:4px solid {item.color};border-radius:4px;padding:4px 10px;box-shadow: 0 1px 2px rgba(0,0,0,0.06);">
          <span style="font-size:0.7rem;font-weight:900;color:{item.color};">{item.count}</span>
          <span style="font-size:0.62rem;color:var(--color-text);font-weight:800;text-transform:uppercase;letter-spacing:0.02em;">{item.label}</span>
        </div>
      {/each}
    </div>
  </div>
{/if}

