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
        <div class="flex items-center gap-2 glassy-badge" style="--badge-color: {item.color};">
          <div class="indicator-dot"></div>
          <span class="count">{item.count}</span>
          <span class="label">{item.label}</span>
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .glassy-badge {
    background: rgba(255, 255, 255, 0.04);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid var(--badge-color);
    border-radius: 9999px;
    padding: 4px 12px;
    box-shadow: 
      0 4px 12px rgba(0, 0, 0, 0.05),
      inset 0 0 0 1px rgba(255, 255, 255, 0.05);
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    cursor: default;
  }

  :global(html.dark) .glassy-badge {
    background: rgba(0, 0, 0, 0.2);
    border-color: rgba(255, 255, 255, 0.1);
    box-shadow: 
      0 8px 16px rgba(0, 0, 0, 0.2),
      inset 0 0 0 1px var(--badge-color);
  }

  .glassy-badge:hover {
    transform: translateY(-1px);
    background: rgba(255, 255, 255, 0.08);
    box-shadow: 
      0 6px 16px rgba(0, 0, 0, 0.08),
      inset 0 0 0 1px var(--badge-color);
  }

  .indicator-dot {
    width: 6px;
    height: 6px;
    border-radius: 9999px;
    background: var(--badge-color);
    box-shadow: 0 0 10px var(--badge-color);
    position: relative;
  }

  .indicator-dot::after {
    content: '';
    position: absolute;
    top: -2px;
    left: -2px;
    right: -2px;
    bottom: -2px;
    border-radius: 9999px;
    border: 1px solid var(--badge-color);
    opacity: 0;
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0% { transform: scale(1); opacity: 0.5; }
    70% { transform: scale(3); opacity: 0; }
    100% { transform: scale(3); opacity: 0; }
  }

  .count {
    font-size: 0.75rem;
    font-weight: 900;
    color: var(--badge-color);
    letter-spacing: -0.01em;
  }

  .label {
    font-size: 0.62rem;
    color: var(--color-text);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    opacity: 0.7;
  }
</style>

