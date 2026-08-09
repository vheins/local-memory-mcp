<script lang="ts">
	import Icon from "../lib/Icon.svelte";
	import type { QueueJob } from "../lib/api";
	import { formatDate } from "../lib/utils";

	/**
	 * Failed (poison) jobs table (TASK-297 split — F2). Renders the jobs array
	 * as-is from GET /api/queue/jobs?status=poison with per-row Re-run/Clear
	 * and pagination. Pure presentational: all data fetching, mutation and
	 * confirmation orchestration live in QueuePage and arrive via props /
	 * callbacks.
	 */
	let {
		jobs = [],
		loading = false,
		page = 1,
		totalItems = 0,
		totalPages = 1,
		busy = null,
		retryingAll = false,
		onRetry = null,
		onClear = null,
		onRetryAll = null,
		onRefresh = null,
		onPageChange = null
	}: {
		jobs: QueueJob[];
		loading: boolean;
		page: number;
		totalItems: number;
		totalPages: number;
		busy: { id: string; action: "retry" | "clear" } | null;
		retryingAll: boolean;
		onRetry: ((job: QueueJob) => void) | null;
		onClear: ((job: QueueJob) => void) | null;
		onRetryAll: (() => void) | null;
		onRefresh: (() => void) | null;
		onPageChange: ((next: number) => void) | null;
	} = $props();

	// ── Status label mapping (poison → "Failed" is UI-only) ───────────────────
	function statusLabel(s: QueueJob["status"]): string {
		return s === "poison" ? "Failed (poison)" : s.charAt(0).toUpperCase() + s.slice(1);
	}
</script>

<section class="queue-section" aria-label="Failed jobs">
	<div class="table-header">
		<div>
			<div class="table-title">Failed jobs</div>
			<div class="table-subtitle">
				{loading ? "Loading…" : `${totalItems} failed job${totalItems === 1 ? "" : "s"}`}
			</div>
		</div>
		<div class="table-actions">
			<button
				class="btn btn-ghost btn-sm"
				onclick={() => onRefresh?.()}
				disabled={loading}
				title="Refresh queue"
				aria-label="Refresh queue"
			>
				<Icon name="refresh-cw" size={13} strokeWidth={2} />
			</button>
			<button
				class="btn btn-primary btn-sm"
				onclick={() => onRetryAll?.()}
				disabled={retryingAll || loading}
				title="Re-run all failed jobs"
				aria-label="Re-run all failed jobs"
			>
				<Icon name="refresh-cw" size={13} strokeWidth={2} />
				{retryingAll ? "Re-running…" : "Re-run all"}
			</button>
		</div>
	</div>

	<div class="mem-table-wrap">
		<table class="mem-table">
			<thead>
				<tr class="mem-thead-row">
					<th scope="col" class="mem-th" style="min-width:120px;">Entity</th>
					<th scope="col" class="mem-th" style="min-width:100px;">Status</th>
					<th scope="col" class="mem-th" style="width:90px;">Attempts</th>
					<th scope="col" class="mem-th" style="width:120px;">Enqueued</th>
					<th scope="col" class="mem-th" style="width:120px;">Processed</th>
					<th scope="col" class="mem-th" style="min-width:220px;">Last error</th>
					<th scope="col" class="mem-th" style="width:170px;">Actions</th>
				</tr>
			</thead>
			<tbody>
				{#if loading}
					{#each { length: 5 } as _, i (i)}
						<tr>
							<td colspan="7" class="mem-td">
								<div class="skeleton" style="height:20px;border-radius:6px;"></div>
							</td>
						</tr>
					{/each}
				{:else if jobs.length === 0}
					<tr>
						<td colspan="7" class="mem-td" style="padding:40px;text-align:center;color:var(--color-text-muted);">
							<Icon name="circle-check" size={22} strokeWidth={1.75} />
							<div style="margin-top:8px;">No failed jobs</div>
							<div style="font-size:0.78rem;margin-top:4px;">
								Failed (poison) jobs will appear here for re-run or clearing.
							</div>
						</td>
					</tr>
				{:else}
					{#each jobs as job, i (`${job.id}-${i}`)}
						<tr class="mem-row">
							<td class="mem-td">
								<div class="entity-cell">
									<span class="entity-kind">{job.entity_kind}</span>
									<span class="entity-id">{job.entity_id}</span>
								</div>
							</td>
							<td class="mem-td">
								<span
									class="status-pill"
									class:status-failed={job.status === "poison"}
									class:status-pending={job.status === "pending"}
								>
									{statusLabel(job.status)}
								</span>
							</td>
							<td class="mem-td" style="font-size:0.78rem;color:var(--color-text-muted);white-space:nowrap;">
								{job.attempts} / {job.max_attempts}
							</td>
							<td class="mem-td" style="font-size:0.75rem;color:var(--color-text-muted);white-space:nowrap;">
								{formatDate(job.enqueued_at)}
							</td>
							<td class="mem-td" style="font-size:0.75rem;color:var(--color-text-muted);white-space:nowrap;">
								{formatDate(job.processed_at)}
							</td>
							<td class="mem-td">
								<div class="truncate error-cell" title={job.last_error ?? ""}>
									{job.last_error || "—"}
								</div>
							</td>
							<td class="mem-td">
								<div class="row-actions">
									<button
										class="row-action-btn retry-btn"
										onclick={() => onRetry?.(job)}
										disabled={busy?.id === job.id}
										title="Re-run job"
										aria-label={`Re-run queue job for ${job.entity_id}`}
									>
										<Icon name="refresh-cw" size={13} strokeWidth={2} />
										<span class="action-label">
											{busy?.id === job.id && busy?.action === "retry" ? "Re-running…" : "Re-run"}
										</span>
									</button>
									<button
										class="row-action-btn delete-btn"
										onclick={() => onClear?.(job)}
										disabled={busy?.id === job.id}
										title="Clear job"
										aria-label={`Clear queue job for ${job.entity_id}`}
									>
										<Icon name="trash" size={13} strokeWidth={2} />
										<span class="action-label">
											{busy?.id === job.id && busy?.action === "clear" ? "Clearing…" : "Clear"}
										</span>
									</button>
								</div>
							</td>
						</tr>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>

	{#if totalPages > 1}
		<div class="pagination">
			<button
				class="btn btn-ghost btn-sm"
				onclick={() => onPageChange?.(page - 1)}
				disabled={page <= 1 || loading}
				aria-label="Previous page"
			>
				<Icon name="chevron-left" size={13} strokeWidth={2} /> Prev
			</button>
			<span class="pagination-info">
				Page {page} of {totalPages} ({totalItems} jobs)
			</span>
			<button
				class="btn btn-ghost btn-sm"
				onclick={() => onPageChange?.(page + 1)}
				disabled={page >= totalPages || loading}
				aria-label="Next page"
			>
				Next <Icon name="chevron-right" size={13} strokeWidth={2} />
			</button>
		</div>
	{/if}
</section>

<style>
	.queue-section {
		border-radius: 14px;
		border: 1px solid var(--color-border);
		background: var(--color-surface, #fff);
		padding: 16px;
	}

	/* ── Table header ── */
	.table-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 12px;
	}

	.table-title {
		font-size: 0.92rem;
		font-weight: 850;
		color: var(--color-text);
	}

	.table-subtitle {
		font-size: 0.72rem;
		color: var(--color-text-muted);
		font-weight: 600;
		margin-top: 2px;
	}

	.table-actions {
		display: flex;
		align-items: center;
		gap: 8px;
	}

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
		min-width: 900px;
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

	/* ── Entity cell ── */
	.entity-cell {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.entity-kind {
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-primary);
	}

	.entity-id {
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--color-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 240px;
	}

	/* ── Status pill ── */
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

	.status-failed {
		color: #b91c1c;
		background: rgba(239, 68, 68, 0.12);
	}

	:global(html.dark) .status-failed {
		color: #fca5a5;
	}

	.error-cell {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		max-width: 320px;
	}

	/* ── Row actions ── */
	.row-actions {
		display: flex;
		align-items: center;
		gap: 6px;
		white-space: nowrap;
	}

	.row-action-btn {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 5px 9px;
		border-radius: 7px;
		border: 1px solid var(--color-border);
		cursor: pointer;
		background: transparent;
		transition:
			background 0.15s ease,
			color 0.15s ease,
			border-color 0.15s ease;
		color: var(--color-text-muted);
		font-size: 0.72rem;
		font-weight: 700;
	}

	.row-action-btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.retry-btn:hover:not(:disabled) {
		background: rgba(14, 165, 233, 0.1);
		color: #0369a1;
		border-color: rgba(14, 165, 233, 0.25);
	}

	.delete-btn:hover:not(:disabled) {
		background: rgba(239, 68, 68, 0.1);
		color: #b91c1c;
		border-color: rgba(239, 68, 68, 0.25);
	}

	:global(html.dark) .retry-btn:hover:not(:disabled) {
		color: #7dd3fc;
	}

	:global(html.dark) .delete-btn:hover:not(:disabled) {
		color: #fca5a5;
	}

	.action-label {
		line-height: 1;
	}

	/* ── Pagination ── */
	.pagination {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 12px;
		margin-top: 12px;
	}

	.pagination-info {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text-muted);
	}

	@media (max-width: 720px) {
		.table-header {
			flex-direction: column;
			align-items: flex-start;
		}
	}
</style>
