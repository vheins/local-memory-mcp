<script module lang="ts">
	function getKindIcon(kind: string): string {
		const icons: Record<string, string> = {
			function: "zap",
			class: "layers",
			interface: "terminal",
			type: "hash",
			enum: "list",
			variable: "database",
			other: "code"
		};
		return icons[kind] || "code";
	}
</script>

<script lang="ts">
	import Icon from "../lib/Icon.svelte";
	import { api, type CodeSymbol } from "../lib/api";

	let {
		repo = "",
		onSymbolSelect = (symbol: CodeSymbol) => {}
	}: {
		repo: string;
		onSymbolSelect: (symbol: CodeSymbol) => void;
	} = $props();

	// State
	let query = $state("");
	let results = $state<CodeSymbol[]>([]);
	let loading = $state(false);
	let error = $state("");
	let isOpen = $state(false);
	let selectedIndex = $state(-1);
	let inputEl = $state<HTMLInputElement | null>(null);
	let containerEl = $state<HTMLDivElement | null>(null);

	// Derived
	let groupedResults = $derived.by(() => {
		const groups: Record<string, CodeSymbol[]> = {};
		for (const symbol of results) {
			const kind = symbol.kind || "other";
			if (!groups[kind]) groups[kind] = [];
			groups[kind].push(symbol);
		}
		return groups;
	});

	// Effects
	$effect(() => {
		const currentQuery = query;
		const currentRepo = repo;

		if (currentQuery.length < 2 || !currentRepo) {
			results = [];
			isOpen = false;
			return;
		}

		loading = true;
		error = "";

		const timer = setTimeout(async () => {
			try {
				const response = await api.codebaseSearch(currentRepo, currentQuery, 10);
				results = response.results || [];
				isOpen = results.length > 0;
				selectedIndex = -1;
			} catch (err) {
				error = err instanceof Error ? err.message : "Search failed";
				results = [];
				isOpen = false;
			} finally {
				loading = false;
			}
		}, 300);

		return () => {
			clearTimeout(timer);
		};
	});

	// Click outside handler
	$effect(() => {
		const handler = (event: MouseEvent) => {
			if (containerEl && !containerEl.contains(event.target as Node)) {
				isOpen = false;
			}
		};

		document.addEventListener("click", handler);
		return () => {
			document.removeEventListener("click", handler);
		};
	});

	function handleKeydown(event: KeyboardEvent) {
		if (!isOpen && results.length === 0) {
			return;
		}

		switch (event.key) {
			case "ArrowDown":
				event.preventDefault();
				selectedIndex = Math.min(selectedIndex + 1, results.length - 1);
				break;
			case "ArrowUp":
				event.preventDefault();
				selectedIndex = Math.max(selectedIndex - 1, -1);
				break;
			case "Enter":
				event.preventDefault();
				if (selectedIndex >= 0 && selectedIndex < results.length) {
					selectSymbol(results[selectedIndex]);
				}
				break;
			case "Escape":
				event.preventDefault();
				isOpen = false;
				selectedIndex = -1;
				break;
		}
	}

	function selectSymbol(symbol: CodeSymbol) {
		onSymbolSelect(symbol);
		query = symbol.name;
		isOpen = false;
		selectedIndex = -1;
		inputEl?.blur();
	}

	function getResultIndex(symbol: CodeSymbol): number {
		return results.indexOf(symbol);
	}

	function truncatePath(path: string, maxLength: number = 20): string {
		if (path.length <= maxLength) return path;
		return "..." + path.slice(-(maxLength - 3));
	}
</script>

<div class="search-bar-container" bind:this={containerEl}>
	<div class="search-input-wrapper">
		<div class="search-icon">
			<Icon name="search" size={16} strokeWidth={2} />
		</div>
		<input
			type="text"
			class="search-input"
			placeholder="Search symbols in this repository..."
			bind:value={query}
			bind:this={inputEl}
			onkeydown={handleKeydown}
			onfocus={() => {
				if (results.length > 0) isOpen = true;
			}}
			aria-label="Search codebase symbols"
			aria-autocomplete="list"
			aria-controls="search-results-list"
			aria-activedescendant={selectedIndex >= 0 ? `search-result-${selectedIndex}` : undefined}
		/>
		{#if loading}
			<div class="search-spinner">
				<Icon name="loader" size={14} strokeWidth={2} />
			</div>
		{/if}
	</div>

	{#if isOpen && (results.length > 0 || error)}
		<div class="search-dropdown" id="search-results-list" role="listbox">
			{#if error}
				<div class="search-error">
					<Icon name="alert-circle" size={14} strokeWidth={2} />
					<span>{error}</span>
				</div>
			{:else if results.length === 0}
				<div class="search-empty">No symbols found</div>
			{:else}
				{#each Object.entries(groupedResults) as [kind, symbols] (kind)}
					<div class="search-group">
						<div class="search-group-header">
							<Icon name={getKindIcon(kind)} size={12} strokeWidth={2} />
							<span>{kind}</span>
						</div>
						{#each symbols as symbol (symbol.name + symbol.filePath)}
							<button
								class="search-result"
								class:selected={getResultIndex(symbol) === selectedIndex}
								id="search-result-{getResultIndex(symbol)}"
								role="option"
								aria-selected={getResultIndex(symbol) === selectedIndex}
								onclick={() => selectSymbol(symbol)}
							>
								<div class="result-icon">
									<Icon name={getKindIcon(symbol.kind)} size={14} strokeWidth={1.75} />
								</div>
								<div class="result-info">
									<div class="result-name">{symbol.name}</div>
									<div class="result-meta">
										{#if symbol.filePath}
											<span class="result-path">{truncatePath(symbol.filePath)}</span>
										{/if}
										{#if symbol.line != null}
											<span class="result-line">:{symbol.line}</span>
										{/if}
									</div>
								</div>
							</button>
						{/each}
					</div>
				{/each}
			{/if}
		</div>
	{/if}
</div>

<style>
	.search-bar-container {
		position: relative;
		width: 100%;
		margin-bottom: 16px;
	}

	.search-input-wrapper {
		position: relative;
		display: flex;
		align-items: center;
	}

	.search-icon {
		position: absolute;
		left: 12px;
		color: var(--color-text-muted);
		pointer-events: none;
	}

	.search-input {
		width: 100%;
		padding: 10px 36px 10px 36px;
		border-radius: 10px;
		border: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.04);
		color: var(--color-text);
		font-size: 0.85rem;
		font-family: inherit;
		transition: all 0.15s ease;
		outline: none;
	}

	.search-input:focus {
		border-color: var(--color-primary);
		background: rgba(255, 255, 255, 0.06);
		box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
	}

	.search-input::placeholder {
		color: var(--color-text-muted);
		opacity: 0.6;
	}

	.search-spinner {
		position: absolute;
		right: 12px;
		color: var(--color-primary);
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	.search-dropdown {
		position: absolute;
		top: 100%;
		left: 0;
		right: 0;
		margin-top: 4px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
		max-height: 400px;
		overflow-y: auto;
		z-index: 50;
	}

	.search-error {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 16px;
		color: #ef4444;
		font-size: 0.78rem;
	}

	.search-empty {
		padding: 12px 16px;
		color: var(--color-text-muted);
		font-size: 0.78rem;
		text-align: center;
	}

	.search-group {
		padding: 8px 0;
	}

	.search-group:first-child {
		padding-top: 4px;
	}

	.search-group:last-child {
		padding-bottom: 4px;
	}

	.search-group-header {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 16px;
		font-size: 0.68rem;
		font-weight: 700;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.search-result {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 8px 16px;
		border: none;
		background: transparent;
		text-align: left;
		cursor: pointer;
		transition: background 0.1s ease;
		border-radius: 0;
		font-family: inherit;
	}

	.search-result:hover,
	.search-result.selected {
		background: rgba(255, 255, 255, 0.06);
	}

	.result-icon {
		color: var(--color-primary);
		flex-shrink: 0;
	}

	.result-info {
		flex: 1;
		min-width: 0;
	}

	.result-name {
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--color-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.result-meta {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 0.68rem;
		color: var(--color-text-muted);
	}

	.result-path {
		font-family: "SF Mono", "Fira Code", monospace;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 150px;
	}

	.result-line {
		font-family: "SF Mono", "Fira Code", monospace;
		opacity: 0.8;
	}
</style>
