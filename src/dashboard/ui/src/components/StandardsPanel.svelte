<script lang="ts">
	import { onMount } from "svelte";
	import { api } from "../lib/api";
	import StandardSearchBar from "./StandardSearchBar.svelte";
	import StandardsList from "./StandardsList.svelte";
	import DetailDrawer from "./DetailDrawer.svelte";
	import type { CodingStandard } from "../lib/stores";
	import { dedupeTags } from "../lib/utils";
	import { confirmDelete } from "../lib/confirm";

	export let repo = "";

	let standards: CodingStandard[] = [];
	let loading = false;
	let error = "";
	let notice = "";
	let query = "";
	let language = "";
	let stack = "";
	let scope: "repo" | "global" | "all" = "repo";
	let importing = false;
	let exporting = false;

	// Pagination
	let page = 1;
	let pageSize = 25;
	let totalItems = 0;
	let totalPages = 1;

	// Detail drawer
	let selectedStandard: CodingStandard | null = null;
	let standardDrawerOpen = false;

	$: if (repo) {
		void loadStandards();
	}

	async function loadStandards() {
		if (!repo) return;
		loading = true;
		error = "";
		try {
			const result = await api.standards({
				query: query || undefined,
				language: language || undefined,
				stack: stack || undefined,
				repo: scope === "repo" ? repo : undefined,
				is_global: scope === "global" ? true : undefined,
				page,
				pageSize
			});
			standards = (result.standards || []).map((s) => ({ ...s, tags: dedupeTags(s.tags) }));
			totalItems = result.pagination?.totalItems || 0;
			totalPages = result.pagination?.totalPages || 1;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	function onFilterChange() {
		page = 1;
		void loadStandards();
	}

	function goToPage(p: number) {
		if (p < 1 || p > totalPages) return;
		page = p;
		void loadStandards();
	}

	function openCreateDrawer() {
		selectedStandard = null;
		standardDrawerOpen = true;
	}

	function openEditDrawer(std: CodingStandard) {
		selectedStandard = std;
		standardDrawerOpen = true;
	}

	function closeStandardDrawer() {
		standardDrawerOpen = false;
		selectedStandard = null;
	}

	function handleStandardUpdated(_: unknown) {
		void loadStandards();
	}

	function handleStandardDeleted(_: unknown) {
		void loadStandards();
	}

	async function handleBulkDelete(ids: string[]) {
		if (ids.length === 0) return;
		if (!(await confirmDelete(`Are you sure you want to delete ${ids.length} standards?`))) return;
		try {
			await api.bulkStandardAction("delete", ids);
			void loadStandards();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	async function handleDeleteRow(std: CodingStandard) {
		if (!(await confirmDelete(`Delete coding standard "${std.title}"?`))) return;
		try {
			await api.deleteStandard(std.id);
			void loadStandards();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	async function exportStandards() {
		exporting = true;
		error = "";
		notice = "";
		try {
			const payloadScope = scope === "global" || scope === "all" ? scope : "repo";
			const payload = await api.exportStandards({
				repo: payloadScope === "repo" ? repo : undefined,
				scope: payloadScope
			});
			const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			const repoPart = repo ? repo.replace(/[^a-z0-9._-]+/gi, "-") : "all";
			const stamp = new Date().toISOString().slice(0, 10);
			link.download = `standards-${repoPart}-${payloadScope}-${stamp}.json`;
			link.click();
			URL.revokeObjectURL(url);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			exporting = false;
		}
	}

	async function importStandards(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		importing = true;
		error = "";
		notice = "";
		try {
			const payload = JSON.parse(await file.text());
			const standardsCount = Array.isArray(payload?.standards) ? payload.standards.length : 0;
			const result = await api.importStandards({
				...payload,
				refresh_vectors: standardsCount > 0 && standardsCount <= 500
			});
			void loadStandards();
			const vectorNote = result.vectors_refreshed ? "" : " Vector refresh skipped for large import.";
			notice = `Imported ${result.imported} and updated ${result.updated} standard(s).${vectorNote}`;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			importing = false;
			input.value = "";
		}
	}

	onMount(() => {
		void loadStandards();
	});
</script>

<div class="feature-shell animate-fade-in">
	<StandardSearchBar
		bind:query
		bind:language
		bind:stack
		bind:scope
		{exporting}
		{importing}
		standardsCount={standards.length}
		{onFilterChange}
		onExport={exportStandards}
		onImport={importStandards}
		onNewStandard={openCreateDrawer}
	/>

	<div class="insight-strip">
		<div class="insight-card">
			<span>Visible</span>
			<strong>{standards.length}</strong>
		</div>
		<div class="insight-card">
			<span>Scope</span>
			<strong>{scope === "repo" ? "Repo + global" : scope === "global" ? "Global only" : "All"}</strong>
		</div>
		<div class="insight-card">
			<span>Total</span>
			<strong>{totalItems}</strong>
		</div>
		<div class="insight-card">
			<span>Page</span>
			<strong>{page} / {totalPages}</strong>
		</div>
	</div>

	{#if error}
		<div class="error-banner">{error}</div>
	{/if}
	{#if notice}
		<div class="notice-banner">{notice}</div>
	{/if}

	<StandardsList
		{standards}
		{loading}
		{totalPages}
		{page}
		onOpenEditDrawer={openEditDrawer}
		onDeleteRow={handleDeleteRow}
		onGoToPage={goToPage}
		onBulkDelete={handleBulkDelete}
	/>
</div>

<DetailDrawer
	drawerMode="standard"
	standard={selectedStandard}
	open={standardDrawerOpen}
	onClose={closeStandardDrawer}
	onStandardUpdated={handleStandardUpdated}
	onStandardDeleted={handleStandardDeleted}
	{repo}
/>

<style>
	.feature-shell {
		display: flex;
		flex-direction: column;
		gap: 14px;
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

	/* ── Banners ── */
	.error-banner {
		border: 1px solid #fecaca;
		background: #fef2f2;
		color: #dc2626;
		border-radius: 8px;
		padding: 10px 12px;
		font-size: 0.82rem;
		font-weight: 700;
	}
	.notice-banner {
		border: 1px solid #bae6fd;
		background: #f0f9ff;
		color: #0369a1;
		border-radius: 8px;
		padding: 10px 12px;
		font-size: 0.82rem;
		font-weight: 700;
	}

	@media (max-width: 1100px) {
		.insight-strip {
			grid-template-columns: 1fr;
		}
	}
</style>
