<script lang="ts">
	import { memoriesSearch, memoriesTypeFilter, memoriesImportanceMin, memoriesPageSize } from "../lib/stores";
	import Icon from "../lib/Icon.svelte";
	import ExportToolbar from "./ExportToolbar.svelte";
	import { TYPES, TYPE_LABELS } from "../lib/memoryConfig";
	import Toolbar from "./ui/Toolbar.svelte";

	/**
	 * Filter row for the memory collection.
	 *
	 * The "New Memory" primary action used to live here, as the sixth cell of a
	 * six-column grid, visually equal to a page-size dropdown. A page's primary
	 * action does not belong at the end of a filter row — it now sits in the
	 * page header (MemoriesView), leaving this component with a single
	 * responsibility: narrowing the list.
	 *
	 * The bespoke grid with three breakpoints and `grid-row` reordering hacks is
	 * replaced by the shared Toolbar primitive, so this row wraps the same way
	 * as every other collection in the app.
	 */
	const DEFAULT_TYPE = "";
	const DEFAULT_IMPORTANCE: number | null = null;
	const DEFAULT_PAGE_SIZE = 25;

	let {
		onSearchInput = () => {},
		onFilterChange = () => {},
		onPageSizeChange = () => {},
		onExport = (_format: "json" | "csv") => {},
		onImport = () => {},
		onClear = () => {}
	}: {
		onSearchInput?: () => void;
		onFilterChange?: () => void;
		onPageSizeChange?: () => void;
		onExport?: (format: "json" | "csv") => void;
		onImport?: () => void;
		onClear?: () => void;
	} = $props();

	let activeFilterCount = $derived(
		($memoriesTypeFilter !== DEFAULT_TYPE ? 1 : 0) +
			($memoriesImportanceMin !== DEFAULT_IMPORTANCE ? 1 : 0) +
			(Number($memoriesPageSize) !== DEFAULT_PAGE_SIZE ? 1 : 0)
	);

	/**
	 * Reset all filters and pagination size to their default values.
	 */
	function handleClearAll() {
		$memoriesTypeFilter = DEFAULT_TYPE;
		$memoriesImportanceMin = DEFAULT_IMPORTANCE;
		$memoriesPageSize = DEFAULT_PAGE_SIZE;
		onFilterChange();
		onClear();
	}
</script>

<Toolbar label="Memory filters">
	{#snippet search()}
		<div class="search-field">
			<span class="search-icon-inner" aria-hidden="true">
				<Icon name="search" size={16} />
			</span>
			<input
				class="form-input search-input"
				type="text"
				placeholder="Search memories…"
				aria-label="Search memories"
				bind:value={$memoriesSearch}
				oninput={onSearchInput}
			/>
		</div>
	{/snippet}

	{#snippet filters()}
		<select
			class="form-select filter-select"
			aria-label="Filter memories by type"
			bind:value={$memoriesTypeFilter}
			onchange={onFilterChange}
		>
			<option value="">All types</option>
			{#each TYPES as t (t)}
				<option value={t}>{TYPE_LABELS[t]}</option>
			{/each}
		</select>

		<select
			class="form-select filter-select"
			aria-label="Minimum importance"
			bind:value={$memoriesImportanceMin}
			onchange={onFilterChange}
		>
			<option value={null}>Any importance</option>
			{#each [1, 2, 3, 4, 5] as i (i)}
				<option value={i}>Importance {i}+</option>
			{/each}
		</select>

		<select
			class="form-select filter-select"
			aria-label="Memories per page"
			bind:value={$memoriesPageSize}
			onchange={onPageSizeChange}
		>
			{#each [10, 25, 50, 100] as n (n)}
				<option value={n}>{n} per page</option>
			{/each}
		</select>

		{#if activeFilterCount > 0}
			<div class="filter-status">
				<span
					class="filter-badge active-badge badge"
					aria-label="{activeFilterCount} active {activeFilterCount === 1 ? 'filter' : 'filters'}"
				>
					<span class="filter-count">{activeFilterCount}</span>
					<span>active</span>
				</span>
				<button
					type="button"
					class="clear-btn"
					onclick={handleClearAll}
					title="Clear all filters"
					aria-label="Clear all filters"
				>
					<Icon name="circle-x" size={14} />
					<span>Clear all</span>
				</button>
			</div>
		{/if}
	{/snippet}

	{#snippet actions()}
		<ExportToolbar {onExport} {onImport} />
	{/snippet}
</Toolbar>

<style>
	.search-field {
		position: relative;
		min-width: 0;
	}

	.search-input {
		width: 100%;
		padding-left: var(--space-7);
	}

	.search-icon-inner {
		position: absolute;
		left: var(--space-3);
		top: 50%;
		transform: translateY(-50%);
		color: var(--color-text-muted);
		display: flex;
		pointer-events: none;
	}

	.filter-select {
		width: auto;
		flex: 0 1 auto;
		max-width: 180px;
		min-width: 0;
	}

	.filter-status {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		flex-shrink: 0;
	}

	.filter-badge {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		min-height: 28px;
		padding: 2px var(--space-2);
		border-radius: var(--radius-pill);
		background: var(--color-primary-soft);
		color: var(--color-primary-on-soft);
		border: 1px solid rgba(37, 99, 235, 0.2);
		font-size: var(--text-label);
		font-weight: var(--weight-medium);
		letter-spacing: 0.02em;
	}

	.filter-count {
		font-size: 0.65rem;
		background: var(--color-primary);
		color: #ffffff;
		border-radius: var(--radius-pill);
		padding: 0 var(--space-1);
		min-width: 16px;
		text-align: center;
		line-height: 16px;
		font-weight: var(--weight-bold);
	}

	.clear-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		min-height: 28px;
		padding: 2px var(--space-2);
		border: 1px solid rgba(239, 68, 68, 0.25);
		border-radius: var(--radius-sm);
		background: rgba(239, 68, 68, 0.08);
		color: var(--stat-red, var(--color-danger));
		cursor: pointer;
		font-size: var(--text-label);
		font-weight: var(--weight-semibold);
		transition: all var(--duration-base) var(--ease-smooth);
		white-space: nowrap;
	}

	.clear-btn:hover {
		background: rgba(239, 68, 68, 0.16);
		border-color: rgba(239, 68, 68, 0.45);
	}

	.clear-btn:focus-visible {
		outline: 2px solid var(--color-danger);
		outline-offset: 2px;
	}

	@media (max-width: 720px) {
		.filter-select {
			max-width: none;
			width: 100%;
		}

		.filter-status {
			width: 100%;
			justify-content: center;
		}
	}

	@media (pointer: coarse) {
		.clear-btn {
			min-height: 44px;
			min-width: 44px;
		}
	}
</style>
