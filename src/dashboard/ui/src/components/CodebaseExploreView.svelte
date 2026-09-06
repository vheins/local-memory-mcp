<script lang="ts">
	/**
	 * Explore mode: find one thing and read it.
	 *
	 * Owns nothing — every piece of state is passed in and every action is a
	 * callback, so this stays a presentation shell. The parent keeps the
	 * selection because Insights can also drive it (clicking a dead-code entry
	 * or a graph node switches back here with a target already chosen).
	 */
	import Icon from "../lib/Icon.svelte";
	import type { CodeSymbol } from "../lib/api";
	import CodebaseSearchBar from "./CodebaseSearchBar.svelte";
	import CodebaseSymbolDetail from "./CodebaseSymbolDetail.svelte";
	import CodebaseFileViewer from "./CodebaseFileViewer.svelte";
	import CodebaseSymbolList from "./CodebaseSymbolList.svelte";

	let {
		repo,
		selectedSymbol,
		selectedFile,
		fileSymbols,
		fileSymbolsLoading,
		fileSymbolsError,
		onSymbolSelect,
		onOpenFile
	}: {
		repo: string;
		selectedSymbol: CodeSymbol | null;
		selectedFile: string | null;
		fileSymbols: CodeSymbol[];
		fileSymbolsLoading: boolean;
		fileSymbolsError: string;
		onSymbolSelect: (symbol: CodeSymbol) => void;
		onOpenFile: (path: string) => void;
	} = $props();
</script>

<section class="explore-view" aria-label="Explore codebase">
	<CodebaseSearchBar {repo} {onSymbolSelect} />
	<div class="explore-result">
		{#if selectedSymbol}
			<CodebaseSymbolDetail
				symbol={selectedSymbol}
				references={[]}
				loading={false}
				{repo}
				{onSymbolSelect}
				{onOpenFile}
			/>
		{:else if selectedFile}
			<CodebaseFileViewer {repo} filePath={selectedFile} />
			<CodebaseSymbolList symbols={fileSymbols} loading={fileSymbolsLoading} {onSymbolSelect} />
			{#if fileSymbolsError}<div class="inline-error">{fileSymbolsError}</div>{/if}
		{:else}
			<div class="explore-empty">
				<Icon name="file-text" size={28} /><strong>Choose a file or search for a symbol</strong><span
					>The file tree keeps your place while results open here.</span
				>
			</div>
		{/if}
	</div>
</section>

<style>
	/* Moved verbatim from CodebasePage so the split is presentation-neutral. */
	.explore-view {
		display: grid;
		gap: 20px;
	}
	.explore-result {
		min-height: 360px;
		padding: 20px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
	}
	.explore-empty {
		display: grid;
		place-items: center;
		align-content: center;
		gap: 8px;
		min-height: 320px;
		color: var(--color-text-muted);
		text-align: center;
	}
	.explore-empty strong {
		color: var(--color-text);
	}
	.inline-error {
		margin-top: 12px;
		padding: 12px;
		border-radius: var(--radius-md);
		background: rgba(239, 68, 68, 0.1);
		color: var(--color-danger);
		font-size: 0.8rem;
	}
</style>
