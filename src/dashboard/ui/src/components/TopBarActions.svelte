<script lang="ts">
	import Icon from "../lib/Icon.svelte";
	import type { Theme, HealthData } from "../lib/stores";

	export let arenaMetrics: {
		successRate: number;
		throughput: number;
		agentUtilization: number;
		queueDepth: number;
	} | null = null;
	export let healthData: HealthData | null = null;
	export let theme: Theme = "light";
	export let themePreference: string = "auto";
	export let onToggleTheme: (e?: MouseEvent) => void = () => {};
	export let onToggleMobileMenu: () => void = () => {};
</script>

<button
	class="btn btn-ghost btn-icon"
	on:click={onToggleMobileMenu}
	aria-label="Toggle menu"
	id="mobileMenuBtn"
	style="display:none;"
>
	<Icon name="menu" size={18} strokeWidth={2} />
</button>

<!-- Arena Metrics (only when arena data available) -->
{#if arenaMetrics}
	<div class="arena-metrics">
		<div class="metric-tile">
			<span
				class="metric-value"
				class:text-green={arenaMetrics.successRate > 90}
				class:text-yellow={arenaMetrics.successRate >= 70 && arenaMetrics.successRate <= 90}
				class:text-red={arenaMetrics.successRate < 70}
			>
				{arenaMetrics.successRate.toFixed(1)}%
			</span>
			<span class="metric-label">Success</span>
		</div>
		<div class="metric-divider"></div>
		<div class="metric-tile">
			<span class="metric-value">{arenaMetrics.throughput.toFixed(1)}</span>
			<span class="metric-label">Tasks/min</span>
		</div>
		<div class="metric-divider"></div>
		<div class="metric-tile">
			<span class="metric-value">{arenaMetrics.agentUtilization.toFixed(0)}%</span>
			<span class="metric-label">Agents</span>
		</div>
		<div class="metric-divider"></div>
		<div class="metric-tile">
			<span class="metric-value">{arenaMetrics.queueDepth}</span>
			<span class="metric-label">Queue</span>
		</div>
	</div>
{/if}

<!-- Connection status -->
{#if healthData}
	<div class="top-status">
		<div class="status-dot status-dot-online"></div>
		<span style="font-size:0.72rem;font-weight:600;color:var(--color-text-muted);"> Online </span>
		<span
			style="font-size:0.65rem;color:var(--color-text-muted);background:rgba(100,116,139,0.1);padding:1px 6px;border-radius:9999px;border:1px solid rgba(100,116,139,0.15);"
		>
			v{healthData.version}
		</span>
	</div>
{/if}

<!-- Theme toggle -->
<button
	class="btn btn-ghost btn-icon btn-sm"
	on:click={onToggleTheme}
	title={themePreference === "auto" ? "Theme: auto (Shift+click for manual)" : "Theme: manual (Shift+click for auto)"}
	aria-label="Toggle theme"
>
	{#if theme === "dark"}
		<Icon name="sun" size={16} strokeWidth={1.75} />
	{:else}
		<Icon name="moon" size={16} strokeWidth={1.75} />
	{/if}
</button>

<!-- DB path -->
{#if healthData?.dbPath}
	<span
		class="db-path-label flex items-center gap-1"
		style="font-size:0.65rem;color:var(--color-text-muted);max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
		title={healthData.dbPath}
	>
		<Icon name="database" size={10} strokeWidth={2} />
		{healthData.dbPath.split(/[/\\]/).pop()}
	</span>
{/if}

<style>
	.top-status {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.arena-metrics {
		display: flex;
		align-items: center;
		gap: 0;
		background: rgba(241, 245, 249, 0.75);
		border: 1px solid var(--color-border);
		border-radius: 10px;
		padding: 4px 8px;
		backdrop-filter: blur(8px);
	}

	:global(html.dark) .arena-metrics {
		background: rgba(15, 23, 42, 0.75);
		border-color: rgba(148, 163, 184, 0.12);
	}

	.metric-tile {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 2px 8px;
		min-width: 48px;
	}

	.metric-value {
		font-size: 0.82rem;
		font-weight: 800;
		font-family: "JetBrains Mono", monospace;
		color: var(--color-text);
		line-height: 1.2;
	}

	.metric-label {
		font-size: 0.55rem;
		font-weight: 700;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.metric-divider {
		width: 1px;
		height: 24px;
		background: var(--color-border);
		opacity: 0.5;
	}

	.text-green {
		color: #22c55e;
	}

	.text-yellow {
		color: #eab308;
	}

	.text-red {
		color: #ef4444;
	}

	@media (max-width: 760px) {
		.db-path-label,
		.top-status span,
		.arena-metrics {
			display: none !important;
		}
	}
</style>
