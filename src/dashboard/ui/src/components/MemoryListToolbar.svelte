<script lang="ts">
	import { memoriesSearch, memoriesTypeFilter, memoriesImportanceMin, memoriesPageSize } from "../lib/stores";
	import Icon from "../lib/Icon.svelte";
	import ExportToolbar from "./ExportToolbar.svelte";
	import { TYPES, TYPE_LABELS } from "../lib/memoryConfig";

	let {
		onSearchInput = () => {},
		onFilterChange = () => {},
		onPageSizeChange = () => {},
		onNewMemory = () => {},
		onExport = (_format: "json" | "csv") => {},
		onImport = () => {}
	}: {
		onSearchInput?: () => void;
		onFilterChange?: () => void;
		onPageSizeChange?: () => void;
		onNewMemory?: () => void;
		onExport?: (format: "json" | "csv") => void;
		onImport?: () => void;
	} = $props();
</script>

<!-- Toolbar -->
<div class="memory-toolbar mb-3">
	<div class="search-field">
		<span class="search-icon-inner">
			<Icon name="search" size={20} />
		</span>
		<input
			class="form-input"
			style="padding-left:32px;font-size:0.8rem;"
			type="text"
			placeholder="Search memories..."
			aria-label="Search memories"
			bind:value={$memoriesSearch}
			oninput={onSearchInput}
		/>
	</div>

	<select
		class="form-select filter-type"
		style="font-size:0.8rem;"
		aria-label="Filter memories by type"
		bind:value={$memoriesTypeFilter}
		onchange={onFilterChange}
	>
		<option value="">All Types</option>
		{#each TYPES as t (t)}
			<option value={t}>{TYPE_LABELS[t]}</option>
		{/each}
	</select>

	<select
		class="form-select filter-compact"
		style="font-size:0.8rem;"
		aria-label="Minimum importance"
		bind:value={$memoriesImportanceMin}
		onchange={onFilterChange}
	>
		<option value={null}>Min Imp.</option>
		{#each [1, 2, 3, 4, 5] as i (i)}
			<option value={i}>{i}</option>
		{/each}
	</select>

	<select
		class="form-select filter-compact"
		style="font-size:0.8rem;"
		aria-label="Memories per page"
		bind:value={$memoriesPageSize}
		onchange={onPageSizeChange}
	>
		{#each [10, 25, 50, 100] as n (n)}
			<option value={n}>{n} / page</option>
		{/each}
	</select>

	<ExportToolbar {onExport} {onImport} />

	<!-- New Memory CTA -->
	<button class="btn btn-primary" onclick={onNewMemory} id="newMemoryBtn">
		<Icon name="plus" size={13} strokeWidth={2.5} />
		New Memory
	</button>
</div>

<style>
	.memory-toolbar {
		display: grid;
		grid-template-columns: minmax(240px, 1fr) 150px 112px 112px auto auto;
		align-items: center;
		gap: 8px;
	}

	.search-field {
		position: relative;
		min-width: 0;
	}

	@media (max-width: 1050px) {
		.memory-toolbar {
			grid-template-columns: minmax(220px, 1fr) repeat(3, minmax(100px, auto));
		}

		.memory-toolbar :global(.export-toolbar),
		#newMemoryBtn {
			grid-row: 2;
		}

		#newMemoryBtn {
			grid-column: -2 / -1;
		}
	}

	@media (max-width: 640px) {
		.memory-toolbar {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.search-field,
		.filter-type,
		#newMemoryBtn {
			grid-column: 1 / -1;
		}

		#newMemoryBtn {
			grid-row: 1;
		}

		.filter-compact {
			width: 100%;
		}
	}

	.search-icon-inner {
		position: absolute;
		left: 10px;
		top: 50%;
		transform: translateY(-50%);
		color: var(--color-text-muted);
		display: flex;
		pointer-events: none;
	}
</style>
