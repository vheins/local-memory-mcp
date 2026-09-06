<script lang="ts">
	import Icon from "../lib/Icon.svelte";
	import { formatDate } from "../lib/utils";
	import type { Handoff, TaskClaim } from "../lib/interfaces";

	export let handoffs: Handoff[] = [];
	export let loading = false;
	export let claims: TaskClaim[] = [];
	export let claimsLoading = false;
	export let releasingClaimId: string | null = null;
	export let onOpenViewDrawer: (handoff: Handoff) => void = () => {};
	export let onDeleteRow: (handoff: Handoff) => void = () => {};
	export let onReleaseClaim: (claim: TaskClaim) => void = () => {};
</script>

<!-- Table -->
<div class="mem-table-wrap">
	<table class="mem-table">
		<thead>
			<tr class="mem-thead-row">
				<th class="mem-th" style="min-width:140px;">From</th>
				<th class="mem-th" style="min-width:140px;">To</th>
				<th class="mem-th" style="min-width:100px;">Task</th>
				<th class="mem-th" style="min-width:200px;">Summary</th>
				<th class="mem-th" style="width:100px;">Status</th>
				<th class="mem-th" style="width:130px;">Created</th>
				<th class="mem-th" style="width:130px;">Expires</th>
				<th class="mem-th" style="width:60px;"></th>
			</tr>
		</thead>
		<tbody>
			{#if loading}
				{#each { length: 5 } as _, i (i)}
					<tr>
						<td colspan="8" class="mem-td">
							<div class="skeleton" style="height:20px;border-radius:6px;"></div>
						</td>
					</tr>
				{/each}
			{:else if handoffs.length === 0}
				<tr>
					<td colspan="8" class="mem-td" style="padding:40px;text-align:center;color:var(--color-text-muted);">
						<Icon name="git-branch" size={22} strokeWidth={1.75} />
						<div style="margin-top:8px;">No handoffs found</div>
						<div style="font-size:0.78rem;margin-top:4px;">
							Create a handoff when work needs context transfer between agents.
						</div>
					</td>
				</tr>
			{:else}
				{#each handoffs as handoff, i (`${handoff.id}-${i}`)}
					<tr
						class="mem-row"
						on:click={() => onOpenViewDrawer(handoff)}
						role="button"
						tabindex="0"
						on:keydown={(e) => e.key === "Enter" && onOpenViewDrawer(handoff)}
					>
						<td class="mem-td" style="font-size:0.82rem;color:var(--color-text);font-weight:600;">
							{handoff.from_agent}
						</td>
						<td class="mem-td" style="font-size:0.82rem;color:var(--color-text);">
							{handoff.to_agent || "—"}
						</td>
						<td class="mem-td" style="font-size:0.75rem;color:var(--color-text-muted);">
							{handoff.task_code || handoff.task_id?.slice(0, 8) || "—"}
						</td>
						<td class="mem-td" style="max-width:300px;">
							<div class="truncate font-semibold" style="font-size:0.82rem;color:var(--color-text);">
								{handoff.summary}
							</div>
						</td>
						<td class="mem-td">
							<span
								class="status-pill"
								class:status-pending={handoff.status === "pending"}
								class:status-accepted={handoff.status === "accepted"}
								class:status-rejected={handoff.status === "rejected"}
								class:status-expired={handoff.status === "expired"}>{handoff.status}</span
							>
						</td>
						<td class="mem-td" style="font-size:0.75rem;color:var(--color-text-muted);white-space:nowrap;">
							{formatDate(handoff.created_at)}
						</td>
						<td class="mem-td" style="font-size:0.75rem;color:var(--color-text-muted);white-space:nowrap;">
							{handoff.expires_at ? formatDate(handoff.expires_at) : "—"}
						</td>
						<td class="mem-td row-actions" on:click|stopPropagation>
							<button
								class="row-action-btn delete-btn"
								on:click={() => onDeleteRow(handoff)}
								title="Expire"
								aria-label="Expire handoff"
								disabled={handoff.status === "expired"}
							>
								<Icon name="trash" size={13} strokeWidth={2} />
							</button>
						</td>
					</tr>
				{/each}
			{/if}
		</tbody>
	</table>
</div>

<!-- Mobile handoff cards -->
<div class="handoff-cards" aria-label="Handoffs">
	{#if loading}
		{#each { length: 3 } as _, i (i)}
			<div class="handoff-card"><div class="skeleton" style="height:112px;border-radius:10px;"></div></div>
		{/each}
	{:else if handoffs.length === 0}
		<div class="mobile-empty">
			<Icon name="git-branch" size={24} strokeWidth={1.75} />
			<strong>No handoffs found</strong>
			<span>Create one when unfinished work needs context transfer.</span>
		</div>
	{:else}
		{#each handoffs as handoff (handoff.id)}
			<article class="handoff-card">
				<button class="card-main" on:click={() => onOpenViewDrawer(handoff)} aria-label={`Open handoff ${handoff.summary}`}>
					<div class="card-heading">
						<strong>{handoff.summary}</strong>
						<span class="status-pill" class:status-pending={handoff.status === "pending"} class:status-accepted={handoff.status === "accepted"} class:status-rejected={handoff.status === "rejected"} class:status-expired={handoff.status === "expired"}>{handoff.status}</span>
					</div>
					<div class="route-line"><span>{handoff.from_agent}</span><Icon name="chevron-right" size={14} /><span>{handoff.to_agent || "Unassigned"}</span></div>
					<div class="card-meta"><span>{handoff.task_code || handoff.task_id?.slice(0, 8) || "No task"}</span><span>{formatDate(handoff.created_at)}</span></div>
				</button>
				<button class="btn btn-ghost card-expire" on:click={() => onDeleteRow(handoff)} disabled={handoff.status === "expired"}>Expire</button>
			</article>
		{/each}
	{/if}
</div>

<!-- Claims section -->
<div class="claims-section">
	<div class="claims-header">
		<div class="section-label">Active Claims</div>
		<span class="toolbar-subtitle">{claims.length} active</span>
	</div>
	{#if claimsLoading}
		<div class="muted-state">Loading claims...</div>
	{:else if claims.length === 0}
		<div class="empty-claims">
			<Icon name="check" size={20} strokeWidth={1.75} />
			<div class="empty-title">No active claims</div>
			<div class="empty-copy">Claimed tasks will appear here so you can inspect or release them.</div>
		</div>
	{:else}
		<div class="claim-list">
			{#each claims as claim, i (`${claim.id}-${i}`)}
				<div class="claim-row">
					<div>
						<div class="row-title">{claim.task_code || claim.task_id}</div>
						<div class="row-meta">
							<span>{claim.agent}</span>
							<span>{claim.role}</span>
							<span>{formatDate(claim.claimed_at)}</span>
						</div>
					</div>
					<button
						class="btn btn-ghost btn-sm"
						disabled={releasingClaimId === claim.id}
						on:click={() => onReleaseClaim(claim)}
					>
						{releasingClaimId === claim.id ? "Releasing..." : "Release"}
					</button>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	/* ── Table ── */
	.mem-table-wrap {
		overflow-x: auto;
		border-radius: 14px;
		border: 1px solid var(--color-border);
		background: var(--color-surface, #fff);
	}
	.mem-table {
		width: 100%;
		border-collapse: collapse;
		min-width: 750px;
	}
	.mem-thead-row {
		border-bottom: 1px solid var(--color-border);
		background: rgba(248, 250, 252, 0.9);
	}
	:global(html.dark) .mem-thead-row {
		background: rgba(10, 18, 38, 0.85);
	}
	.mem-th {
		padding: 10px 12px;
		text-align: left;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
		white-space: nowrap;
		user-select: none;
	}
	.mem-td {
		padding: 10px 12px;
		border-bottom: 1px solid var(--color-border);
	}
	:global(html.dark) .mem-td {
		border-color: rgba(148, 163, 184, 0.08);
	}
	.mem-row {
		cursor: pointer;
		transition: background 0.15s ease;
	}
	.mem-row:hover {
		background: rgba(241, 245, 249, 0.7);
	}
	:global(html.dark) .mem-row:hover {
		background: rgba(14, 165, 233, 0.05);
	}
	.mem-row:last-child .mem-td {
		border-bottom: none;
	}
	.row-actions {
		display: flex;
		align-items: center;
		gap: 4px;
		opacity: 0;
		transition: opacity 0.15s ease;
		white-space: nowrap;
	}
	.mem-row:hover .row-actions {
		opacity: 1;
	}
	.row-action-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		border-radius: 7px;
		border: none;
		cursor: pointer;
		background: transparent;
		transition:
			background 0.15s ease,
			color 0.15s ease;
		color: var(--color-text-muted);
	}
	.delete-btn:hover {
		background: rgba(239, 68, 68, 0.1);
		color: #ef4444;
	}
	:global(html.dark) .delete-btn:hover {
		background: rgba(239, 68, 68, 0.15);
		color: #fca5a5;
	}

	/* ── Status pills ── */
	.status-pill {
		border-radius: 999px;
		padding: 2px 8px;
		font-size: 0.67rem;
		text-transform: uppercase;
		font-weight: 850;
		border: 1px solid var(--color-border);
		display: inline-block;
	}
	.status-pending {
		color: #0369a1;
		background: rgba(14, 165, 233, 0.12);
	}
	.status-accepted {
		color: #047857;
		background: rgba(16, 185, 129, 0.12);
	}
	.status-rejected {
		color: #b91c1c;
		background: rgba(239, 68, 68, 0.12);
	}
	.status-expired {
		color: #64748b;
		background: rgba(100, 116, 139, 0.12);
	}

	/* ── Claims section ── */
	.claims-section {
		border-radius: 14px;
		border: 1px solid var(--color-border);
		background: var(--color-surface, #fff);
		padding: 16px;
	}
	.claims-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 12px;
	}
	.section-label {
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
	}
	.toolbar-subtitle {
		font-size: 0.72rem;
		color: var(--color-text-muted);
		font-weight: 600;
	}
	.claim-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.claim-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 12px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: rgba(255, 255, 255, 0.04);
	}
	.row-title {
		font-size: 0.82rem;
		font-weight: 700;
		color: var(--color-text);
		margin-bottom: 4px;
	}
	.row-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		color: var(--color-text-muted);
		font-size: 0.72rem;
		font-weight: 600;
	}
	.muted-state {
		color: var(--color-text-muted);
		font-size: 0.85rem;
		padding: 24px 4px;
		text-align: center;
	}
	.empty-claims {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		color: var(--color-text-muted);
		text-align: center;
		padding: 24px;
	}
	.empty-title {
		color: var(--color-text);
		font-size: 0.92rem;
		font-weight: 850;
	}
	.empty-copy {
		max-width: 260px;
		font-size: 0.78rem;
		line-height: 1.45;
	}
	.handoff-cards {
		display: none;
	}

	@media (max-width: 720px) {
		.mem-table-wrap {
			display: none;
		}
		.handoff-cards {
			display: grid;
			gap: 12px;
		}
		.handoff-card {
			display: grid;
			gap: 8px;
			padding: 16px;
			border: 1px solid var(--color-border);
			border-radius: var(--radius-lg);
			background: var(--color-surface);
		}
		.card-main {
			display: grid;
			gap: 12px;
			padding: 0;
			border: 0;
			background: transparent;
			color: inherit;
			text-align: left;
			cursor: pointer;
		}
		.card-heading {
			display: flex;
			align-items: flex-start;
			justify-content: space-between;
			gap: 12px;
		}
		.card-heading strong {
			font-size: 0.92rem;
			line-height: 1.4;
		}
		.route-line,
		.card-meta {
			display: flex;
			align-items: center;
			flex-wrap: wrap;
			gap: 8px;
			font-size: 0.78rem;
			color: var(--color-text-muted);
		}
		.card-meta {
			justify-content: space-between;
		}
		.card-expire {
			width: 100%;
		}
		.mobile-empty {
			display: grid;
			justify-items: center;
			gap: 8px;
			padding: 40px 20px;
			border: 1px solid var(--color-border);
			border-radius: var(--radius-lg);
			color: var(--color-text-muted);
			text-align: center;
		}
		.mobile-empty strong {
			color: var(--color-text);
		}
		.claim-row {
			align-items: stretch;
			flex-direction: column;
		}
		.claim-row .btn {
			width: 100%;
		}
	}
</style>
