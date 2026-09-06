<script lang="ts">
	import { onDestroy } from "svelte";
	import { get } from "svelte/store";
	import {
		memories,
		memoriesTotal,
		memoriesPage,
		memoriesTotalPages,
		memoriesSortBy,
		memoriesSortOrder,
		selectedMemoryIds
	} from "../lib/stores";
	import { createMemoryHandler } from "../lib/composables/useMemoryList";
	import { formatDate } from "../lib/utils";
	import type { Memory } from "../lib/stores";
	import Icon from "../lib/Icon.svelte";
	import { TYPE_LABELS, importanceColor, importanceBg } from "../lib/memoryConfig";
	import MemoryCards from "./MemoryCards.svelte";
	import MemoryListToolbar from "./MemoryListToolbar.svelte";
	import MemoryListPagination from "./MemoryListPagination.svelte";
	import MemoryBulkActions from "./MemoryBulkActions.svelte";
	import { ErrorState } from "./ui";

	export let onMemoryClick: (mem: Memory) => void = () => {};
	export let onBulkImport: () => void = () => {};

	const memoryHandler = createMemoryHandler();

	export function refresh() {
		memoryHandler.loadMemories();
	}

	$: allSelected = $memories.length > 0 && $selectedMemoryIds.size === $memories.length;

	function handlePageSizeChange() {
		memoriesPage.set(1);
		memoryHandler.loadMemories();
	}

	function sortIndicator(col: string): string {
		return $memoriesSortBy === col ? ($memoriesSortOrder === "desc" ? "↓" : "↑") : "";
	}

	// ── ARIA live region (STD-002 / TASK-400) ─────────────────────────────
	// One scoped sr-only polite region per async view: announce when the
	// async memories list settles (count or error), never the whole shell.
	let liveRegionText = "";
	// Dedup baseline seeded from the STORE's CURRENT value (not a hardcoded
	// 0, TASK-414): a future store-init change (e.g. a cached total) must
	// never fire a spurious "Loaded N memories" announcement on mount — the
	// subscribe callback receives the same value it was seeded with, so only
	// real post-mount loads announce.
	let lastAnnouncedTotal = get(memoriesTotal);
	const unsubLiveRegion = memoriesTotal.subscribe((total) => {
		if (total === lastAnnouncedTotal) return;
		lastAnnouncedTotal = total;
		liveRegionText = `Loaded ${total} memories`;
	});
	onDestroy(() => unsubLiveRegion());
</script>

<div>
	<div class="sr-only" aria-live="polite" aria-atomic="true">{liveRegionText}</div>

	<MemoryListToolbar
		onSearchInput={() => memoryHandler.onSearchInput()}
		onFilterChange={() => memoryHandler.onFilterChange()}
		onPageSizeChange={handlePageSizeChange}
		onExport={(f) => memoryHandler.handleExport(f)}
		onImport={onBulkImport}
	/>

	<p class="mem-count">
		{$memoriesTotal} memories
		{$selectedMemoryIds.size > 0 ? `· ${$selectedMemoryIds.size} selected` : ""}
	</p>

	<!-- Error State -->
	{#if memoryHandler.error}
		<div class="mem-error-slot">
			<ErrorState
				title="Couldn't load memories"
				description="The request failed. Nothing was changed — retrying is safe."
			>
				{#snippet action()}
					<button class="btn btn-secondary btn-sm" onclick={() => memoryHandler.loadMemories()}>Try again</button>
				{/snippet}
			</ErrorState>
		</div>
	{/if}

	<!-- Table -->
	<div class="mem-table-wrap">
		<table class="mem-table">
			<thead>
				<tr class="mem-thead-row">
					<th class="mem-th" style="width:36px;">
						<input
							type="checkbox"
							checked={allSelected}
							onchange={() => memoryHandler.toggleSelectAll()}
							aria-label="Select all"
						/>
					</th>
					<th class="mem-th sortable" onclick={() => memoryHandler.toggleSort("title")}>
						Title {sortIndicator("title")}
					</th>
					<th class="mem-th">Type</th>
					<th
						class="mem-th"
						style="text-align:center;cursor:pointer;"
						onclick={() => memoryHandler.toggleSort("importance")}
					>
						Imp. {sortIndicator("importance")}
					</th>
					<th class="mem-th sortable" onclick={() => memoryHandler.toggleSort("updated_at")}>
						Updated {sortIndicator("updated_at")}
					</th>
					<th class="mem-th" style="text-align:center;">Hits</th>
					<th class="mem-th" style="width:80px;"></th>
				</tr>
			</thead>
			<tbody>
				{#if memoryHandler.error}
					<tr>
						<td colspan="7" class="mem-td" style="padding:40px;text-align:center;color:var(--color-text-muted);">
							Unable to load memories. Check your connection and try again.
						</td>
					</tr>
				{:else if memoryHandler.loading}
					{#each { length: 5 } as dummy, i (i)}
						<tr data-index={i} data-dummy={dummy}>
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
					{#each $memories as mem, i (`${mem.id}-${i}`)}
						<!-- tabindex="-1": programmatically focusable (not in tab
							order) so the row becomes the focus-restore target when
							the Memory drawer closes (TASK-278 / audit F4). -->
						<tr
							class="mem-row"
							class:selected={$selectedMemoryIds.has(mem.id)}
							tabindex="-1"
							onclick={() => onMemoryClick(mem)}
						>
							<td class="mem-td" onclick={(e) => e.stopPropagation()}>
								<input
									type="checkbox"
									checked={$selectedMemoryIds.has(mem.id)}
									onchange={() => memoryHandler.toggleSelect(mem.id)}
								/>
							</td>
							<td class="mem-td" style="max-width:300px;">
								<div class="truncate font-semibold" style="font-size:0.82rem;color:var(--color-text);">{mem.title}</div>
								{#if mem.tags?.length}
									<div style="margin-top:3px;display:flex;gap:4px;flex-wrap:wrap;">
										{#each mem.tags.slice(0, 3) as tag (tag)}
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
							<td class="mem-td row-actions" onclick={(e) => e.stopPropagation()}>
								<button
									class="row-action-btn edit-btn"
									onclick={() => onMemoryClick(mem)}
									title="Edit / View"
									aria-label="Edit memory"
								>
									<Icon name="edit" size={13} strokeWidth={2} />
								</button>
								<button
									class="row-action-btn delete-btn"
									onclick={(e) => memoryHandler.handleDeleteRow(mem, e)}
									title="Delete"
									aria-label="Delete memory"
								>
									<Icon name="trash" size={13} strokeWidth={2} />
								</button>
							</td>
						</tr>
					{/each}
				{/if}
			</tbody>
		</table>

		<MemoryCards
			memories={$memories}
			loading={memoryHandler.loading}
			hasError={!!memoryHandler.error}
			selectedIds={$selectedMemoryIds}
			onToggleSelect={(id) => memoryHandler.toggleSelect(id)}
			{onMemoryClick}
		/>
	</div>

	<MemoryListPagination
		page={$memoriesPage}
		totalPages={$memoriesTotalPages}
		onGoToPage={(p) => memoryHandler.goToPage(p)}
	/>

	<MemoryBulkActions
		count={$selectedMemoryIds.size}
		onCancel={() => selectedMemoryIds.set(new Set())}
		onArchive={() => memoryHandler.handleBulkArchive()}
		onDelete={() => memoryHandler.handleBulkDelete()}
	/>
</div>

<style>
	.mem-count {
		font-size: var(--text-secondary);
		color: var(--color-text-muted);
		margin-bottom: var(--space-2);
		font-variant-numeric: tabular-nums;
	}

	.mem-error-slot {
		margin-bottom: var(--space-3);
	}

	/* ── Table wrapper ── */
	.mem-table-wrap {
		overflow-x: auto;
		border-radius: 14px;
		border: 1px solid var(--color-border);
		background: var(--color-surface, #fff);
	}

	.mem-table {
		width: 100%;
		border-collapse: collapse;
		min-width: 680px;
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

	@media (pointer: coarse) {
		.row-action-btn {
			width: 44px;
			height: 44px;
		}
	}

	.row-action-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		/* 36px minimum, 44px on coarse pointers. The previous 32px was itself a
		   fix for a 22px original, but 32px still sits below the WCAG 2.2
		   target-size floor — measured, not assumed. */
		width: 36px;
		height: 36px;
		border-radius: var(--radius-sm);
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

	@media (max-width: 720px) {
		.mem-table {
			display: none;
		}

		.mem-table-wrap {
			overflow: visible;
			border: 0;
			background: transparent;
		}
	}
</style>
