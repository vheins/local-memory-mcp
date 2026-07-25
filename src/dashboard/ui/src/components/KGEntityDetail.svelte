<script lang="ts">
	import { createEventDispatcher } from "svelte";
	import Icon from "$lib/Icon.svelte";

	export let show = false;
	export let loading = false;
	export let entity: Record<string, any> | null = null;
	export let relations: Array<{
		from_entity: string;
		to_entity: string;
		relation_type: string;
	}> = [];
	export let observations: Array<{
		id: string;
		content: string;
		created_at: string;
	}> = [];
	export let error: string = "";

	const dispatch = createEventDispatcher<{
		close: void;
		navigateTo: { name: string };
	}>();

	const TYPE_COLORS: Record<string, string> = {
		person: "#22c55e",
		place: "#3b82f6",
		organization: "#f97316",
		concept: "#a855f7",
		unknown: "#6b7280"
	};

	function getTypeColor(type: string): string {
		return TYPE_COLORS[type?.toLowerCase()] ?? TYPE_COLORS.unknown;
	}

	function formatTimestamp(ts: string): string {
		if (!ts) return "";
		try {
			const d = new Date(ts);
			return d.toLocaleDateString(undefined, {
				year: "numeric",
				month: "short",
				day: "numeric",
				hour: "2-digit",
				minute: "2-digit"
			});
		} catch {
			return ts;
		}
	}

	function handleOverlayClick() {
		dispatch("close");
	}

	function handleClose() {
		dispatch("close");
	}

	function handleNavigate(name: string) {
		dispatch("navigateTo", { name });
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === "Escape") {
			dispatch("close");
		}
	}
</script>

<svelte:window on:keydown={handleKeydown} />

{#if show}
	<!-- svelte-ignore a11y-click-events-have-key-events -->
	<div class="detail-overlay" on:click={handleOverlayClick} role="button" tabindex="-1" aria-label="Close panel"></div>

	<div class="detail-panel" role="complementary" aria-label="Entity details">
		<!-- Close button -->
		<button class="close-btn" on:click={handleClose} aria-label="Close detail panel">
			<Icon name="x" size={16} strokeWidth={2} />
		</button>

		{#if loading}
			<div class="detail-loading">
				<div class="spinner"></div>
				<span>Loading entity…</span>
			</div>
		{:else if error}
			<div class="detail-error">
				<Icon name="alert-circle" size={18} strokeWidth={1.75} />
				<span>{error}</span>
			</div>
		{:else if entity}
			<div class="detail-scroll">
				<!-- Header -->
				<div class="detail-header">
					<h2 class="entity-name">{entity.name ?? "Unnamed"}</h2>
					{#if entity.type}
						<span
							class="type-badge"
							style="background:{getTypeColor(entity.type)}20;color:{getTypeColor(
								entity.type
							)};border-color:{getTypeColor(entity.type)}40"
						>
							{entity.type}
						</span>
					{/if}
				</div>

				<!-- Description -->
				{#if entity.description}
					<div class="detail-section">
						<p class="entity-description">{entity.description}</p>
					</div>
				{/if}

				<!-- Stats -->
				<div class="detail-section stats-row">
					{#if entity.created_at}
						<div class="stat">
							<span class="stat-label">Created</span>
							<span class="stat-value">{formatTimestamp(entity.created_at)}</span>
						</div>
					{/if}
					{#if entity.updated_at}
						<div class="stat">
							<span class="stat-label">Updated</span>
							<span class="stat-value">{formatTimestamp(entity.updated_at)}</span>
						</div>
					{/if}
				</div>

				<!-- Relations -->
				{#if relations.length > 0}
					<div class="detail-section">
						<h3 class="section-title">
							<Icon name="link" size={13} strokeWidth={1.75} />
							Relations ({relations.length})
						</h3>
						<ul class="relation-list">
							{#each relations as rel, i (`${rel.from_entity}-${rel.to_entity}-${rel.relation_type}-${i}`)}
								<li class="relation-item">
									<!-- svelte-ignore a11y-click-events-have-key-events -->
									<span
										class="relation-entity"
										role="button"
										tabindex="0"
										on:click={() => handleNavigate(rel.from_entity)}
										on:keydown={(e) => e.key === "Enter" && handleNavigate(rel.from_entity)}>{rel.from_entity}</span
									>
									<span class="relation-type-badge">{rel.relation_type}</span>
									<!-- svelte-ignore a11y-click-events-have-key-events -->
									<span
										class="relation-entity"
										role="button"
										tabindex="0"
										on:click={() => handleNavigate(rel.to_entity)}
										on:keydown={(e) => e.key === "Enter" && handleNavigate(rel.to_entity)}>{rel.to_entity}</span
									>
								</li>
							{/each}
						</ul>
					</div>
				{/if}

				<!-- Observations -->
				{#if observations.length > 0}
					<div class="detail-section">
						<h3 class="section-title">
							<Icon name="file-text" size={13} strokeWidth={1.75} />
							Observations ({observations.length})
						</h3>
						<ul class="observation-list">
							{#each observations as obs (obs.id)}
								<li class="observation-card">
									<p class="observation-content">{obs.content}</p>
									{#if obs.created_at}
										<span class="observation-time">{formatTimestamp(obs.created_at)}</span>
									{/if}
								</li>
							{/each}
						</ul>
					</div>
				{/if}

				{#if relations.length === 0 && observations.length === 0}
					<div class="detail-empty">
						<Icon name="inbox" size={20} strokeWidth={1.5} />
						<span>No relations or observations yet.</span>
					</div>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	.detail-overlay {
		position: absolute;
		inset: 0;
		background: rgba(1, 12, 30, 0.4);
		z-index: 40;
		backdrop-filter: blur(4px);
		-webkit-backdrop-filter: blur(4px);
		animation: fadeIn 0.2s ease-out;
	}

	.detail-panel {
		position: absolute;
		top: 0;
		right: 0;
		width: 340px;
		height: 100%;
		z-index: 41;
		background: var(--glass-bg-ultra);
		backdrop-filter: blur(28px) saturate(1.2);
		-webkit-backdrop-filter: blur(28px) saturate(1.2);
		border-left: 1px solid var(--glass-border);
		box-shadow: -8px 0 32px rgba(0, 0, 0, 0.15);
		display: flex;
		flex-direction: column;
		transform: translateX(100%);
		opacity: 0;
		transition:
			transform 0.28s cubic-bezier(0.16, 1, 0.3, 1),
			opacity 0.22s ease-out;
	}

	:global(.dark) .detail-panel {
		background: var(--panel-dark-ultra);
		border-left-color: var(--panel-dark-border);
		box-shadow: -8px 0 32px rgba(0, 0, 0, 0.45);
	}

	:global(.dark) .detail-overlay {
		background: rgba(1, 12, 30, 0.6);
	}

	/* Animate in when show=true — the panel is always rendered in DOM when show=true
	   because of the {#if show} block. We use a slight delay for the transform. */
	.detail-panel {
		animation: slideIn 0.28s cubic-bezier(0.16, 1, 0.3, 1) forwards;
	}

	@keyframes slideIn {
		from {
			transform: translateX(100%);
			opacity: 0;
		}
		to {
			transform: translateX(0);
			opacity: 1;
		}
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	.close-btn {
		position: absolute;
		top: 12px;
		right: 12px;
		z-index: 2;
		width: 28px;
		height: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 8px;
		border: 1px solid var(--color-border);
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s;
	}

	.close-btn:hover {
		background: rgba(239, 68, 68, 0.12);
		color: #ef4444;
		border-color: rgba(239, 68, 68, 0.3);
	}

	:global(.dark) .close-btn {
		border-color: rgba(148, 163, 184, 0.12);
	}

	/* Loading & Error states */
	.detail-loading,
	.detail-error {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		padding: 48px 24px;
		text-align: center;
		color: var(--color-text-muted);
		font-size: 0.82rem;
	}

	.detail-error {
		color: #ef4444;
	}

	.spinner {
		width: 24px;
		height: 24px;
		border: 2.5px solid var(--color-border);
		border-top-color: var(--color-text-muted);
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* Scrollable content */
	.detail-scroll {
		flex: 1;
		overflow-y: auto;
		padding: 16px 18px 24px;
	}

	.detail-scroll::-webkit-scrollbar {
		width: 5px;
	}

	.detail-scroll::-webkit-scrollbar-track {
		background: transparent;
	}

	.detail-scroll::-webkit-scrollbar-thumb {
		background: var(--color-border);
		border-radius: 3px;
	}

	/* Header */
	.detail-header {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		flex-wrap: wrap;
		padding-bottom: 14px;
		border-bottom: 1px solid var(--color-border);
		margin-bottom: 4px;
		padding-right: 36px;
	}

	:global(.dark) .detail-header {
		border-bottom-color: rgba(148, 163, 184, 0.1);
	}

	.entity-name {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 800;
		color: var(--color-text);
		line-height: 1.3;
		word-break: break-word;
	}

	.type-badge {
		display: inline-flex;
		align-items: center;
		padding: 2px 8px;
		border-radius: 6px;
		border: 1px solid;
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		white-space: nowrap;
		flex-shrink: 0;
	}

	/* Description */
	.detail-section {
		padding: 12px 0;
	}

	.entity-description {
		margin: 0;
		font-size: 0.82rem;
		line-height: 1.55;
		color: var(--color-text-muted);
	}

	/* Stats */
	.stats-row {
		display: flex;
		gap: 20px;
		flex-wrap: wrap;
	}

	.stat {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.stat-label {
		font-size: 0.66rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
	}

	.stat-value {
		font-size: 0.78rem;
		color: var(--color-text);
		font-variant-numeric: tabular-nums;
	}

	/* Section titles */
	.section-title {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 0 0 10px;
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
	}

	/* Relations */
	.relation-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.relation-item {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 7px 10px;
		border-radius: 8px;
		background: rgba(148, 163, 184, 0.06);
		border: 1px solid var(--color-border);
		font-size: 0.78rem;
		color: var(--color-text);
		overflow: hidden;
	}

	:global(.dark) .relation-item {
		background: rgba(148, 163, 184, 0.04);
		border-color: rgba(148, 163, 184, 0.08);
	}

	.relation-entity {
		cursor: pointer;
		color: #60a5fa;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		transition: color 0.15s;
		background: none;
		border: none;
		padding: 0;
	}

	.relation-entity:hover {
		color: #93c5fd;
		text-decoration: underline;
	}

	.relation-entity:focus-visible {
		outline: 2px solid #60a5fa;
		outline-offset: 2px;
		border-radius: 2px;
	}

	.relation-type-badge {
		flex-shrink: 0;
		padding: 1px 6px;
		border-radius: 4px;
		font-size: 0.66rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--color-text-muted);
		background: rgba(148, 163, 184, 0.1);
		border: 1px solid var(--color-border);
	}

	/* Observations */
	.observation-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.observation-card {
		padding: 10px 12px;
		border-radius: 8px;
		background: rgba(148, 163, 184, 0.06);
		border: 1px solid var(--color-border);
	}

	:global(.dark) .observation-card {
		background: rgba(148, 163, 184, 0.04);
		border-color: rgba(148, 163, 184, 0.08);
	}

	.observation-content {
		margin: 0 0 6px;
		font-size: 0.8rem;
		line-height: 1.5;
		color: var(--color-text);
		word-break: break-word;
	}

	.observation-time {
		font-size: 0.68rem;
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
	}

	/* Empty state */
	.detail-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 32px 16px;
		text-align: center;
		color: var(--color-text-muted);
		font-size: 0.8rem;
	}

	/* Responsive: narrower on small screens */
	@media (max-width: 480px) {
		.detail-panel {
			width: 100%;
		}
	}
</style>
