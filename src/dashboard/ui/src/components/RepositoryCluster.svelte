<script lang="ts">
	import Icon from "../lib/Icon.svelte";
	import type { VisualRepository } from "../lib/arena/arenaTypes";

	export let repositories: Map<string, VisualRepository> = new Map();
	export let collapsed: boolean = true;

	let expandedRepo: string | null = null;

	$: repoList = Array.from(repositories.values());

	function toggleRepo(repoId: string) {
		expandedRepo = expandedRepo === repoId ? null : repoId;
	}

	function getHealthColor(health: string): string {
		switch (health) {
			case "healthy":
				return "#22C55E";
			case "degraded":
				return "#EAB308";
			case "critical":
				return "#EF4444";
			default:
				return "#9CA3AF";
		}
	}

	function getHealthText(health: string): string {
		switch (health) {
			case "healthy":
				return "Healthy";
			case "degraded":
				return "Degraded";
			case "critical":
				return "Critical";
			default:
				return "Unknown";
		}
	}

	function formatDuration(seconds: number): string {
		if (!seconds || seconds <= 0) return "N/A";
		if (seconds < 60) return `${Math.round(seconds)}s`;
		const mins = Math.floor(seconds / 60);
		const secs = Math.round(seconds % 60);
		return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
	}
</script>

{#if repoList.length > 0}
	<div class="repo-cluster glass" class:collapsed>
		<button class="cluster-header" on:click={() => (collapsed = !collapsed)}>
			<div class="header-left">
				<Icon name="folder" size={13} strokeWidth={1.75} />
				<span class="header-title">Repositories</span>
				<span class="repo-count">{repoList.length}</span>
			</div>
			<Icon name={collapsed ? "chevron-up" : "chevron-down"} size={11} />
		</button>

		{#if !collapsed}
			<div class="cluster-body">
				<div class="repo-strip">
					{#each repoList as repo (repo.id)}
						<div class="repo-card-wrapper" class:expanded={expandedRepo === repo.id}>
							<button class="repo-item" on:click={() => toggleRepo(repo.id)} title={repo.fullName}>
								<div class="repo-icon" style="background: linear-gradient(135deg, #0ea5e9, #6366f1);">
									{repo.name.charAt(0).toUpperCase()}
								</div>
								<div class="repo-info">
									<span class="repo-name">{repo.name}</span>
									<span
										class="repo-health-dot"
										style="background: {getHealthColor(repo.health)}"
										title="Health: {getHealthText(repo.health)}"
									></span>
								</div>
								<div class="repo-stats">
									<span class="stat" title="Active agents">
										<Icon name="users" size={9} strokeWidth={2} />
										{repo.activeAgents}
									</span>
									<span class="stat" title="Branches">
										<Icon name="git-branch" size={9} strokeWidth={2} />
										{repo.activeBranches}
									</span>
									{#if repo.runningWorkflows > 0}
										<span class="stat" title="Workflows">
											<Icon name="refresh-cw" size={9} strokeWidth={2} />
											{repo.runningWorkflows}
										</span>
									{/if}
									{#if repo.lockedFiles.length > 0}
										<span class="stat lock-warning" title="Locked files">
											<Icon name="lock" size={9} strokeWidth={2} />
											{repo.lockedFiles.length}
										</span>
									{/if}
								</div>
							</button>

							{#if expandedRepo === repo.id}
								<div class="repo-expanded-details animate-fade-in">
									<div class="detail-section">
										<div class="section-title">Task Distribution</div>
										<div class="detail-grid">
											<div class="detail-metric">
												<span class="metric-label">Pending</span>
												<span class="metric-value">{repo.tasksPending}</span>
											</div>
											<div class="detail-metric">
												<span class="metric-label">In Progress</span>
												<span class="metric-value">{repo.tasksInProgress}</span>
											</div>
											<div class="detail-metric">
												<span class="metric-label">Blocked</span>
												<span class="metric-value text-red" class:has-blocked={repo.tasksBlocked > 0}
													>{repo.tasksBlocked}</span
												>
											</div>
										</div>
									</div>

									<div class="detail-section">
										<div class="section-title">Git & CI/CD</div>
										<div class="detail-grid">
											<div class="detail-metric">
												<span class="metric-label">Active PRs</span>
												<span class="metric-value">{repo.activePRs}</span>
											</div>
											<div class="detail-metric">
												<span class="metric-label">Merge Queue</span>
												<span class="metric-value">{repo.mergeQueueLength}</span>
											</div>
											<div class="detail-metric">
												<span class="metric-label">Workflows</span>
												<span class="metric-value">{repo.runningWorkflows}</span>
											</div>
										</div>
									</div>

									<div class="detail-section">
										<div class="section-title">Metrics</div>
										<div class="detail-grid">
											<div class="detail-metric">
												<span class="metric-label">Utilization</span>
												<span class="metric-value">{Math.round(repo.utilizationPercent)}%</span>
											</div>
											<div class="detail-metric">
												<span class="metric-label">Avg Duration</span>
												<span class="metric-value">{formatDuration(repo.avgTaskDuration)}</span>
											</div>
											<div class="detail-metric">
												<span class="metric-label">Failures</span>
												<span class="metric-value text-red" class:has-failures={repo.recentFailures > 0}
													>{repo.recentFailures}</span
												>
											</div>
										</div>
									</div>

									{#if repo.lockedFiles.length > 0}
										<div class="detail-section full-width">
											<div class="section-title text-orange"><Icon name="lock" size={10} /> Locked Files</div>
											<div class="locked-files-list">
												{#each repo.lockedFiles as file}
													<div class="locked-file-item" title={file}>
														<Icon name="file-text" size={10} />
														<span class="file-path">{file}</span>
													</div>
												{/each}
											</div>
										</div>
									{/if}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/if}
	</div>
{/if}

<style>
	.repo-cluster {
		width: 100%;
		border-top: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.01);
		display: flex;
		flex-direction: column;
		user-select: none;
	}

	.repo-cluster.collapsed {
		border-bottom: none;
	}

	.cluster-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 20px;
		background: rgba(255, 255, 255, 0.02);
		border: none;
		border-bottom: 1px solid var(--color-border);
		cursor: pointer;
		color: var(--color-text);
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		width: 100%;
		text-align: left;
		transition: background 0.2s ease;
	}

	.cluster-header:hover {
		background: rgba(255, 255, 255, 0.04);
		color: var(--color-primary);
	}

	.header-left {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.header-title {
		color: var(--color-text-muted);
	}

	.cluster-header:hover .header-title {
		color: var(--color-text);
	}

	.repo-count {
		background: rgba(148, 163, 184, 0.12);
		color: var(--color-text-muted);
		font-size: 0.65rem;
		padding: 1px 6px;
		border-radius: 999px;
		font-weight: 800;
	}

	.cluster-body {
		padding: 14px 20px;
		background: rgba(0, 0, 0, 0.05);
		overflow-x: auto;
	}

	.repo-strip {
		display: flex;
		flex-direction: column;
		gap: 10px;
		width: 100%;
	}

	.repo-card-wrapper {
		display: flex;
		flex-direction: column;
		background: rgba(255, 255, 255, 0.015);
		border: 1px solid rgba(148, 163, 184, 0.08);
		border-radius: 12px;
		overflow: hidden;
		transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
	}

	.repo-card-wrapper:hover {
		border-color: rgba(99, 102, 241, 0.25);
		background: rgba(255, 255, 255, 0.025);
	}

	.repo-card-wrapper.expanded {
		border-color: rgba(99, 102, 241, 0.4);
		background: rgba(255, 255, 255, 0.035);
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
	}

	.repo-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 14px;
		background: none;
		border: none;
		width: 100%;
		cursor: pointer;
		text-align: left;
		color: var(--color-text);
		gap: 16px;
	}

	.repo-icon {
		width: 28px;
		height: 28px;
		border-radius: 8px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: white;
		font-weight: 800;
		font-size: 0.78rem;
		flex-shrink: 0;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
	}

	.repo-info {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-grow: 1;
		min-width: 0;
	}

	.repo-name {
		font-weight: 700;
		font-size: 0.82rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.repo-health-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex-shrink: 0;
		box-shadow: 0 0 6px currentColor;
	}

	.repo-stats {
		display: flex;
		align-items: center;
		gap: 14px;
		flex-shrink: 0;
	}

	.stat {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 0.72rem;
		color: var(--color-text-muted);
		font-weight: 600;
		background: rgba(148, 163, 184, 0.06);
		padding: 3px 8px;
		border-radius: 6px;
		border: 1px solid rgba(148, 163, 184, 0.05);
	}

	.stat :global(svg) {
		opacity: 0.7;
	}

	.stat.lock-warning {
		color: #f97316;
		background: rgba(249, 115, 22, 0.08);
		border-color: rgba(249, 115, 22, 0.15);
		animation: pulse-orange 2s infinite;
	}

	.repo-expanded-details {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 14px;
		padding: 12px 14px 16px;
		border-top: 1px solid rgba(148, 163, 184, 0.08);
		background: rgba(0, 0, 0, 0.1);
	}

	.detail-section {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.detail-section.full-width {
		grid-column: 1 / -1;
	}

	.section-title {
		font-size: 0.63rem;
		font-weight: 800;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.detail-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
	}

	.detail-metric {
		display: flex;
		flex-direction: column;
		background: rgba(255, 255, 255, 0.01);
		border: 1px solid rgba(148, 163, 184, 0.04);
		padding: 6px 8px;
		border-radius: 6px;
		align-items: center;
		justify-content: center;
	}

	.metric-label {
		font-size: 0.58rem;
		color: var(--color-text-muted);
		font-weight: 500;
		text-align: center;
	}

	.metric-value {
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--color-text);
		margin-top: 2px;
		font-family: "JetBrains Mono", monospace;
	}

	.text-red {
		color: #ef4444;
	}

	.metric-value.has-blocked {
		color: #ef4444;
		text-shadow: 0 0 4px rgba(239, 68, 68, 0.4);
	}

	.metric-value.has-failures {
		color: #ef4444;
		text-shadow: 0 0 4px rgba(239, 68, 68, 0.4);
	}

	.text-orange {
		color: #f97316;
	}

	.locked-files-list {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		max-height: 120px;
		overflow-y: auto;
		padding: 2px;
	}

	.locked-file-item {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.67rem;
		background: rgba(249, 115, 22, 0.05);
		color: #fdba74;
		border: 1px solid rgba(249, 115, 22, 0.15);
		padding: 3px 8px;
		border-radius: 4px;
		font-family: "JetBrains Mono", monospace;
		max-width: 100%;
	}

	.file-path {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	@keyframes pulse-orange {
		0%,
		100% {
			box-shadow: 0 0 0 0 rgba(249, 115, 22, 0);
		}
		50% {
			box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.15);
		}
	}

	.animate-fade-in {
		animation: fadeIn 0.2s cubic-bezier(0.4, 0, 0.2, 1) forwards;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	/* Responsive horizontal layout for large viewports */
	@media (min-width: 768px) {
		.repo-strip {
			flex-direction: row;
			flex-wrap: wrap;
		}

		.repo-card-wrapper {
			flex: 1 1 calc(50% - 6px);
			min-width: 280px;
		}
	}

	@media (min-width: 1200px) {
		.repo-card-wrapper {
			flex: 1 1 calc(33.333% - 8px);
			min-width: 320px;
		}
	}
</style>
