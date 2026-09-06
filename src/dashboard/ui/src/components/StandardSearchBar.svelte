<script lang="ts">
	import Icon from "../lib/Icon.svelte";
	import Toolbar from "./ui/Toolbar.svelte";

	/**
	 * Filter row for the coding-standards collection.
	 *
	 * As with HandoffFilterBar, this was a `feature-toolbar card` doing four
	 * jobs at once: the page `<h1>` + description, the primary "Add Rule"
	 * action, export/import controls, and the filters — laid out in a
	 * three-column grid whose second row spanned `1 / -1` with its own
	 * four-column sub-grid and a 1100px breakpoint.
	 *
	 * Title and primary action move to the view's PageHeader. Export/import are
	 * secondary actions and stay here, next to the filters they operate on.
	 */
	export let query = "";
	export let language = "";
	export let stack = "";
	export let scope: "repo" | "global" | "all" = "repo";
	export let exporting = false;
	export let importing = false;
	export let standardsCount = 0;
	export let onFilterChange: () => void = () => {};
	export let onExport: () => void = () => {};
	export let onImport: (event: Event) => void = () => {};

	let importInput: HTMLInputElement;
</script>

<Toolbar label="Standard filters">
	{#snippet search()}
		<input
			class="form-input"
			placeholder="Search standards…"
			aria-label="Search coding standards"
			bind:value={query}
			on:input={onFilterChange}
		/>
	{/snippet}

	{#snippet filters()}
		<input
			class="form-input filter-input"
			placeholder="Language"
			aria-label="Filter by language"
			bind:value={language}
			on:input={onFilterChange}
		/>
		<input
			class="form-input filter-input"
			placeholder="Stack tags"
			aria-label="Filter by stack tags"
			bind:value={stack}
			on:input={onFilterChange}
		/>
		<select class="form-select" bind:value={scope} on:change={onFilterChange} aria-label="Standard scope">
			<option value="repo">Repo + global</option>
			<option value="global">Global only</option>
			<option value="all">All standards</option>
		</select>
	{/snippet}

	{#snippet actions()}
		<button class="btn btn-secondary" on:click={onExport} disabled={exporting || standardsCount === 0}>
			<Icon name="download" size={14} strokeWidth={2} />
			{exporting ? "Exporting…" : "Export"}
		</button>
		<button class="btn btn-secondary" on:click={() => importInput?.click()} disabled={importing}>
			<Icon name="upload" size={14} strokeWidth={2} />
			{importing ? "Importing…" : "Import"}
		</button>
		<input
			bind:this={importInput}
			class="file-input"
			type="file"
			accept="application/json,.json"
			on:change={onImport}
		/>
	{/snippet}
</Toolbar>

<style>
	.file-input {
		display: none;
	}

	.filter-input {
		max-width: 180px;
	}

	@media (max-width: 720px) {
		.filter-input {
			max-width: none;
		}
	}
</style>
