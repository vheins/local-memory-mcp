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

<div class="feature-toolbar glass card">
	<div class="toolbar-title">
		<Icon name="check" size={16} strokeWidth={2} />
		<div>
			<h1 class="section-label">CODING STANDARDS</h1>
			<div class="toolbar-subtitle">
				Rules the agents follow in this repo. Filter, inspect, import, or add one rule at a time.
			</div>
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
</div>

<style>
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
	.section-label {
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
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
