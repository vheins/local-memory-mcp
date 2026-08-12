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
<div class="flex items-center gap-2 mb-3" style="flex-wrap:wrap;">
	<div style="position:relative;flex:1;min-width:160px;">
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
		class="form-select"
		style="width:140px;font-size:0.8rem;"
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
		class="form-select"
		style="width:100px;font-size:0.8rem;"
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
		class="form-select"
		style="width:100px;font-size:0.8rem;"
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
	<button class="btn btn-accent btn-sm" onclick={onNewMemory} id="newMemoryBtn" style="margin-left:auto;">
		<Icon name="plus" size={13} strokeWidth={2.5} />
		New Memory
	</button>
</div>

<style>
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
