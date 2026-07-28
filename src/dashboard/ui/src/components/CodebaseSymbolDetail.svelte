<script lang="ts">
	import Icon from "../lib/Icon.svelte";
	import { api, type TraceReference } from "../lib/api";
	import SymbolDetailHeader from "./SymbolDetailHeader.svelte";
	import SymbolDetailCodePreview from "./SymbolDetailCodePreview.svelte";
	import { getKindIcon, getKindLabel, buildLocationText, groupRefsByFile } from "../lib/symbolDetailUtils";

	interface CodeSymbol {
		name: string;
		kind: "function" | "class" | "interface" | "type" | "enum" | "variable";
		signature?: string;
		exported?: boolean;
		documentation?: string;
		filePath?: string;
		line?: number;
		column?: number;
		references?: string[];
		relatedSymbols?: string[];
	}

	let {
		symbol = null,
		references = [],
		loading = false,
		repo = ""
	}: {
		symbol: CodeSymbol | null;
		references: string[];
		loading: boolean;
		repo: string;
	} = $props();

	let kindIcon = $derived(getKindIcon(symbol?.kind || "variable"));
	let kindLabel = $derived(getKindLabel(symbol?.kind || "variable"));
	let locationText = $derived(buildLocationText(symbol?.filePath, symbol?.line, symbol?.column));

	// --- Trace state (Enh 6) ---
	let traceRefs = $state<TraceReference[]>([]);
	let traceLoading = $state(false);
	let traceError = $state("");

	// Grouped references: Map<filePath, TraceReference[]>
	let refsByFile = $derived(groupRefsByFile(traceRefs));

	let totalRefs = $derived(traceRefs.length + references.length);

	// Fetch trace when symbol changes
	$effect(() => {
		const sym = symbol;
		if (!sym || !repo) {
			traceRefs = [];
			return;
		}
		void fetchTrace(sym.name);
	});

	async function fetchTrace(name: string) {
		traceLoading = true;
		traceError = "";
		try {
			const result = await api.codebaseTrace(repo, name);
			traceRefs = result?.references ?? [];
		} catch {
			traceRefs = [];
			traceError = "Failed to load references";
		} finally {
			traceLoading = false;
		}
	}
</script>

{#if loading}
	<div class="detail-skeleton" aria-label="Loading symbol details">
		<div class="detail-skel-header">
			<div class="detail-skel-icon skeleton-pulse"></div>
			<div class="detail-skel-name skeleton-pulse"></div>
		</div>
		<div class="detail-skel-sig skeleton-pulse"></div>
		<div class="detail-skel-section">
			<div class="detail-skel-label skeleton-pulse"></div>
			<div class="detail-skel-text skeleton-pulse" style="width:90%;"></div>
			<div class="detail-skel-text skeleton-pulse" style="width:70%;"></div>
		</div>
		<div class="detail-skel-section">
			<div class="detail-skel-label skeleton-pulse"></div>
			<div class="detail-skel-text skeleton-pulse" style="width:60%;"></div>
			<div class="detail-skel-text skeleton-pulse" style="width:80%;"></div>
		</div>
	</div>
{:else if !symbol}
	<div class="detail-empty">
		<div class="detail-empty-icon">
			<Icon name="code" size={20} strokeWidth={1.5} />
		</div>
		<div class="detail-empty-title">Select a symbol to view details.</div>
	</div>
{:else}
	<div class="detail-panel">
		<SymbolDetailHeader {symbol} {kindIcon} {kindLabel} />

		<SymbolDetailCodePreview {symbol} />

		<!-- ─── Documentation ─── -->
		<div class="detail-section">
			<div class="detail-section-label">Documentation</div>
			{#if symbol.documentation}
				<div class="detail-doc">{symbol.documentation}</div>
			{:else}
				<div class="detail-no-doc">No documentation</div>
			{/if}
		</div>

		<!-- ─── Location ─── -->
		{#if symbol.filePath}
			<div class="detail-section">
				<div class="detail-section-label">Location</div>
				<div class="detail-location">
					<Icon name="file-text" size={12} strokeWidth={1.75} />
					<span class="detail-location-path">{locationText}</span>
				</div>
			</div>
		{/if}

		<!-- ─── References (Enh 6: Trace-backed) ─── -->
		<div class="detail-section">
			<div class="detail-section-label">
				References
				{#if traceLoading}
					<span class="detail-section-count" style="opacity:0.5">...</span>
				{:else if totalRefs > 0}
					<span class="detail-section-count">{totalRefs}</span>
				{/if}
			</div>
			{#if traceLoading}
				<div class="detail-ref-loading">
					<Icon name="loader" size={12} strokeWidth={2} />
					<span>Loading references...</span>
				</div>
			{:else if traceError}
				<div class="detail-no-refs" style="color:rgba(239,68,68,0.7);">{traceError}</div>
			{:else if traceRefs.length === 0 && references.length === 0}
				<div class="detail-no-refs">No references found.</div>
			{:else}
				<!-- Trace-backed references (grouped by file) -->
				{#if traceRefs.length > 0}
					{#each [...refsByFile.entries()] as [filePath, refs] (filePath)}
						<div class="detail-ref-file-group">
							<div class="detail-ref-file-header">
								<Icon name="file-text" size={11} strokeWidth={2} />
								<span class="detail-ref-file-path">{filePath}</span>
								<span class="detail-ref-file-count">{refs.length}</span>
							</div>
							{#each refs as ref (`${ref.filePath}:${ref.startLine}`)}
								<div class="detail-ref-item">
									<span class="detail-ref-line">:{ref.startLine}</span>
									{#if ref.context}
										<span class="detail-ref-context">{ref.context}</span>
									{/if}
								</div>
							{/each}
						</div>
					{/each}
				{/if}
				<!-- Legacy prop-based references -->
				{#if references.length > 0}
					<ul class="detail-ref-list">
						{#each references as ref (ref)}
							<li class="detail-ref-item">
								<Icon name="link" size={11} strokeWidth={2} />
								<span class="detail-ref-path">{ref}</span>
							</li>
						{/each}
					</ul>
				{/if}
			{/if}
		</div>

		<!-- ─── Related Symbols ─── -->
		{#if symbol.relatedSymbols && symbol.relatedSymbols.length > 0}
			<div class="detail-section">
				<div class="detail-section-label">
					Related Symbols
					<span class="detail-section-count">{symbol.relatedSymbols.length}</span>
				</div>
				<div class="detail-related">
					{#each symbol.relatedSymbols as rel (rel)}
						<span class="detail-related-chip">{rel}</span>
					{/each}
				</div>
			</div>
		{/if}
	</div>
{/if}

<style>
	/* ── Skeleton Loading ── */
	.detail-skeleton {
		padding: 16px;
	}

	.detail-skel-header {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 12px;
	}

	.detail-skel-icon {
		width: 32px;
		height: 32px;
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.06);
		flex-shrink: 0;
	}

	.detail-skel-name {
		height: 16px;
		width: 120px;
		border-radius: 4px;
		background: rgba(255, 255, 255, 0.06);
	}

	.detail-skel-sig {
		height: 28px;
		width: 100%;
		border-radius: 6px;
		background: rgba(255, 255, 255, 0.04);
		margin-bottom: 16px;
	}

	.detail-skel-section {
		margin-bottom: 14px;
	}

	.detail-skel-label {
		height: 8px;
		width: 60px;
		border-radius: 3px;
		background: rgba(255, 255, 255, 0.06);
		margin-bottom: 6px;
	}

	.detail-skel-text {
		height: 10px;
		border-radius: 4px;
		background: rgba(255, 255, 255, 0.04);
		margin-bottom: 4px;
	}

	.skeleton-pulse {
		animation: skeleton-pulse 1.8s ease-in-out infinite;
	}

	@keyframes skeleton-pulse {
		0%,
		100% {
			opacity: 0.4;
		}
		50% {
			opacity: 1;
		}
	}

	/* ── Empty State ── */
	.detail-empty {
		text-align: center;
		padding: 40px 16px;
	}

	.detail-empty-icon {
		display: inline-flex;
		width: 44px;
		height: 44px;
		border-radius: 12px;
		background: rgba(14, 165, 233, 0.1);
		color: var(--color-primary);
		border: 1px solid rgba(14, 165, 233, 0.15);
		align-items: center;
		justify-content: center;
		margin-bottom: 10px;
	}

	.detail-empty-title {
		font-size: 0.82rem;
		font-weight: 700;
		color: var(--color-text-muted);
	}

	/* ── Detail Panel ── */
	.detail-panel {
		padding: 16px;
	}

	/* ── Sections ── */
	.detail-section {
		margin-bottom: 16px;
	}

	.detail-section-label {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.66rem;
		font-weight: 700;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		margin-bottom: 6px;
	}

	.detail-section-count {
		font-size: 0.56rem;
		font-weight: 600;
		background: rgba(255, 255, 255, 0.06);
		padding: 1px 5px;
		border-radius: 4px;
	}

	/* ── Documentation ── */
	.detail-doc {
		font-size: 0.78rem;
		color: var(--color-text);
		line-height: 1.6;
		padding: 8px 12px;
		background: rgba(255, 255, 255, 0.03);
		border-radius: 8px;
		border: 1px solid var(--color-border);
	}

	.detail-no-doc {
		font-size: 0.74rem;
		color: var(--color-text-muted);
		font-style: italic;
		padding: 8px 12px;
		opacity: 0.6;
	}

	/* ── Location ── */
	.detail-location {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--color-text-muted);
		font-size: 0.72rem;
		font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
	}

	.detail-location-path {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* ── References ── */
	.detail-ref-loading {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.72rem;
		color: var(--color-text-muted);
		padding: 4px 0;
	}

	.detail-ref-loading :global(svg) {
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

	.detail-no-refs {
		font-size: 0.74rem;
		color: var(--color-text-muted);
		font-style: italic;
		padding: 4px 0;
		opacity: 0.6;
	}

	.detail-ref-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.detail-ref-file-group {
		margin-bottom: 8px;
	}

	.detail-ref-file-header {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 3px 6px;
		font-size: 0.68rem;
		font-weight: 700;
		color: var(--color-text-muted);
		border-bottom: 1px solid var(--color-border);
		margin-bottom: 2px;
	}

	.detail-ref-file-path {
		font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		flex: 1;
		min-width: 0;
	}

	.detail-ref-file-count {
		font-size: 0.56rem;
		font-weight: 600;
		background: rgba(255, 255, 255, 0.06);
		padding: 1px 5px;
		border-radius: 4px;
		flex-shrink: 0;
	}

	.detail-ref-item {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 3px 8px 3px 20px;
		font-size: 0.68rem;
		color: var(--color-text-muted);
		border-radius: 4px;
		transition: background 0.1s ease;
	}

	.detail-ref-item:hover {
		background: rgba(255, 255, 255, 0.04);
	}

	.detail-ref-line {
		font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
		color: var(--color-primary);
		font-weight: 600;
		opacity: 0.8;
		flex-shrink: 0;
	}

	.detail-ref-context {
		font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.detail-ref-path {
		font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* ── Related Symbols ── */
	.detail-related {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.detail-related-chip {
		font-size: 0.68rem;
		font-weight: 600;
		color: var(--color-text-muted);
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid var(--color-border);
		padding: 3px 8px;
		border-radius: 6px;
		font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
	}
</style>
