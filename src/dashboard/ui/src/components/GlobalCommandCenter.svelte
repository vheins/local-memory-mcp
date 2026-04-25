<script lang="ts">
	import { derived } from "svelte/store";
	import { globalDashboardStats, globalTaskTimeStats, currentRepo } from "../lib/stores";
	import Icon from "../lib/Icon.svelte";
	import { formatDate, formatTokens } from "../lib/utils";

	const summaryCards = derived(globalDashboardStats, ($stats) => [
		{
			label: "Repositories",
			value: $stats?.repoCount ?? 0,
			icon: "database",
			color: "#0ea5e9",
			tint: "rgba(14,165,233,0.12)"
		},
		{
			label: "Active Repos",
			value: $stats?.activeRepoCount ?? 0,
			icon: "activity",
			color: "#8b5cf6",
			tint: "rgba(139,92,246,0.12)"
		},
		{
			label: "Open Tasks",
			value:
				(($stats?.taskStats?.pending ?? 0) +
					($stats?.taskStats?.in_progress ?? 0) +
					($stats?.taskStats?.blocked ?? 0) +
					($stats?.taskStats?.backlog ?? 0)),
			icon: "clipboard-list",
			color: "#f59e0b",
			tint: "rgba(245,158,11,0.12)"
		},
		{
			label: "Active Claims",
			value: $stats?.coordination?.activeClaims ?? 0,
			icon: "check",
			color: "#10b981",
			tint: "rgba(16,185,129,0.12)"
		},
		{
			label: "Pending Handoffs",
			value: $stats?.coordination?.pendingHandoffs ?? 0,
			icon: "git-branch",
			color: "#6366f1",
			tint: "rgba(99,102,241,0.12)"
		},
		{
			label: "Blocked Tasks",
			value: $stats?.taskStats?.blocked ?? 0,
			icon: "triangle-alert",
			color: "#ef4444",
			tint: "rgba(239,68,68,0.12)"
		}
	]);

	const coordinationCards = derived(globalDashboardStats, ($stats) => [
		{ label: "Agents Claiming", value: $stats?.coordination?.agentsClaiming ?? 0, accent: "#10b981" },
		{ label: "Unassigned Handoffs", value: $stats?.coordination?.unassignedHandoffs ?? 0, accent: "#f97316" },
		{ label: "Stale Claims", value: $stats?.coordination?.staleClaims ?? 0, accent: "#ef4444" },
		{ label: "Stale Handoffs", value: $stats?.coordination?.staleHandoffs ?? 0, accent: "#e11d48" }
	]);

	const throughputCards = derived(globalTaskTimeStats, ($stats) => [
		{
			label: "Today Done",
			value: $stats?.daily?.completed ?? 0,
			icon: "circle-check",
			color: "#10b981"
		},
		{
			label: "Today Added",
			value: $stats?.daily?.added ?? 0,
			icon: "plus",
			color: "#0ea5e9"
		},
		{
			label: "7d Done",
			value: $stats?.weekly?.completed ?? 0,
			icon: "bar-chart",
			color: "#8b5cf6"
		},
		{
			label: "7d Tokens",
			value: formatTokens($stats?.weekly?.tokens),
			icon: "cpu",
			color: "#f59e0b"
		}
	]);

	$: repoRows = ($globalDashboardStats?.repos ?? []).slice(0, 8);
	$: highlightedRepo = $currentRepo ? repoRows.find((repo) => repo.repo === $currentRepo) : null;

	function repoPressure(repo: (typeof repoRows)[number]) {
		return (
			repo.blockedCount * 5 +
			repo.inProgressCount * 3 +
			repo.pendingCount * 2 +
			repo.pendingHandoffs * 2 +
			repo.activeClaims
		);
	}
</script>

<div class="global-shell animate-fade-in">
	<div class="glass card panel-card">
		<div class="panel-header">
			<div>
				<div class="section-label">Global Command Center</div>
				<div class="panel-copy">Cross-repository orchestration view for workload, coordination, and pressure.</div>
			</div>
			{#if highlightedRepo}
				<div class="repo-focus">
					<Icon name="pin" size={12} strokeWidth={2} />
					<span>Focused repo: {$currentRepo}</span>
				</div>
			{/if}
		</div>

		<div class="summary-grid">
			{#each $summaryCards as card (card.label)}
				<div class="summary-card" style="background:{card.tint};border-color:{card.tint};">
					<div class="summary-icon" style="color:{card.color};">
						<Icon name={card.icon} size={14} strokeWidth={1.9} />
					</div>
					<div class="summary-value" style="color:{card.color};">{card.value}</div>
					<div class="summary-label">{card.label}</div>
				</div>
			{/each}
		</div>
	</div>

	<div class="grid-two">
		<div class="glass card panel-card">
			<div class="subheading">Coordination</div>
			<div class="mini-grid">
				{#each $coordinationCards as card (card.label)}
					<div class="mini-card">
						<div class="mini-value" style="color:{card.accent};">{card.value}</div>
						<div class="mini-label">{card.label}</div>
					</div>
				{/each}
			</div>
		</div>

		<div class="glass card panel-card">
			<div class="subheading">Throughput</div>
			<div class="mini-grid">
				{#each $throughputCards as card (card.label)}
					<div class="mini-card">
						<div class="mini-icon" style="color:{card.color};">
							<Icon name={card.icon} size={12} strokeWidth={2} />
						</div>
						<div class="mini-value" style="color:{card.color};">{card.value}</div>
						<div class="mini-label">{card.label}</div>
					</div>
				{/each}
			</div>
		</div>
	</div>

	<div class="glass card panel-card">
		<div class="panel-header">
			<div>
				<div class="subheading">Attention Board</div>
				<div class="panel-copy">Repos sorted by operational pressure: blocked work, active execution, pending queue, and coordination load.</div>
			</div>
		</div>

		{#if repoRows.length === 0}
			<div class="empty-state">No repository activity yet.</div>
		{:else}
			<div class="repo-table">
				<div class="repo-table-head">
					<span>Repository</span>
					<span>Pressure</span>
					<span>Workload</span>
					<span>Coordination</span>
					<span>Last Activity</span>
				</div>
				{#each repoRows as repo (repo.repo)}
					<div class:selected={$currentRepo === repo.repo} class="repo-table-row">
						<div class="repo-main">
							<div class="repo-name">{repo.repo}</div>
							<div class="repo-meta">{repo.memoryCount} memories • {repo.taskCount} tasks</div>
						</div>
						<div class="pressure-pill">{repoPressure(repo)}</div>
						<div class="repo-stats">
							<span class="stat-chip active">A {repo.inProgressCount}</span>
							<span class="stat-chip pending">P {repo.pendingCount}</span>
							<span class="stat-chip blocked">B {repo.blockedCount}</span>
							<span class="stat-chip backlog">Q {repo.backlogCount}</span>
						</div>
						<div class="repo-stats">
							<span class="stat-chip claim">C {repo.activeClaims}</span>
							<span class="stat-chip handoff">H {repo.pendingHandoffs}</span>
							{#if repo.unassignedHandoffs > 0}
								<span class="stat-chip stale">U {repo.unassignedHandoffs}</span>
							{/if}
							{#if repo.staleClaims > 0}
								<span class="stat-chip stale">S {repo.staleClaims}</span>
							{/if}
						</div>
						<div class="last-activity">{repo.lastActivity ? formatDate(repo.lastActivity) : "—"}</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.global-shell { display: flex; flex-direction: column; gap: 14px; }
	.panel-card { padding: 16px; }
	.panel-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
	.panel-copy { color: var(--color-text-muted); font-size: 0.76rem; line-height: 1.45; max-width: 620px; }
	.repo-focus {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 10px;
		border-radius: 999px;
		background: rgba(99,102,241,0.08);
		border: 1px solid rgba(99,102,241,0.16);
		color: #6366f1;
		font-size: 0.68rem;
		font-weight: 800;
	}
	.summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
	.summary-card { border: 1px solid var(--color-border); border-radius: 14px; padding: 12px 10px; text-align: center; }
	.summary-icon { display: flex; justify-content: center; margin-bottom: 4px; opacity: 0.85; }
	.summary-value { font-size: 1.45rem; font-weight: 900; line-height: 1; letter-spacing: -0.04em; }
	.summary-label { font-size: 0.62rem; color: var(--color-text-muted); font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; margin-top: 4px; }
	.grid-two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
	.subheading { font-size: 0.72rem; color: var(--color-text); font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 10px; }
	.mini-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
	.mini-card { border: 1px solid var(--color-border); border-radius: 12px; padding: 12px; background: rgba(255,255,255,0.03); }
	.mini-icon { margin-bottom: 6px; opacity: 0.8; }
	.mini-value { font-size: 1.2rem; font-weight: 900; line-height: 1; letter-spacing: -0.03em; }
	.mini-label { font-size: 0.64rem; color: var(--color-text-muted); font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; margin-top: 4px; }
	.repo-table { display: flex; flex-direction: column; gap: 8px; }
	.repo-table-head, .repo-table-row {
		display: grid;
		grid-template-columns: minmax(180px, 1.4fr) 90px minmax(190px, 1.2fr) minmax(180px, 1.2fr) 110px;
		gap: 12px;
		align-items: center;
	}
	.repo-table-head {
		padding: 0 10px 6px;
		font-size: 0.62rem;
		color: var(--color-text-muted);
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.repo-table-row {
		padding: 12px 10px;
		border: 1px solid var(--color-border);
		border-radius: 12px;
		background: rgba(255,255,255,0.04);
	}
	.repo-table-row.selected {
		border-color: rgba(99,102,241,0.28);
		background: rgba(99,102,241,0.06);
	}
	.repo-name { font-size: 0.84rem; font-weight: 800; color: var(--color-text); }
	.repo-meta, .last-activity { font-size: 0.68rem; color: var(--color-text-muted); font-weight: 600; }
	.pressure-pill {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 56px;
		padding: 6px 10px;
		border-radius: 999px;
		background: rgba(239,68,68,0.08);
		border: 1px solid rgba(239,68,68,0.16);
		color: #ef4444;
		font-size: 0.78rem;
		font-weight: 900;
	}
	.repo-stats { display: flex; flex-wrap: wrap; gap: 6px; }
	.stat-chip {
		display: inline-flex;
		align-items: center;
		padding: 3px 7px;
		border-radius: 999px;
		font-size: 0.62rem;
		font-weight: 800;
		border: 1px solid transparent;
	}
	.stat-chip.active { color: #8b5cf6; background: rgba(139,92,246,0.1); border-color: rgba(139,92,246,0.16); }
	.stat-chip.pending { color: #0ea5e9; background: rgba(14,165,233,0.1); border-color: rgba(14,165,233,0.16); }
	.stat-chip.blocked { color: #ef4444; background: rgba(239,68,68,0.1); border-color: rgba(239,68,68,0.16); }
	.stat-chip.backlog { color: #64748b; background: rgba(100,116,139,0.1); border-color: rgba(100,116,139,0.16); }
	.stat-chip.claim { color: #10b981; background: rgba(16,185,129,0.1); border-color: rgba(16,185,129,0.16); }
	.stat-chip.handoff { color: #6366f1; background: rgba(99,102,241,0.1); border-color: rgba(99,102,241,0.16); }
	.stat-chip.stale { color: #f97316; background: rgba(249,115,22,0.1); border-color: rgba(249,115,22,0.16); }
	.empty-state {
		min-height: 120px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text-muted);
		font-size: 0.82rem;
	}
	@media (max-width: 1080px) {
		.grid-two, .mini-grid { grid-template-columns: 1fr; }
		.repo-table-head { display: none; }
		.repo-table-row {
			grid-template-columns: 1fr;
			align-items: flex-start;
		}
	}
</style>
