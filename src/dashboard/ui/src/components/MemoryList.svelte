<script lang="ts">
	import {
		memories,
		memoriesTotal,
		memoriesPage,
		memoriesPageSize,
		memoriesTotalPages,
		memoriesSearch,
		memoriesTypeFilter,
		memoriesImportanceMin,
		memoriesSortBy,
		memoriesSortOrder,
		selectedMemoryIds
	} from "../lib/stores";
	import { createMemoryHandler } from "../lib/composables/useMemoryList";
	import { formatDate } from "../lib/utils";
	import type { Memory } from "../lib/stores";
	import Icon from "../lib/Icon.svelte";
	import { TYPES, TYPE_LABELS, importanceColor, importanceBg } from "../lib/memoryConfig";

	export let onMemoryClick: (mem: Memory) => void = () => {};
	/** Called when user wants to create a new memory */
	export let onNewMemory: () => void = () => {};
	export let onBulkImport: () => void = () => {};

	const memoryHandler = createMemoryHandler();

	export function refresh() {
		memoryHandler.loadMemories();
	}

	$: allSelected = $memories.length > 0 && $selectedMemoryIds.size === $memories.length;
</script>

<div>
	<!-- Toolbar -->
	<div class="flex items-center gap-2 mb-3" style="flex-wrap:wrap;">
		<div style="position:relative;flex:1;min-width:160px;">
			<svg
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--color-text-muted);"
			>
				<circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
			</svg>
			<input
				class="form-input"
				style="padding-left:32px;font-size:0.8rem;"
				type="text"
				placeholder="Search memories..."
				bind:value={$memoriesSearch}
				on:input={() => memoryHandler.onSearchInput()}
			/>
		</div>

		<select
			class="form-select"
			style="width:140px;font-size:0.8rem;"
			bind:value={$memoriesTypeFilter}
			on:change={() => memoryHandler.onFilterChange()}
		>
			<option value="">All Types</option>
			{#each TYPES as t}
				<option value={t}>{TYPE_LABELS[t]}</option>
			{/each}
		</select>

		<select
			class="form-select"
			style="width:100px;font-size:0.8rem;"
			bind:value={$memoriesImportanceMin}
			on:change={() => memoryHandler.onFilterChange()}
		>
			<option value={null}>Min Imp.</option>
			{#each [1, 2, 3, 4, 5] as i}
				<option value={i}>{i}</option>
			{/each}
		</select>

		<select
			class="form-select"
			style="width:100px;font-size:0.8rem;"
			bind:value={$memoriesPageSize}
			on:change={() => {
				memoriesPage.set(1);
				memoryHandler.loadMemories();
			}}
		>
			{#each [10, 25, 50, 100] as n}
				<option value={n}>{n} / page</option>
			{/each}
		</select>

		<div class="flex gap-1">
			<button class="btn btn-ghost btn-sm" on:click={() => memoryHandler.handleExport("json")} title="Export JSON">
				<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
					><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line
						x1="12"
						y1="15"
						x2="12"
						y2="3"
					/></svg
				>
				JSON
			</button>
			<button class="btn btn-ghost btn-sm" on:click={() => memoryHandler.handleExport("csv")} title="Export CSV">
				<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
					><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line
						x1="12"
						y1="15"
						x2="12"
						y2="3"
					/></svg
				>
				CSV
			</button>
			<div style="width:1px;height:14px;background:var(--color-border);margin:auto 4px;"></div>
			<button class="btn btn-ghost btn-sm" on:click={onBulkImport} title="Bulk Import">
				<Icon name="upload" size={13} strokeWidth={2} />
				Import
			</button>
		</div>

		<!-- New Memory CTA -->
		<button class="btn btn-accent btn-sm" on:click={onNewMemory} id="newMemoryBtn" style="margin-left:auto;">
			<Icon name="plus" size={13} strokeWidth={2.5} />
			New Memory
		</button>
	</div>

	<!-- Count -->
	<div style="font-size:0.72rem;color:var(--color-text-muted);margin-bottom:8px;">
		{$memoriesTotal} memories
		{$selectedMemoryIds.size > 0 ? `· ${$selectedMemoryIds.size} selected` : ""}
	</div>

	<!-- Table -->
	<div class="mem-table-wrap">
		<table class="mem-table">
			<thead>
				<tr class="mem-thead-row">
					<th class="mem-th" style="width:36px;">
						<input
							type="checkbox"
							checked={allSelected}
							on:change={() => memoryHandler.toggleSelectAll()}
							aria-label="Select all"
						/>
					</th>
					<th class="mem-th sortable" on:click={() => memoryHandler.toggleSort("title")}>
						Title {$memoriesSortBy === "title" ? ($memoriesSortOrder === "desc" ? "↓" : "↑") : ""}
					</th>
					<th class="mem-th">Type</th>
					<th
						class="mem-th"
						style="text-align:center;cursor:pointer;"
						on:click={() => memoryHandler.toggleSort("importance")}
					>
						Imp. {$memoriesSortBy === "importance" ? ($memoriesSortOrder === "desc" ? "↓" : "↑") : ""}
					</th>
					<th class="mem-th sortable" on:click={() => memoryHandler.toggleSort("updated_at")}>
						Updated {$memoriesSortBy === "updated_at" ? ($memoriesSortOrder === "desc" ? "↓" : "↑") : ""}
					</th>
					<th class="mem-th" style="text-align:center;">Hits</th>
					<th class="mem-th" style="width:80px;"></th>
				</tr>
			</thead>
			<tbody>
				{#if memoryHandler.loading}
					{#each Array(5) as _}
						<tr>
							<td colspan="7" class="mem-td">
								<div class="skeleton" style="height:20px;border-radius:6px;"></div>
							</td>
						</tr>
					{/each}
				{:else if $memories.length === 0}
					<tr>
						<td colspan="7" class="mem-td" style="padding:40px;text-align:center;color:var(--color-text-muted);">
							<div style="font-size:2rem;margin-bottom:8px;">🔍</div>
							No memories found
						</td>
					</tr>
				{:else}
					{#each $memories as mem (mem.id)}
						<tr class="mem-row" class:selected={$selectedMemoryIds.has(mem.id)} on:click={() => onMemoryClick(mem)}>
							<td class="mem-td" on:click|stopPropagation>
								<input
									type="checkbox"
									checked={$selectedMemoryIds.has(mem.id)}
									on:change={() => memoryHandler.toggleSelect(mem.id)}
								/>
							</td>
							<td class="mem-td" style="max-width:300px;">
								<div class="truncate font-semibold" style="font-size:0.82rem;color:var(--color-text);">{mem.title}</div>
								{#if mem.tags?.length}
									<div style="margin-top:3px;display:flex;gap:4px;flex-wrap:wrap;">
										{#each mem.tags.slice(0, 3) as tag}
											<span
												style="font-size:0.6rem;background:rgba(99,102,241,0.1);color:#6366f1;padding:1px 5px;border-radius:9999px;"
												>{tag}</span
											>
										{/each}
									</div>
								{/if}
							</td>
							<td class="mem-td">
								<span class="type-chip type-{mem.type}">{TYPE_LABELS[mem.type] || mem.type}</span>
							</td>
							<td class="mem-td" style="text-align:center;">
								<span
									style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:8px;font-size:0.75rem;font-weight:700;background:{importanceBg[
										mem.importance
									] || importanceBg[1]};color:{importanceColor[mem.importance] || importanceColor[1]};"
								>
									{mem.importance}
								</span>
							</td>
							<td class="mem-td" style="font-size:0.75rem;color:var(--color-text-muted);white-space:nowrap;"
								>{formatDate(mem.updated_at)}</td
							>
							<td
								class="mem-td"
								style="text-align:center;font-size:0.75rem;font-weight:600;color:var(--color-text-muted);"
								>{mem.hit_count ?? 0}</td
							>
							<td class="mem-td row-actions" on:click|stopPropagation>
								<button
									class="row-action-btn edit-btn"
									on:click={() => onMemoryClick(mem)}
									title="Edit / View"
									aria-label="Edit memory"
								>
									<Icon name="edit-2" size={13} strokeWidth={2} />
								</button>
								<button
									class="row-action-btn delete-btn"
									on:click={(e) => memoryHandler.handleDeleteRow(mem, e)}
									title="Delete"
									aria-label="Delete memory"
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
	{#if $memoriesTotalPages > 1}
		<div class="flex items-center justify-between mt-3">
			<span style="font-size:0.75rem;color:var(--color-text-muted);">
				Page {$memoriesPage} of {$memoriesTotalPages}
			</span>
			<div class="flex gap-1">
				<button class="btn btn-ghost btn-sm" on:click={() => memoryHandler.goToPage(1)} disabled={$memoriesPage <= 1}
					>«</button
				>
				<button
					class="btn btn-ghost btn-sm"
					on:click={() => memoryHandler.goToPage($memoriesPage - 1)}
					disabled={$memoriesPage <= 1}>‹</button
				>
				{#each Array.from({ length: Math.min(5, $memoriesTotalPages) }, (_, i) => {
					const start = Math.max(1, Math.min($memoriesPage - 2, $memoriesTotalPages - 4));
					return start + i;
				}) as p}
					<button
						class="btn btn-sm"
						class:btn-primary={p === $memoriesPage}
						class:btn-ghost={p !== $memoriesPage}
						on:click={() => memoryHandler.goToPage(p)}>{p}</button
					>
				{/each}
				<button
					class="btn btn-ghost btn-sm"
					on:click={() => memoryHandler.goToPage($memoriesPage + 1)}
					disabled={$memoriesPage >= $memoriesTotalPages}>›</button
				>
				<button
					class="btn btn-ghost btn-sm"
					on:click={() => memoryHandler.goToPage($memoriesTotalPages)}
					disabled={$memoriesPage >= $memoriesTotalPages}>»</button
				>
			</div>
		</div>
	{/if}

	<!-- Bulk Action Toolbar -->
	{#if $selectedMemoryIds.size > 0}
		<div class="bulk-actions-bar">
			<span><b>{$selectedMemoryIds.size}</b> selected</span>
			<div style="width:12px;"></div>
			<button
				class="btn btn-sm"
				style="background:rgba(120,120,120,0.2);color:inherit;"
				on:click={() => selectedMemoryIds.set(new Set())}>Cancel</button
			>
			<button
				class="btn btn-sm"
				style="background:#52525b;color:white;border:none;"
				on:click={() => memoryHandler.handleBulkArchive()}>Archive</button
			>
			<button
				class="btn btn-sm btn-accent"
				style="background:#ef4444;color:white;border:none;"
				on:click={() => memoryHandler.handleBulkDelete()}>Delete</button
			>
		</div>
	{/if}
</div>

<style>
	/* ── Table wrapper ── */
	.mem-table-wrap {
		overflow-x: auto;
		border-radius: 14px;
		border: 1px solid var(--color-border);
	}

	.mem-table {
		width: 100%;
		border-collapse: collapse;
		min-width: 600px;
	}

	/* ── Head ── */
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

	.mem-th.sortable {
		cursor: pointer;
	}
	.mem-th.sortable:hover {
		color: var(--color-text);
	}

	/* ── Rows ── */
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

	.mem-row.selected {
		background: rgba(14, 165, 233, 0.05);
	}

	:global(html.dark) .mem-row.selected {
		background: rgba(14, 165, 233, 0.08);
	}

	/* last row: no bottom border */
	.mem-row:last-child .mem-td {
		border-bottom: none;
	}

	/* ── Row actions ── */
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

	/* ── Bulk Actions Bar ── */
	.bulk-actions-bar {
		position: fixed;
		bottom: 32px;
		left: 50%;
		transform: translateX(-50%);
		background: rgba(30, 41, 59, 0.95);
		backdrop-filter: blur(12px);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 9999px;
		padding: 10px 16px;
		display: flex;
		align-items: center;
		gap: 8px;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
		z-index: 1000;
		color: white;
		font-size: 0.85rem;
		animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
	}

	:global(html:not(.dark)) .bulk-actions-bar {
		background: rgba(255, 255, 255, 0.95);
		color: var(--color-text);
		border-color: var(--color-border);
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
	}

	@keyframes slideUp {
		from {
			opacity: 0;
			transform: translate(-50%, 20px) scale(0.95);
		}
		to {
			opacity: 1;
			transform: translate(-50%, 0) scale(1);
		}
	}
</style>
