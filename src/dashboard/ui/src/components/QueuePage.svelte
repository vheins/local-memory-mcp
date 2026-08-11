<script lang="ts">
	import Icon from "../lib/Icon.svelte";
	import { api, type QueueJob, type QueueStatus } from "../lib/api";
	import { confirmAction, confirmDelete } from "../lib/confirm";
	import QueueStatusCards from "./QueueStatusCards.svelte";
	import QueueJobsTable from "./QueueJobsTable.svelte";

	/**
	 * Queue tab (TASK-297) — header + layout + orchestration for the status
	 * summary and the failed-job admin table (split into QueueStatusCards and
	 * QueueJobsTable — TASK-362).
	 *
	 * Wire contract: `status` values are the LITERAL QueueJobStatus enum
	 * values (`pending|claimed|done|poison`). The failed-job table is scoped to
	 * `status=poison` (TASK-363) — the terminal failed state — so per-row
	 * Re-run/Clear never hit live pending rows (which would 409). The code
	 * enum is never renamed; only the rendered label maps poison → "Failed".
	 *
	 * Reads (status + jobs) are pure reads; every mutation (retry/clear/
	 * retry-all) runs server-side inside `db.withWrite` and the page refreshes
	 * after each action.
	 */

	let { repo = "" }: { repo: string } = $props();

	// ── State ─────────────────────────────────────────────────────────────────
	let status = $state<QueueStatus | null>(null);
	let jobs = $state<QueueJob[]>([]);
	let loading = $state(false);
	let error = $state("");
	let busy = $state<{ id: string; action: "retry" | "clear" } | null>(null);
	let retryingAll = $state(false);

	// Pagination (backend clamps pageSize to [1,100]; 50 keeps the admin view
	// compact while still rendering a meaningful window).
	const PAGE_SIZE = 50;
	let page = $state(1);
	let totalItems = $state(0);
	let totalPages = $state(0);

	// ARIA live region (STD-002 / TASK-400): scoped sr-only announcements for
	// async queue updates (loads, re-run, clear, retry-all).
	let liveAnnounce = $state("");

	// ── Data loading ──────────────────────────────────────────────────────────
	// NIT fix: reset to the first page when switching repos so a stale page
	// (e.g. "Page 3 of 2") can never render an empty table for a smaller repo.
	// `prevRepo` is a plain (non-reactive) local: the guard keeps the reset
	// from re-triggering this effect and double-fetching on repo change.
	let prevRepo = "";
	$effect(() => {
		if (repo) {
			const repoChanged = repo !== prevRepo;
			prevRepo = repo;
			if (repoChanged) {
				page = 1;
				void loadAll();
			}
		}
	});

	async function loadAll() {
		await Promise.all([loadStatus(), loadJobs()]);
	}

	async function loadStatus() {
		try {
			status = await api.queueStatus();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	async function loadJobs() {
		if (!repo) return;
		loading = true;
		error = "";
		try {
			// F1: scope the table to terminal `poison` rows (TASK-363) — without
			// the filter the backend default (pending,poison) would surface live
			// PENDING rows under "Failed jobs" whose Re-run/Clear 409.
			const result = await api.queueJobs({ repo, page, pageSize: PAGE_SIZE, status: "poison" });
			jobs = result.jobs || [];
			totalItems = result.pagination?.totalItems ?? jobs.length;
			totalPages = result.pagination?.totalPages ?? 1;
			liveAnnounce = `Loaded ${totalItems} failed queue jobs`;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	function goToPage(next: number) {
		if (next < 1 || next > totalPages || next === page) return;
		page = next;
		void loadJobs();
	}

	// ── Admin actions ─────────────────────────────────────────────────────────
	async function handleRetry(job: QueueJob) {
		if (!(await confirmAction("Re-run queue job?", "Re-queue this job so the worker processes it again?"))) return;
		busy = { id: job.id, action: "retry" };
		error = "";
		try {
			await api.queueRetryJob(job.id, repo);
			liveAnnounce = "Queue job re-queued";
			await loadAll();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = null;
		}
	}

	async function handleClear(job: QueueJob) {
		if (!(await confirmDelete(`Delete failed queue job for "${job.entity_id}"? This removes the job row permanently.`)))
			return;
		busy = { id: job.id, action: "clear" };
		error = "";
		try {
			await api.queueClearJob(job.id, repo);
			liveAnnounce = "Queue job cleared";
			await loadAll();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = null;
		}
	}

	async function handleRetryAll() {
		const scope = repo ? ` for "${repo}"` : "";
		if (!(await confirmAction("Re-run all failed jobs?", `Re-queue every failed (poison) job${scope}?`))) return;
		retryingAll = true;
		error = "";
		try {
			const result = await api.queueRetryAll(repo);
			if (result.retried > 0) {
				liveAnnounce = `Re-queued ${result.retried} failed jobs`;
				await loadAll();
			}
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			retryingAll = false;
		}
	}
</script>

<div class="feature-shell animate-fade-in">
	<!-- ARIA live region (STD-002 / TASK-400): scoped, never the whole shell -->
	<div class="sr-only" aria-live="polite" aria-atomic="true">{liveAnnounce}</div>

	<!-- ════ Header (exactly one h1 per tab — STD-002) ════ -->
	<div class="queue-header">
		<div class="flex items-center gap-2">
			<Icon name="list" size={14} strokeWidth={1.75} />
			<h1 class="section-label">Queue</h1>
		</div>
		<div class="repo-badge">{repo}</div>
	</div>

	<!-- ════ Status summary (global counts from /api/queue/status) ════ -->
	<QueueStatusCards {status} />

	{#if error}
		<div class="error-banner" role="status" aria-live="polite">{error}</div>
	{/if}

	<!-- ════ Failed (poison) jobs table ════ -->
	<QueueJobsTable
		{jobs}
		{loading}
		{page}
		{totalItems}
		{totalPages}
		{busy}
		{retryingAll}
		onRetry={(job) => void handleRetry(job)}
		onClear={(job) => void handleClear(job)}
		onRetryAll={() => void handleRetryAll()}
		onRefresh={() => void loadAll()}
		onPageChange={goToPage}
	/>
</div>

<style>
	.feature-shell {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.queue-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}

	.repo-badge {
		font-size: 0.68rem;
		font-weight: 800;
		color: var(--color-primary);
		background: rgba(99, 102, 241, 0.08);
		border: 1px solid rgba(99, 102, 241, 0.16);
		padding: 4px 8px;
		border-radius: 999px;
	}

	/* ── Error banner ── */
	.error-banner {
		border: 1px solid #fecaca;
		background: #fef2f2;
		color: #dc2626;
		border-radius: 8px;
		padding: 10px 12px;
		font-size: 0.82rem;
		font-weight: 700;
	}
</style>
