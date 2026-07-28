<script lang="ts">
	import { healthData, currentRepo, availableRepos, theme, themePreference, chatRefreshSignal } from "../lib/stores";
	import { onMount, onDestroy } from "svelte";
	import { derived } from "svelte/store";
	import { createTopBarHandler } from "../lib/composables/useTopBar";
	import { arenaStateManager } from "../lib/arena/arenaStateManager";

	import TopBarRepoInfo from "./TopBarRepoInfo.svelte";
	import TopBarLinks from "./TopBarLinks.svelte";
	import TopBarActions from "./TopBarActions.svelte";

	export let onRefresh: () => void = () => {};
	export let onToggleMobileMenu: () => void = () => {};
	export let onEcosystem: () => void = () => {};

	const handler = createTopBarHandler(onRefresh);
	const {
		countdownSeconds,
		refreshing,
		npmDownloads,
		npmLoading,
		formatDownloads,
		toggleTheme,
		startCountdown,
		manualRefresh,
		getRepoInitials,
		destroy
	} = handler;

	const arenaMetrics = derived(arenaStateManager.getStore(), ($state) => {
		if ($state.metrics.successRate === 0 && $state.metrics.throughput === 0) return null;
		return $state.metrics;
	});

	$: countdownPct = ($countdownSeconds / 30) * 100;
	$: countdownColor = $countdownSeconds <= 5 ? "#ef4444" : $countdownSeconds <= 10 ? "#f97316" : "#0ea5e9";
	$: currentRepoData = $availableRepos.find((r) => r.repo === $currentRepo);

	onMount(() => {
		startCountdown();
	});

	$: if ($chatRefreshSignal) {
		manualRefresh();
	}

	onDestroy(() => destroy());
</script>

<header class="top-bar glass-strong" style="border-bottom: 1px solid var(--color-border); z-index: 30;">
	<div class="top-bar-inner">
		<!-- Left: Mobile menu + current repo -->
		<TopBarRepoInfo currentRepo={$currentRepo} repoData={currentRepoData} {getRepoInitials} />

		<!-- Right: external links, status, countdown, theme toggle -->
		<div class="top-actions">
			<TopBarLinks
				countdownSeconds={$countdownSeconds}
				{countdownPct}
				{countdownColor}
				npmDownloads={$npmDownloads}
				npmLoading={$npmLoading}
				{formatDownloads}
				refreshing={$refreshing}
				onManualRefresh={manualRefresh}
				{onEcosystem}
			/>

			<div class="top-separator"></div>

			<TopBarActions
				arenaMetrics={$arenaMetrics}
				healthData={$healthData}
				theme={$theme}
				themePreference={$themePreference}
				onToggleTheme={toggleTheme}
				{onToggleMobileMenu}
			/>
		</div>
	</div>
</header>

<style>
	.top-bar-inner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		min-height: 60px;
		padding: 10px 20px;
	}

	.top-actions {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}

	.top-separator {
		width: 1px;
		height: 20px;
		background: var(--color-border);
		opacity: 0.6;
	}

	@media (max-width: 760px) {
		.top-bar-inner {
			padding: 8px 12px;
		}

		.top-separator {
			display: none !important;
		}

		.top-actions {
			gap: 6px;
			flex-shrink: 0;
		}
	}
</style>
