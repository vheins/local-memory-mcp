<script lang="ts">
	import type { CodebaseIndexStatus } from "../lib/api";
	import { api } from "../lib/api";
	import IndexStatusBadge from "./IndexStatusBadge.svelte";
	import IndexProgress from "./IndexProgress.svelte";

	let { repo = "" }: { repo: string } = $props();

	// --- State ---
	let status = $state<CodebaseIndexStatus | null>(null);
	let loading = $state(false);
	let error = $state("");
	let reindexing = $state(false);

	// --- Derived: indexing progress ---
	let indexingInProgress = $derived(status?.indexing?.in_progress === true);
	let indexingFilesParsed = $derived(status?.indexing?.files_parsed ?? 0);
	let indexingTotalFiles = $derived(status?.indexing?.total_files ?? 0);
	let indexingProgressPercent = $derived(indexingTotalFiles > 0 ? (indexingFilesParsed / indexingTotalFiles) * 100 : 0);

	// --- Fetch status ---
	async function fetchStatus() {
		if (!repo) {
			status = null;
			return;
		}
		loading = true;
		error = "";
		try {
			status = await api.codebaseIndexStatus(repo);
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
				status = await api.codebaseIndexStatus(repo);
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
	<IndexStatusBadge {status} {loading} {error} {reindexing} {repo} {fetchStatus} {startReindex} />

	<IndexProgress
		{status}
		{reindexing}
		{indexingInProgress}
		{indexingFilesParsed}
		{indexingTotalFiles}
		{indexingProgressPercent}
	/>
</div>

<style>
	.index-status {
		margin-bottom: 16px;
	}
</style>
