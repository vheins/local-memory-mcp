<script lang="ts">
	import { healthData, currentRepo, availableRepos, theme, themePreference } from "../lib/stores";
	import Icon from "../lib/Icon.svelte";
	import { onMount, onDestroy } from "svelte";
	import { createTopBarHandler, GITHUB_URL, NPM_URL } from "../lib/composables/useTopBar";

	export let onRefresh: () => void = () => {};
	export let onToggleMobileMenu: () => void = () => {};

	const handler = createTopBarHandler(onRefresh);
	const {
		countdownSeconds,
		refreshing,
		npmDownloads,
		npmLoading,
		formatDownloads,
		fetchNpmDownloads,
		toggleTheme,
		startCountdown,
		manualRefresh,
		getRepoInitials,
		destroy
	} = handler;

	$: countdownPct = ($countdownSeconds / 30) * 100;
	$: countdownColor = $countdownSeconds <= 5 ? "#ef4444" : $countdownSeconds <= 10 ? "#f97316" : "#0ea5e9";
	$: currentRepoData = $availableRepos.find((r) => r.repo === $currentRepo);

	onMount(() => {
		startCountdown();
		fetchNpmDownloads();
	});

	onDestroy(() => destroy());
</script>

<header class="top-bar glass-strong" style="border-bottom: 1px solid var(--color-border); z-index: 30;">
	<div class="top-bar-inner">
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
				<div class="current-repo">
					<div
						style="width:30px;height:30px;border-radius:8px;background:linear-gradient(135deg,#0ea5e9,#6366f1);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px;color:white;flex-shrink:0;box-shadow:0 4px 10px rgba(14,165,233,0.28);"
					>
						{getRepoInitials($currentRepo)}
					</div>
					<div>
						<div class="font-semibold current-repo-name">
							{$currentRepo}
						</div>
						{#if currentRepoData}
							<div class="flex items-center gap-1" style="font-size:0.65rem;color:var(--color-text-muted);">
								<Icon name="database" size={10} strokeWidth={2} />
								<span>{currentRepoData.memoryCount || 0} memories</span>
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

		<!-- Right: external links, status, countdown, theme toggle -->
		<div class="top-actions">
			<!-- ── External Links Group ── -->
			<div class="ext-links-group">
				<!-- GitHub link -->
				<a
					href={GITHUB_URL}
					target="_blank"
					rel="noopener noreferrer"
					class="ext-link-btn"
					title="View on GitHub"
					aria-label="GitHub repository"
					id="githubLink"
				>
					<!-- GitHub SVG icon -->
					<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
						<path
							d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
						/>
					</svg>
					<span class="ext-link-label">GitHub</span>
				</a>

				<!-- Divider -->
				<div class="ext-link-divider"></div>

				<!-- Star button -->
				<a
					href="{GITHUB_URL}/stargazers"
					target="_blank"
					rel="noopener noreferrer"
					class="ext-link-btn ext-link-star"
					title="Star on GitHub"
					aria-label="Star on GitHub"
					id="githubStarBtn"
				>
					<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
						<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
					</svg>
					<span class="ext-link-label">Star</span>
				</a>

				<!-- Divider -->
				<div class="ext-link-divider"></div>

				<!-- npm link + downloads -->
				<a
					href={NPM_URL}
					target="_blank"
					rel="noopener noreferrer"
					class="ext-link-btn ext-link-npm"
					title="View on npm"
					aria-label="npm package"
					id="npmLink"
				>
					<!-- npm SVG wordmark -->
					<svg width="18" height="11" viewBox="0 0 18 7" fill="currentColor" aria-hidden="true">
						<path d="M0 0h18v6H9V7H5V6H0V0zm1 5h2V1h1v4h1V1h1v5h4V1h1v4h1V1h1v4h1V1h2v5H1V5z" />
					</svg>
					{#if $npmLoading}
						<span class="ext-link-label npm-dl-skeleton"></span>
					{:else if $npmDownloads !== null}
						<span class="ext-link-label npm-dl-badge">
							<svg
								width="10"
								height="10"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2.5"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
							>
								<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
							</svg>
							{formatDownloads($npmDownloads)}/mo
						</span>
					{:else}
						<span class="ext-link-label">npm</span>
					{/if}
				</a>
			</div>

			<!-- Separator -->
			<div class="top-separator"></div>

			<!-- Connection status -->
			{#if $healthData}
				<div class="top-status">
					<div class="status-dot status-dot-online"></div>
					<span style="font-size:0.72rem;font-weight:600;color:var(--color-text-muted);"> Online </span>
					<span
						style="font-size:0.65rem;color:var(--color-text-muted);background:rgba(100,116,139,0.1);padding:1px 6px;border-radius:9999px;border:1px solid rgba(100,116,139,0.15);"
					>
						v{$healthData.version}
					</span>
				</div>
			{/if}

			<!-- Countdown + Refresh -->
			<div class="refresh-group">
				<div class="countdown-bar">
					<div class="countdown-track">
						<div class="countdown-fill" style="width:{countdownPct}%;background:{countdownColor};"></div>
					</div>
					<span class="countdown-label" style="color:{$countdownSeconds <= 5 ? '#ef4444' : 'var(--color-text-muted)'};"
						>{$countdownSeconds}s</span
					>
				</div>
				<button
					class="btn btn-ghost btn-icon btn-sm"
					class:refreshing={$refreshing}
					on:click={manualRefresh}
					title="Refresh now"
					aria-label="Refresh"
				>
					<span class:animate-spin={$refreshing}>
						<Icon name="refresh-cw" size={14} strokeWidth={2.5} />
					</span>
				</button>
			</div>

			<!-- Theme toggle -->
			<button
				class="btn btn-ghost btn-icon btn-sm"
				on:click={toggleTheme}
				title={$themePreference === "auto" ? "Theme: auto (Shift+click for manual)" : "Theme: manual (Shift+click for auto)"}
				aria-label="Toggle theme"
			>
				{#if $theme === "dark"}
					<Icon name="sun" size={16} strokeWidth={1.75} />
				{:else}
					<Icon name="moon" size={16} strokeWidth={1.75} />
				{/if}
			</button>

			<!-- DB path -->
			{#if $healthData?.dbPath}
				<span
					class="db-path-label flex items-center gap-1"
					style="font-size:0.65rem;color:var(--color-text-muted);max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
					title={$healthData.dbPath}
				>
					<Icon name="database" size={10} strokeWidth={2} />
					{$healthData.dbPath.split(/[/\\]/).pop()}
				</span>
			{/if}
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

	.current-repo {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}

	.current-repo-name {
		color: var(--color-text);
		font-size: 0.82rem;
		max-width: 200px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.top-actions,
	.refresh-group,
	.top-status {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.top-actions {
		min-width: 0;
	}

	.top-separator {
		width: 1px;
		height: 20px;
		background: var(--color-border);
		opacity: 0.6;
	}

	@media (max-width: 1024px) {
		#mobileMenuBtn {
			display: flex !important;
		}
	}

	@media (max-width: 760px) {
		.top-bar-inner {
			padding: 8px 12px;
		}

		.current-repo-name {
			max-width: 112px;
		}

		.ext-links-group,
		.top-separator,
		.db-path-label,
		.top-status span {
			display: none !important;
		}

		.top-actions {
			gap: 6px;
			flex-shrink: 0;
		}
	}

	@media (max-width: 420px) {
		.current-repo-name {
			max-width: 82px;
		}
	}

	/* ── External Links Group ── */
	.ext-links-group {
		display: flex;
		align-items: center;
		gap: 0;
		background: rgba(241, 245, 249, 0.75);
		border: 1px solid var(--color-border);
		border-radius: 10px;
		overflow: hidden;
		backdrop-filter: blur(8px);
	}

	:global(html.dark) .ext-links-group {
		background: rgba(15, 23, 42, 0.75);
		border-color: rgba(148, 163, 184, 0.12);
	}

	.ext-link-btn {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 5px 10px;
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--color-text-muted);
		text-decoration: none;
		transition:
			background 0.15s ease,
			color 0.15s ease;
		white-space: nowrap;
		line-height: 1;
	}

	.ext-link-btn:hover {
		background: rgba(14, 165, 233, 0.08);
		color: var(--color-text);
	}

	:global(html.dark) .ext-link-btn:hover {
		background: rgba(14, 165, 233, 0.12);
	}

	.ext-link-star:hover {
		background: rgba(234, 179, 8, 0.1) !important;
		color: #ca8a04 !important;
	}

	:global(html.dark) .ext-link-star:hover {
		background: rgba(234, 179, 8, 0.12) !important;
		color: #fbbf24 !important;
	}

	.ext-link-npm:hover {
		background: rgba(203, 36, 49, 0.08) !important;
		color: #cb2431 !important;
	}

	:global(html.dark) .ext-link-npm:hover {
		background: rgba(203, 36, 49, 0.12) !important;
		color: #f87171 !important;
	}

	.ext-link-divider {
		width: 1px;
		height: 20px;
		background: var(--color-border);
		opacity: 0.6;
		flex-shrink: 0;
	}

	.ext-link-label {
		font-size: 0.7rem;
	}

	/* npm download badge */
	.npm-dl-badge {
		display: flex;
		align-items: center;
		gap: 3px;
		color: inherit;
	}

	.npm-dl-skeleton {
		display: inline-block;
		width: 36px;
		height: 10px;
		border-radius: 4px;
		background: rgba(148, 163, 184, 0.18);
		animation: skeleton-pulse 1.4s ease-in-out infinite;
	}

	@keyframes skeleton-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.4;
		}
	}

	/* ── Countdown ── */
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
		transition:
			width 1s linear,
			background 0.3s;
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

	/* hide external links on very small screens */
	@media (max-width: 640px) {
		.ext-links-group {
			display: none;
		}
	}

	@media (max-width: 760px) {
		.countdown-bar {
			padding: 5px 8px;
		}

		.countdown-track {
			width: 32px;
		}
	}

	@media (max-width: 420px) {
		.countdown-label {
			display: none;
		}
	}
</style>
