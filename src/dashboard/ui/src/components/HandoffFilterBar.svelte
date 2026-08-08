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

<div class="feature-toolbar glass card">
	<div class="toolbar-title">
		<Icon name="git-branch" size={16} strokeWidth={2} />
		<div>
			<h1 class="section-label">HANDOFFS & CLAIMS</h1>
			<div class="toolbar-subtitle">Handoffs transfer context between agents. Claims reserve a task for one owner.</div>
		</div>
	</div>
	<button class="btn btn-primary toolbar-action" on:click={onNewHandoff}>
		<Icon name="plus" size={14} strokeWidth={2} />
		New Handoff
	</button>
	<div class="toolbar-controls">
		<select class="form-select" bind:value={status} on:change={onStatusChange}>
			<option value="">All statuses</option>
			<option value="pending">Pending</option>
			<option value="accepted">Accepted</option>
			<option value="rejected">Rejected</option>
			<option value="expired">Expired</option>
		</select>
		<input
			class="form-input"
			placeholder="To agent filter"
			aria-label="Filter handoffs by recipient agent"
			bind:value={agentFilter}
			on:input={onAgentFilterChange}
		/>
		<button class="btn btn-ghost" on:click={onRefresh}>
			<Icon name="refresh-cw" size={14} strokeWidth={2} />
			Refresh
		</button>
	</div>
</div>

<div class="insight-strip">
	<div class="insight-card">
		<span>Pending</span>
		<strong>{pendingCount}</strong>
	</div>
	<div class="insight-card">
		<span>Resolved</span>
		<strong>{resolvedCount}</strong>
	</div>
	<div class="insight-card">
		<span>Claims</span>
		<strong>{claimsCount}</strong>
	</div>
	<div class="insight-card">
		<span>Total</span>
		<strong>{totalCount}</strong>
	</div>
</div>

<style>
	.feature-toolbar {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 14px;
		align-items: start;
		padding: 16px;
	}
	.toolbar-title {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.toolbar-action {
		justify-self: end;
	}
	.toolbar-subtitle {
		font-size: 0.72rem;
		color: var(--color-text-muted);
		font-weight: 600;
		margin-top: 2px;
		line-height: 1.45;
	}
	.section-label {
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
	}
	.insight-strip {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 10px;
	}
	.insight-card {
		padding: 12px 14px;
		border-radius: 14px;
		border: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.32);
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.insight-card span {
		font-size: 0.66rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-muted);
	}
	.insight-card strong {
		font-size: 0.84rem;
		color: var(--color-text);
	}
	.toolbar-controls {
		display: grid;
		grid-template-columns: 160px minmax(180px, 1fr) auto;
		gap: 10px;
		align-items: center;
		grid-column: 1 / -1;
	}

	@media (max-width: 900px) {
		.insight-strip,
		.toolbar-controls {
			grid-template-columns: 1fr;
		}
	}
</style>
