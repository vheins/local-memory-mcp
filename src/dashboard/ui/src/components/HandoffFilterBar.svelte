<script lang="ts">
	import Icon from "../lib/Icon.svelte";

	export let status = "";
	export let agentFilter = "";
	export let pendingCount = 0;
	export let resolvedCount = 0;
	export let claimsCount = 0;
	export let totalCount = 0;
	export let onStatusChange: () => void = () => {};
	export let onAgentFilterChange: () => void = () => {};
	export let onRefresh: () => void = () => {};
	export let onNewHandoff: () => void = () => {};
</script>

<header class="feature-toolbar card">
	<div class="toolbar-title">
		<Icon name="git-branch" size={18} strokeWidth={2} />
		<div>
			<h1>Handoffs & claims</h1>
			<p>Transfer unfinished work between agents and resolve ownership conflicts.</p>
		</div>
	</div>
	<button class="btn btn-primary toolbar-action" on:click={onNewHandoff}>
		<Icon name="plus" size={16} strokeWidth={2} />
		New handoff
	</button>
	<div class="coordination-summary" aria-label="Coordination summary">
		<span><strong>{pendingCount}</strong> pending</span>
		<span><strong>{resolvedCount}</strong> resolved</span>
		<span><strong>{claimsCount}</strong> active claims</span>
		<span><strong>{totalCount}</strong> total</span>
	</div>
	<div class="toolbar-controls" aria-label="Handoff filters">
		<label>
			<span>Status</span>
			<select class="form-select" bind:value={status} on:change={onStatusChange} aria-label="Filter handoffs by status">
				<option value="">All statuses</option>
				<option value="pending">Pending</option>
				<option value="accepted">Accepted</option>
				<option value="rejected">Rejected</option>
				<option value="expired">Expired</option>
			</select>
		</label>
		<label class="agent-filter">
			<span>Recipient</span>
			<input
				class="form-input"
				placeholder="Filter by recipient agent"
				aria-label="Filter handoffs by recipient agent"
				bind:value={agentFilter}
				on:input={onAgentFilterChange}
			/>
		</label>
		<button class="btn btn-ghost refresh-action" on:click={onRefresh}>
			<Icon name="refresh-cw" size={16} strokeWidth={2} />
			Refresh
		</button>
	</div>
</header>

<style>
	.feature-toolbar {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 20px;
		align-items: start;
		padding: 24px;
	}
	.toolbar-title {
		display: flex;
		align-items: flex-start;
		gap: 12px;
	}
	.toolbar-title h1 {
		margin: 0;
		font-size: 1.2rem;
		line-height: 1.25;
		color: var(--color-text);
	}
	.toolbar-title p {
		margin: 6px 0 0;
		max-width: 620px;
		font-size: 0.85rem;
		line-height: 1.5;
		color: var(--color-text-muted);
	}
	.toolbar-action {
		justify-self: end;
	}
	.coordination-summary {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 20px;
		grid-column: 1 / -1;
		padding-top: 16px;
		border-top: 1px solid var(--color-border);
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}
	.coordination-summary strong {
		color: var(--color-text);
		font-variant-numeric: tabular-nums;
	}
	.toolbar-controls {
		display: grid;
		grid-template-columns: 180px minmax(220px, 1fr) auto;
		gap: 12px;
		align-items: end;
		grid-column: 1 / -1;
	}
	.toolbar-controls label {
		display: grid;
		gap: 6px;
		font-size: 0.72rem;
		font-weight: 700;
		color: var(--color-text-muted);
	}

	@media (max-width: 720px) {
		.feature-toolbar,
		.toolbar-controls {
			grid-template-columns: 1fr;
		}
		.feature-toolbar {
			padding: 20px;
		}
		.toolbar-action,
		.refresh-action {
			width: 100%;
			justify-self: stretch;
		}
		.coordination-summary {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
