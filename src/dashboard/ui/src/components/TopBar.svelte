<script lang="ts">
  import { healthData, theme, currentRepo, activeTab } from '../lib/stores';
  import { getRepoInitials } from '../lib/utils';

  export let onRefresh: () => void = () => {};
  export let onToggleMobileMenu: () => void = () => {};

  let countdownSeconds = 30;
  let countdownTimer: ReturnType<typeof setInterval>;

  function toggleTheme() {
    theme.update(t => t === 'dark' ? 'light' : 'dark');
  }

  function startCountdown() {
    clearInterval(countdownTimer);
    countdownSeconds = 30;
    countdownTimer = setInterval(() => {
      countdownSeconds--;
      if (countdownSeconds <= 0) {
        countdownSeconds = 30;
        onRefresh();
      }
    }, 1000);
  }

  function manualRefresh() {
    onRefresh();
    startCountdown();
  }

  $: countdownPct = (countdownSeconds / 30) * 100;
  $: countdownColor = countdownSeconds <= 5 ? '#ef4444' : countdownSeconds <= 10 ? '#f97316' : '#3b82f6';

  import { onMount, onDestroy } from 'svelte';
  onMount(() => startCountdown());
  onDestroy(() => clearInterval(countdownTimer));
</script>

<header class="top-bar glass-strong" style="border-bottom: 1px solid var(--color-border); z-index: 30;">
  <div class="flex items-center justify-between" style="padding: 10px 20px; min-height: 60px;">
    <!-- Left: Mobile menu + current repo -->
    <div class="flex items-center gap-3">
      <!-- Mobile hamburger -->
      <button
        class="btn btn-ghost btn-icon"
        on:click={onToggleMobileMenu}
        aria-label="Toggle menu"
        style="display:none;"
        id="mobileMenuBtn"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z"/>
        </svg>
      </button>

      {#if $currentRepo}
        <div class="flex items-center gap-2">
          <div style="width:30px;height:30px;border-radius:8px;background:linear-gradient(135deg,#0ea5e9,#6366f1);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;color:white;flex-shrink:0;">
            {getRepoInitials($currentRepo)}
          </div>
          <div>
            <div class="font-semibold" style="font-size:0.82rem;color:var(--color-text);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
              {$currentRepo}
            </div>
            {#if $healthData}
              <div style="font-size:0.65rem;color:var(--color-text-muted);">
                {$healthData.memoryCount} memories indexed
              </div>
            {/if}
          </div>
        </div>
      {:else}
        <div style="font-size:0.85rem;color:var(--color-text-muted);">Select a repository</div>
      {/if}
    </div>

    <!-- Right: status, countdown, theme toggle -->
    <div class="flex items-center gap-3">
      <!-- Connection status -->
      {#if $healthData}
        <div class="flex items-center gap-2">
          <div style="width:8px;height:8px;border-radius:9999px;background:{$healthData.connected ? '#10b981' : '#94a3b8'};box-shadow:{$healthData.connected ? '0 0 0 3px rgba(16,185,129,0.2)' : 'none'};"></div>
          <span style="font-size:0.72rem;font-weight:600;color:var(--color-text-muted);">
            {$healthData.connected ? 'Connected' : 'Disconnected'}
          </span>
          <span style="font-size:0.65rem;color:var(--color-text-muted);background:rgba(100,116,139,0.1);padding:1px 6px;border-radius:9999px;">
            v{$healthData.version}
          </span>
        </div>
      {/if}

      <!-- Countdown + Refresh -->
      <div class="flex items-center gap-2">
        <div style="display:flex;align-items:center;gap:6px;background:rgba(241,245,249,0.8);padding:5px 10px;border-radius:10px;border:1px solid var(--color-border);">
          <div style="width:52px;height:4px;background:rgba(148,163,184,0.2);border-radius:9999px;overflow:hidden;">
            <div style="height:100%;width:{countdownPct}%;background:{countdownColor};border-radius:9999px;transition:width 1s linear,background 0.3s;"></div>
          </div>
          <span style="font-size:0.65rem;font-weight:600;color:var(--color-text-muted);width:42px;">{countdownSeconds}s</span>
        </div>
        <button class="btn btn-ghost btn-icon btn-sm" on:click={manualRefresh} title="Refresh now" aria-label="Refresh">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
        </button>
      </div>

      <!-- Theme toggle -->
      <button
        class="btn btn-ghost btn-icon btn-sm"
        on:click={toggleTheme}
        title="Toggle theme"
        aria-label="Toggle theme"
      >
        {#if $theme === 'dark'}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364-.707.707M6.343 17.657l-.707.707m12.728 0-.707-.707M6.343 6.343l-.707-.707M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z"/>
          </svg>
        {:else}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
          </svg>
        {/if}
      </button>

      <!-- DB path -->
      {#if $healthData?.dbPath}
        <span style="font-size:0.65rem;color:var(--color-text-muted);max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title={$healthData.dbPath}>
          {$healthData.dbPath.split(/[/\\]/).pop()}
        </span>
      {/if}
    </div>
  </div>
</header>

<style>
  @media (max-width: 1024px) {
    #mobileMenuBtn { display: flex !important; }
  }
</style>
