<script lang="ts">
	import Icon from "$lib/Icon.svelte";
	import KGZeroEdgeStatus from "./KGZeroEdgeStatus.svelte";

	export let nodeCount: number;
	export let edgeCount: number;
	export let isLoading: boolean;
	export let errorMsg: string;
	export let isZeroEdgeOverview: boolean;
	export let visibleNodeCount: number;
	export let hiddenNodeCount: number;
	export let onAddEntity: () => void;
	export let onAddRelation: () => void;
	export let onRefresh: () => void;
</script>

<div class="kg-toolbar">
	<div class="kg-toolbar-left">
		<span class="section-label" style="font-size:0.68rem;">
			<Icon name="share-2" size={12} strokeWidth={1.75} />
			Knowledge Graph
		</span>
		<span class="kg-stats">
			{nodeCount} nodes · {edgeCount} edges
		</span>
	</div>
	<div class="kg-toolbar-right">
		<button class="btn btn-ghost btn-sm" on:click={onAddEntity}>
			<Icon name="plus" size={12} strokeWidth={2} />
			Add Entity
		</button>
		<button class="btn btn-ghost btn-sm" on:click={onAddRelation}>
			<Icon name="link" size={12} strokeWidth={2} />
			Add Relation
		</button>
		<button class="btn btn-ghost btn-sm" on:click={onRefresh} disabled={isLoading}>
			<Icon name="refresh-cw" size={12} strokeWidth={2} className={isLoading ? "animate-spin" : ""} />
			Refresh
		</button>
	</div>
</div>

{#if errorMsg}
	<div class="kg-error">
		<Icon name="triangle-alert" size={14} strokeWidth={1.75} />
		{errorMsg}
	</div>
{/if}
{#if isZeroEdgeOverview}
	<KGZeroEdgeStatus {visibleNodeCount} totalNodeCount={nodeCount} {hiddenNodeCount} />
{/if}

<style>
	.kg-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
		border-bottom: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.05);
		flex-shrink: 0;
	}

	:global(.dark) .kg-toolbar {
		border-color: rgba(148, 163, 184, 0.1);
	}

	.kg-toolbar-left {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.kg-toolbar-right {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.kg-stats {
		font-size: 0.72rem;
		color: var(--color-text-muted);
		font-weight: 600;
	}

	.kg-error {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 16px;
		background: rgba(239, 68, 68, 0.08);
		color: var(--color-danger);
		font-size: 0.8rem;
		font-weight: 600;
		border-bottom: 1px solid rgba(239, 68, 68, 0.15);
	}

	:global(.kg-loading),
	:global(.kg-empty) {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		color: var(--color-text-muted);
		font-size: 0.85rem;
	}

	:global(.kg-empty svg) {
		opacity: 0.3;
	}

	@media (max-width: 640px) {
		.kg-toolbar {
			align-items: flex-start;
			flex-direction: column;
			gap: 10px;
		}

		.kg-toolbar-right {
			flex-wrap: wrap;
		}
	}
</style>
