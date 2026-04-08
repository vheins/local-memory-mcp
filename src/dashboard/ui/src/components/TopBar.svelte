<script lang="ts">
  import { healthData, theme, currentRepo, activeTab, availableRepos } from '../lib/stores';
  import { getRepoInitials } from '../lib/utils';
  import Icon from '../lib/Icon.svelte';

  export let onRefresh: () => void = () => {};
  export let onToggleMobileMenu: () => void = () => {};

  let countdownSeconds = 30;
  let countdownTimer: ReturnType<typeof setInterval>;
  let refreshing = false;

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

  async function manualRefresh() {
    refreshing = true;
    onRefresh();
    startCountdown();
    setTimeout(() => refreshing = false, 800);
  }

  $: countdownPct = (countdownSeconds / 30) * 100;
  $: countdownColor = countdownSeconds <= 5 ? '#ef4444' : countdownSeconds <= 10 ? '#f97316' : '#0ea5e9';
  $: currentRepoData = $availableRepos.find(r => r.repo === $currentRepo);

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
        <Icon name="menu" size={18} strokeWidth={2} />
      </button>

      {#if $currentRepo}
        <div class="flex items-center gap-2">
          <div style="width:30px;height:30px;border-radius:8px;background:linear-gradient(135deg,#0ea5e9,#6366f1);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px;color:white;flex-shrink:0;box-shadow:0 4px 10px rgba(14,165,233,0.28);">
            {getRepoInitials($currentRepo)}
          </div>
          <div>
            <div class="font-semibold" style="font-size:0.82rem;color:var(--color-text);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
              {$currentRepo}
            </div>
            {#if currentRepoData}
              <div class="flex items-center gap-1" style="font-size:0.65rem;color:var(--color-text-muted);">
                <Icon name="database" size={10} strokeWidth={2} />
                <span>{currentRepoData.memory_count || 0} memories</span>
              </div>
            {/if}
          </div>
        </div>
      {:else}
        <div style="font-size:0.85rem;color:var(--color-text-muted);" class="flex items-center gap-2">
          <Icon name="brain" size={14} strokeWidth={1.75} />
          <span>Select a repository</span>
        </div>
      {/if}
    </div>

    <!-- Right: status, countdown, theme toggle -->
    <div class="flex items-center gap-3">
      <!-- Connection status -->
      {#if $healthData}
        <div class="flex items-center gap-2">
          <div class="status-dot status-dot-online"></div>
          <span style="font-size:0.72rem;font-weight:600;color:var(--color-text-muted);">
            Online
          </span>
          <span style="font-size:0.65rem;color:var(--color-text-muted);background:rgba(100,116,139,0.1);padding:1px 6px;border-radius:9999px;border:1px solid rgba(100,116,139,0.15);">
            v{$healthData.version}
          </span>
        </div>
      {/if}

      <!-- Countdown + Refresh -->
      <div class="flex items-center gap-2">
        <div class="countdown-bar">
          <div class="countdown-track">
            <div class="countdown-fill" style="width:{countdownPct}%;background:{countdownColor};"></div>
          </div>
          <span class="countdown-label" style="color:{countdownSeconds <= 5 ? '#ef4444' : 'var(--color-text-muted)'};">{countdownSeconds}s</span>
        </div>
        <button
          class="btn btn-ghost btn-icon btn-sm"
          class:refreshing
          on:click={manualRefresh}
          title="Refresh now"
          aria-label="Refresh"
        >
          <span class:animate-spin={refreshing}>
            <Icon name="refresh-cw" size={14} strokeWidth={2.5} />
          </span>
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
          <Icon name="sun" size={16} strokeWidth={1.75} />
        {:else}
          <Icon name="moon" size={16} strokeWidth={1.75} />
        {/if}
      </button>

      <!-- DB path -->
      {#if $healthData?.dbPath}
        <span class="flex items-center gap-1" style="font-size:0.65rem;color:var(--color-text-muted);max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title={$healthData.dbPath}>
          <Icon name="database" size={10} strokeWidth={2} />
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

  .countdown-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    background: rgba(241, 245, 249, 0.75);
    padding: 5px 10px;
    border-radius: 10px;
    border: 1px solid var(--color-border);
    backdrop-filter: blur(8px);
  }

  :global(html.dark) .countdown-bar {
    background: rgba(15, 23, 42, 0.75);
    border-color: rgba(148, 163, 184, 0.12);
  }

  .countdown-track {
    width: 52px;
    height: 3px;
    background: rgba(148, 163, 184, 0.18);
    border-radius: 9999px;
    overflow: hidden;
  }

  .countdown-fill {
    height: 100%;
    border-radius: 9999px;
    transition: width 1s linear, background 0.3s;
  }

  .countdown-label {
    font-size: 0.65rem;
    font-weight: 600;
    width: 26px;
    transition: color 0.3s;
  }

  .btn.refreshing {
    color: var(--color-primary);
  }
</style>
