<script lang="ts">
	import { onMount } from "svelte";
	import { api } from "../lib/api";
	import Icon from "../lib/Icon.svelte";
	import DetailDrawer from "./DetailDrawer.svelte";
	import { formatDate } from "../lib/utils";
	import type { CodingStandard, Pagination } from "../lib/stores";

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
	let importInput: HTMLInputElement;

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
			standards = result.standards || [];
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

	function handleStandardUpdated(_std: CodingStandard) {
		void loadStandards();
	}

	function handleStandardDeleted(_id: string) {
		void loadStandards();
	}

	async function handleDeleteRow(std: CodingStandard) {
		if (!confirm(`Delete coding standard "${std.title}"?`)) return;
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

	$: paginationStart = Math.max(1, Math.min(page - 2, totalPages - 4));
	$: paginationPages = Array.from({ length: Math.min(5, totalPages) }, (_, i) => paginationStart + i);

	onMount(() => {
		void loadStandards();
	});
</script>

<div class="feature-shell animate-fade-in">
	<div class="feature-toolbar glass card">
		<div class="toolbar-title">
			<Icon name="check" size={16} strokeWidth={2} />
			<div>
				<div class="section-label">CODING STANDARDS</div>
				<div class="toolbar-subtitle">
					Rules the agents follow in this repo. Filter, inspect, import, or add one rule at a time.
				</div>
			</div>
		</div>
		<button class="btn btn-primary toolbar-action" on:click={openCreateDrawer}>
			<Icon name="plus" size={14} strokeWidth={2} />
			Add Rule
		</button>
		<div class="toolbar-actions">
			<button class="btn btn-ghost btn-sm" on:click={exportStandards} disabled={exporting || standards.length === 0}>
				<Icon name="download" size={14} strokeWidth={2} />
				{exporting ? "Exporting..." : "Export"}
			</button>
			<button class="btn btn-ghost btn-sm" on:click={() => importInput?.click()} disabled={importing}>
				<Icon name="upload" size={14} strokeWidth={2} />
				{importing ? "Importing..." : "Import"}
			</button>
			<input
				bind:this={importInput}
				class="file-input"
				type="file"
				accept="application/json,.json"
				on:change={importStandards}
			/>
		</div>
		<div class="toolbar-controls">
			<input class="form-input" placeholder="Search standards..." bind:value={query} on:input={onFilterChange} />
			<input
				class="form-input"
				placeholder="Language, e.g. typescript"
				bind:value={language}
				on:input={onFilterChange}
			/>
			<input
				class="form-input"
				placeholder="Stack tags, e.g. svelte, vite"
				bind:value={stack}
				on:input={onFilterChange}
			/>
			<select class="form-select" bind:value={scope} on:change={onFilterChange}>
				<option value="repo">Repo + global</option>
				<option value="global">Global only</option>
				<option value="all">All standards</option>
			</select>
		</div>
	</div>

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

	<!-- Table -->
	<div class="mem-table-wrap">
		<table class="mem-table">
			<thead>
				<tr class="mem-thead-row">
					<th class="mem-th" style="min-width:200px;">Title</th>
					<th class="mem-th">Context</th>
					<th class="mem-th">Version</th>
					<th class="mem-th">Language</th>
					<th class="mem-th">Updated</th>
					<th class="mem-th">Scope</th>
					<th class="mem-th" style="width:80px;"></th>
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
				{:else if standards.length === 0}
					<tr>
						<td colspan="7" class="mem-td" style="padding:40px;text-align:center;color:var(--color-text-muted);">
							<Icon name="check" size={22} strokeWidth={1.75} />
							<div style="margin-top:8px;">No standards found</div>
							<div style="font-size:0.78rem;margin-top:4px;">Adjust the filters or create a standard.</div>
						</td>
					</tr>
				{:else}
					{#each standards as std (std.id)}
						<tr
							class="mem-row"
							on:click={() => openEditDrawer(std)}
							role="button"
							tabindex="0"
							on:keydown={(e) => e.key === "Enter" && openEditDrawer(std)}
						>
							<td class="mem-td" style="max-width:300px;">
								<div class="truncate font-semibold" style="font-size:0.82rem;color:var(--color-text);">{std.title}</div>
								{#if std.tags?.length}
									<div style="margin-top:3px;display:flex;gap:4px;flex-wrap:wrap;">
										{#each std.tags.slice(0, 4) as tag (tag)}
											<span
												style="font-size:0.6rem;background:rgba(99,102,241,0.1);color:#6366f1;padding:1px 5px;border-radius:9999px;"
												>{tag}</span
											>
										{/each}
									</div>
								{/if}
							</td>
							<td class="mem-td" style="font-size:0.78rem;color:var(--color-text);">{std.context || "—"}</td>
							<td class="mem-td" style="font-size:0.75rem;color:var(--color-text-muted);">v{std.version}</td>
							<td class="mem-td" style="font-size:0.78rem;color:var(--color-text);">{std.language || "any"}</td>
							<td class="mem-td" style="font-size:0.75rem;color:var(--color-text-muted);white-space:nowrap;"
								>{formatDate(std.updated_at)}</td
							>
							<td class="mem-td">
								<span
									class="scope-chip"
									class:scope-global={std.is_global}
									class:scope-repo={!std.is_global}
									>{std.is_global ? "Global" : "Repo"}</span
								>
							</td>
							<td class="mem-td row-actions" on:click|stopPropagation>
								<button
									class="row-action-btn edit-btn"
									on:click={() => openEditDrawer(std)}
									title="Edit / View"
									aria-label="Edit standard"
								>
									<Icon name="edit-2" size={13} strokeWidth={2} />
								</button>
								<button
									class="row-action-btn delete-btn"
									on:click={() => handleDeleteRow(std)}
									title="Delete"
									aria-label="Delete standard"
								>
									<Icon name="trash-2" size={13} strokeWidth={2} />
								</button>
							</td>
						</tr>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>

	<!-- Pagination -->
	{#if totalPages > 1}
		<div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px;">
			<span style="font-size:0.75rem;color:var(--color-text-muted);">
				Page {page} of {totalPages}
			</span>
			<div style="display:flex;gap:4px;">
				<button class="btn btn-ghost btn-sm" on:click={() => goToPage(1)} disabled={page <= 1}>«</button>
				<button class="btn btn-ghost btn-sm" on:click={() => goToPage(page - 1)} disabled={page <= 1}>‹</button>
				{#each paginationPages as p (p)}
					<button
						class="btn btn-sm"
						class:btn-primary={p === page}
						class:btn-ghost={p !== page}
						on:click={() => goToPage(p)}>{p}</button
					>
				{/each}
				<button class="btn btn-ghost btn-sm" on:click={() => goToPage(page + 1)} disabled={page >= totalPages}>›</button>
				<button class="btn btn-ghost btn-sm" on:click={() => goToPage(totalPages)} disabled={page >= totalPages}>»</button>
			</div>
		</div>
	{/if}
</div>

<DetailDrawer
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
	.feature-toolbar {
		display: grid;
		grid-template-columns: 1fr auto auto;
		gap: 14px;
		padding: 16px;
		align-items: start;
	}
	.toolbar-title {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.toolbar-action {
		justify-self: end;
	}
	.toolbar-actions {
		display: flex;
		gap: 8px;
		justify-self: end;
		flex-wrap: wrap;
	}
	.file-input {
		display: none;
	}
	.toolbar-subtitle {
		font-size: 0.72rem;
		color: var(--color-text-muted);
		font-weight: 600;
		margin-top: 2px;
		line-height: 1.45;
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
		grid-template-columns: minmax(220px, 1.2fr) minmax(130px, 0.6fr) minmax(180px, 1fr) minmax(140px, 0.6fr);
		gap: 10px;
		grid-column: 1 / -1;
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
		min-width: 600px;
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
		width: 28px;
		height: 28px;
		border-radius: 7px;
		border: none;
		cursor: pointer;
		background: transparent;
		transition:
			background 0.15s ease,
			color 0.15s ease;
		color: var(--color-text-muted);
	}

	.edit-btn:hover {
		background: rgba(14, 165, 233, 0.1);
		color: #0ea5e9;
	}

	:global(html.dark) .edit-btn:hover {
		background: rgba(14, 165, 233, 0.15);
		color: #38bdf8;
	}

	.delete-btn:hover {
		background: rgba(239, 68, 68, 0.1);
		color: #ef4444;
	}

	:global(html.dark) .delete-btn:hover {
		background: rgba(239, 68, 68, 0.15);
		color: #fca5a5;
	}

	/* ── Scope chips ── */
	.scope-chip {
		font-size: 0.68rem;
		font-weight: 700;
		padding: 2px 8px;
		border-radius: 9999px;
		display: inline-block;
	}

	.scope-global {
		background: rgba(168, 85, 247, 0.1);
		color: #a855f7;
		border: 1px solid rgba(168, 85, 247, 0.2);
	}

	.scope-repo {
		background: rgba(14, 165, 233, 0.1);
		color: #0ea5e9;
		border: 1px solid rgba(14, 165, 233, 0.2);
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
		.insight-strip,
		.toolbar-controls {
			grid-template-columns: 1fr;
		}
		.feature-toolbar {
			grid-template-columns: 1fr;
		}
		.toolbar-action,
		.toolbar-actions {
			justify-self: stretch;
			justify-content: center;
		}
	}
</style>
