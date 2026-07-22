<script lang="ts">
	import Icon from "../lib/Icon.svelte";
	import { api, type CodebaseIndexStatus } from "../lib/api";

	let { repo = "" }: { repo: string } = $props();

	// --- State ---
	let status = $state<CodebaseIndexStatus | null>(null);
	let loading = $state(false);
	let error = $state("");
	let reindexing = $state(false);

	/**
	 * Normalize backend response to the UI-friendly shape.
	 * Backend returns camelCase: isIndexed, totalFiles, totalSymbols, lastIndexedAt, isIndexing, progress
	 * UI expects: indexed, file_count, symbol_count, last_indexed_at, indexing.in_progress
	 */
	function normalizeStatus(raw: Record<string, unknown>) {
		const progress = raw.progress as Record<string, unknown> | undefined;
		return {
			indexed: (raw.isIndexed as boolean) ?? false,
			file_count: (raw.totalFiles as number) ?? 0,
			symbol_count: (raw.totalSymbols as number) ?? 0,
			last_indexed_at: (raw.lastIndexedAt as string) ?? null,
			indexing: {
				in_progress: (raw.isIndexing as boolean) ?? false,
				files_parsed: (progress?.current as number) ?? (raw.isIndexing ? 0 : 0),
				total_files: (progress?.total as number) ?? 0
			}
		};
	}

	// --- Derived: status color ---
	let statusColor = $derived.by(() => {
		if (!status || !status.indexed) return "red";
		if (!status.last_indexed_at) return "red";
		const elapsed = Date.now() - new Date(status.last_indexed_at).getTime();
		const ONE_HOUR = 60 * 60 * 1000;
		const TWENTY_FOUR_HOURS = 24 * ONE_HOUR;
		if (elapsed < ONE_HOUR) return "green";
		if (elapsed > TWENTY_FOUR_HOURS) return "yellow";
		return "green";
	});

	let statusColorVar = $derived.by(() => {
		if (statusColor === "green") return "rgba(34, 197, 94, 0.8)";
		if (statusColor === "yellow") return "rgba(234, 179, 8, 0.8)";
		return "rgba(239, 68, 68, 0.8)";
	});

	let statusBgVar = $derived.by(() => {
		if (statusColor === "green") return "rgba(34, 197, 94, 0.08)";
		if (statusColor === "yellow") return "rgba(234, 179, 8, 0.08)";
		return "rgba(239, 68, 68, 0.08)";
	});

	// --- Derived: indexing progress ---
	let indexingInProgress = $derived(status?.indexing?.in_progress === true);
	let indexingFilesParsed = $derived(status?.indexing?.files_parsed ?? 0);
	let indexingTotalFiles = $derived(status?.indexing?.total_files ?? 0);
	let indexingProgressPercent = $derived(indexingTotalFiles > 0 ? (indexingFilesParsed / indexingTotalFiles) * 100 : 0);

	// --- Derived: relative time ---
	let relativeTime = $derived.by(() => {
		if (!status?.last_indexed_at) return null;
		const diff = Date.now() - new Date(status.last_indexed_at).getTime();
		if (diff < 0) return "just now";
		const seconds = Math.floor(diff / 1000);
		if (seconds < 60) return "just now";
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		if (days === 1) return "yesterday";
		return `${days}d ago`;
	});

	// --- Fetch status ---
	async function fetchStatus() {
		if (!repo) {
			status = null;
			return;
		}
		loading = true;
		error = "";
		try {
			const raw = await api.codebaseIndexStatus(repo);
			status = normalizeStatus(raw as unknown as Record<string, unknown>) as CodebaseIndexStatus;
		} catch (err) {
			error = err instanceof Error ? err.message : "Failed to fetch index status";
			status = null;
		} finally {
			loading = false;
		}
	}

	// --- Re-index ---
	async function startReindex() {
		if (!repo || reindexing) return;
		reindexing = true;
		error = "";
		try {
			await api.codebaseReindex(repo);
			// Poll for progress after triggering re-index
			await pollIndexingProgress();
		} catch (err) {
			error = err instanceof Error ? err.message : "Failed to start indexing";
			reindexing = false;
		}
	}

	// --- Poll indexing progress ---
	async function pollIndexingProgress() {
		const POLL_INTERVAL = 2000;
		const MAX_POLLS = 300; // 10 minutes max
		let polls = 0;

		const tick = async () => {
			if (polls >= MAX_POLLS) {
				reindexing = false;
				return;
			}
			polls++;
			try {
				const raw = await api.codebaseIndexStatus(repo);
				status = normalizeStatus(raw as unknown as Record<string, unknown>) as CodebaseIndexStatus;
				if (status.indexing?.in_progress) {
					setTimeout(tick, POLL_INTERVAL);
				} else {
					reindexing = false;
				}
			} catch {
				// Silently retry on transient errors
				setTimeout(tick, POLL_INTERVAL);
			}
		};

		await tick();
	}

	// --- Auto-refresh every 60s + initial load ---
	$effect(() => {
		const currentRepo = repo;
		if (!currentRepo) {
			status = null;
			return;
		}

		void fetchStatus();

		const interval = setInterval(() => {
			// Skip auto-refresh if re-index is in progress (polling handles it)
			if (!reindexing) {
				void fetchStatus();
			}
		}, 60_000);

		return () => {
			clearInterval(interval);
		};
	});
</script>

<div class="index-status">
	{#if loading && !status}
		<!-- Loading skeleton -->
		<div class="index-status-row">
			<div class="status-dot skeleton"></div>
			<div class="skeleton-text"></div>
		</div>
	{:else if error && !status}
		<!-- Error state -->
		<div class="index-status-row error-state">
			<Icon name="triangle-alert" size={13} strokeWidth={2} />
			<span class="error-text">{error}</span>
			<button class="retry-btn" onclick={() => void fetchStatus()} aria-label="Retry fetching index status">
				<Icon name="refresh-cw" size={11} strokeWidth={2.5} />
			</button>
		</div>
	{:else if status?.indexed}
		<!-- Indexed state -->
		<div class="index-status-row" style="background:{statusBgVar};border-color:{statusColorVar}">
			<div class="status-dot" style="background:{statusColorVar};box-shadow:0 0 8px {statusColorVar}"></div>
			<div class="index-info">
				<span class="index-summary">
					Indexed <strong>{status.symbol_count}</strong> symbols across
					<strong>{status.file_count}</strong> files
				</span>
				{#if relativeTime}
					<span class="index-time" style="color:{statusColorVar}">
						Last indexed: {relativeTime}
					</span>
				{/if}
			</div>
			<button
				class="reindex-btn"
				onclick={() => void startReindex()}
				disabled={reindexing}
				aria-label="Re-index repository"
			>
				{#if reindexing}
					<Icon name="loader" size={12} strokeWidth={2} />
					<span>Indexing...</span>
				{:else}
					<Icon name="refresh-cw" size={12} strokeWidth={2} />
					<span>Re-index</span>
				{/if}
			</button>
		</div>

		{#if reindexing && indexingInProgress}
			<div class="indexing-progress">
				<div class="progress-row">
					<Icon name="loader" size={12} strokeWidth={2} />
					<span>Indexing... {indexingFilesParsed}/{indexingTotalFiles} files parsed</span>
				</div>
				<div class="progress-bar-track">
					<div class="progress-bar-fill" style="width:{indexingProgressPercent}%"></div>
				</div>
			</div>
		{/if}
	{:else}
		<!-- Never indexed state -->
		<div class="index-status-row never-indexed">
			<div class="status-dot" style="background:rgba(239,68,68,0.8);box-shadow:0 0 8px rgba(239,68,68,0.5)"></div>
			<div class="index-info">
				<span class="index-summary">Not indexed yet</span>
				<span class="index-time" style="color:rgba(239,68,68,0.8)">Never indexed</span>
			</div>
			<button
				class="reindex-btn primary"
				onclick={() => void startReindex()}
				disabled={reindexing}
				aria-label="Index repository"
			>
				{#if reindexing}
					<Icon name="loader" size={12} strokeWidth={2} />
					<span>Indexing...</span>
				{:else}
					<Icon name="upload-cloud" size={12} strokeWidth={2} />
					<span>Index Now</span>
				{/if}
			</button>
		</div>

		{#if reindexing && indexingInProgress}
			<div class="indexing-progress">
				<div class="progress-row">
					<Icon name="loader" size={12} strokeWidth={2} />
					<span>Indexing... {indexingFilesParsed}/{indexingTotalFiles} files parsed</span>
				</div>
				<div class="progress-bar-track">
					<div class="progress-bar-fill" style="width:{indexingProgressPercent}%"></div>
				</div>
			</div>
		{/if}
	{/if}
</div>

<style>
	.index-status {
		margin-bottom: 16px;
	}

	.index-status-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 14px;
		border-radius: 10px;
		border: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.03);
		transition: all 0.2s ease;
	}

	.index-status-row.error-state {
		background: rgba(239, 68, 68, 0.06);
		border-color: rgba(239, 68, 68, 0.15);
	}

	.index-status-row.never-indexed {
		background: rgba(239, 68, 68, 0.04);
		border-color: rgba(239, 68, 68, 0.12);
	}

	.status-dot {
		width: 8px;
		height: 8px;
		border-radius: 999px;
		flex-shrink: 0;
	}

	.status-dot.skeleton {
		background: var(--color-border);
		animation: pulse-dot 1.5s ease-in-out infinite;
	}

	@keyframes pulse-dot {
		0%,
		100% {
			opacity: 0.4;
		}
		50% {
			opacity: 1;
		}
	}

	.skeleton-text {
		height: 12px;
		width: 160px;
		border-radius: 4px;
		background: var(--color-border);
		animation: pulse-dot 1.5s ease-in-out infinite;
	}

	.index-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.index-summary {
		font-size: 0.78rem;
		color: var(--color-text);
		font-weight: 600;
		line-height: 1.3;
	}

	.index-summary strong {
		font-weight: 800;
	}

	.index-time {
		font-size: 0.65rem;
		font-weight: 600;
		letter-spacing: 0.01em;
	}

	.error-text {
		flex: 1;
		font-size: 0.75rem;
		color: rgba(239, 68, 68, 0.9);
		font-weight: 600;
	}

	.retry-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border-radius: 6px;
		border: 1px solid rgba(239, 68, 68, 0.2);
		background: rgba(239, 68, 68, 0.08);
		color: rgba(239, 68, 68, 0.9);
		cursor: pointer;
		transition: all 0.15s ease;
		flex-shrink: 0;
	}

	.retry-btn:hover {
		background: rgba(239, 68, 68, 0.15);
		border-color: rgba(239, 68, 68, 0.35);
	}

	.reindex-btn {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 5px 12px;
		border-radius: 8px;
		border: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.05);
		color: var(--color-text-muted);
		font-size: 0.68rem;
		font-weight: 700;
		cursor: pointer;
		transition: all 0.15s ease;
		flex-shrink: 0;
		white-space: nowrap;
	}

	.reindex-btn:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.1);
		border-color: var(--color-primary);
		color: var(--color-text);
	}

	.reindex-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.reindex-btn.primary {
		background: linear-gradient(135deg, var(--color-primary), var(--color-accent));
		color: white;
		border: none;
		box-shadow: 0 2px 10px var(--glow-primary);
	}

	.reindex-btn.primary:hover:not(:disabled) {
		opacity: 0.92;
		transform: translateY(-1px);
	}

	/* --- Indexing progress --- */
	.indexing-progress {
		margin-top: 8px;
		padding: 8px 14px;
		border-radius: 8px;
		background: rgba(99, 102, 241, 0.06);
		border: 1px solid rgba(99, 102, 241, 0.12);
	}

	.progress-row {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--color-primary);
		font-size: 0.72rem;
		font-weight: 600;
		margin-bottom: 6px;
	}

	.progress-row :global(svg) {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	.progress-bar-track {
		height: 4px;
		border-radius: 999px;
		background: rgba(99, 102, 241, 0.12);
		overflow: hidden;
	}

	.progress-bar-fill {
		height: 100%;
		border-radius: 999px;
		background: linear-gradient(90deg, var(--color-primary), var(--color-accent));
		transition: width 0.4s ease;
		min-width: 2px;
	}
</style>
