<script lang="ts">
	import Icon from "../lib/Icon.svelte";

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
	export let onNewStandard: () => void = () => {};

	let importInput: HTMLInputElement;
</script>

<header class="feature-toolbar card">
	<div class="toolbar-title">
		<Icon name="check" size={18} strokeWidth={2} />
		<div>
			<h1>Coding standards</h1>
			<p>Review the rules agents apply in this workspace, then add or import only what is reusable.</p>
		</div>
	</div>
	<button class="btn btn-primary toolbar-action" on:click={onNewStandard}>
		<Icon name="plus" size={14} strokeWidth={2} />
		Add Rule
	</button>
	<div class="toolbar-actions">
		<button class="btn btn-ghost btn-sm" on:click={onExport} disabled={exporting || standardsCount === 0}>
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
			on:change={onImport}
		/>
	</div>
	<div class="toolbar-controls">
		<input
			class="form-input"
			placeholder="Search standards..."
			aria-label="Search coding standards"
			bind:value={query}
			on:input={onFilterChange}
		/>
		<input
			class="form-input"
			placeholder="Language, e.g. typescript"
			aria-label="Filter by language"
			bind:value={language}
			on:input={onFilterChange}
		/>
		<input
			class="form-input"
			placeholder="Stack tags, e.g. svelte, vite"
			aria-label="Filter by stack tags"
			bind:value={stack}
			on:input={onFilterChange}
		/>
		<select class="form-select" bind:value={scope} on:change={onFilterChange}>
			<option value="repo">Repo + global</option>
			<option value="global">Global only</option>
			<option value="all">All standards</option>
		</select>
	</div>
</header>

<style>
	.feature-toolbar {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto;
		gap: 20px;
		padding: 24px;
		align-items: start;
	}
	.toolbar-title {
		display: flex;
		align-items: flex-start;
		gap: 12px;
	}
	.toolbar-title h1 {
		margin: 0;
		font-size: 1.2rem;
		line-height: 1.25;
		color: var(--color-text);
	}
	.toolbar-title p {
		margin: 6px 0 0;
		max-width: 620px;
		font-size: 0.85rem;
		line-height: 1.5;
		color: var(--color-text-muted);
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
	.toolbar-controls {
		display: grid;
		grid-template-columns: minmax(220px, 1.2fr) minmax(130px, 0.6fr) minmax(180px, 1fr) minmax(140px, 0.6fr);
		gap: 10px;
		grid-column: 1 / -1;
	}

	@media (max-width: 1100px) {
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
