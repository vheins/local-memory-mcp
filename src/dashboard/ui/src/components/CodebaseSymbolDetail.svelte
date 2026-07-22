<script lang="ts">
	import Icon from "../lib/Icon.svelte";

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
		loading = false
	}: {
		symbol: CodeSymbol | null;
		references: string[];
		loading: boolean;
	} = $props();

	const KIND_ICONS: Record<string, string> = {
		function: "zap",
		class: "layers",
		interface: "terminal",
		type: "hash",
		enum: "list",
		variable: "database"
	};

	const KIND_LABELS: Record<string, string> = {
		function: "Function",
		class: "Class",
		interface: "Interface",
		type: "Type",
		enum: "Enum",
		variable: "Variable"
	};

	let kindIcon = $derived(KIND_ICONS[symbol?.kind || "variable"] || "code");
	let kindLabel = $derived(KIND_LABELS[symbol?.kind || "variable"] || "Symbol");
	let locationText = $derived(() => {
		if (!symbol?.filePath) return null;
		let loc = symbol.filePath;
		if (symbol.line != null) {
			loc += `:${symbol.line}`;
			if (symbol.column != null) {
				loc += `:${symbol.column}`;
			}
		}
		return loc;
	});
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
		<!-- ─── Header: Kind icon + Name + Export badge ─── -->
		<div class="detail-header">
			<div class="detail-header-icon">
				<Icon name={kindIcon} size={18} strokeWidth={1.75} />
			</div>
			<div class="detail-header-info">
				<div class="detail-header-row">
					<span class="detail-name">{symbol.name}</span>
					{#if symbol.exported}
						<span class="detail-export-badge">export</span>
					{/if}
				</div>
				<div class="detail-kind-label">{kindLabel}</div>
			</div>
		</div>

		<!-- ─── Signature ─── -->
		{#if symbol.signature}
			<div class="detail-section">
				<div class="detail-section-label">Signature</div>
				<pre class="detail-signature"><code>{symbol.signature}</code></pre>
			</div>
		{/if}

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
					<span class="detail-location-path">{locationText()}</span>
				</div>
			</div>
		{/if}

		<!-- ─── References ─── -->
		<div class="detail-section">
			<div class="detail-section-label">
				References
				{#if references.length > 0}
					<span class="detail-section-count">{references.length}</span>
				{/if}
			</div>
			{#if references.length === 0}
				<div class="detail-no-refs">No references found.</div>
			{:else}
				<ul class="detail-ref-list">
					{#each references as ref (ref)}
						<li class="detail-ref-item">
							<Icon name="link" size={11} strokeWidth={2} />
							<span class="detail-ref-path">{ref}</span>
						</li>
					{/each}
				</ul>
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

	/* ── Header ── */
	.detail-header {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		margin-bottom: 16px;
	}

	.detail-header-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: 10px;
		background: linear-gradient(135deg, rgba(99, 102, 241, 0.15), rgba(14, 165, 233, 0.15));
		border: 1px solid rgba(99, 102, 241, 0.2);
		color: var(--color-primary);
		flex-shrink: 0;
	}

	.detail-header-info {
		flex: 1;
		min-width: 0;
	}

	.detail-header-row {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.detail-name {
		font-size: 1rem;
		font-weight: 800;
		color: var(--color-text);
		letter-spacing: -0.01em;
	}

	.detail-export-badge {
		font-size: 0.56rem;
		font-weight: 700;
		color: #22c55e;
		background: rgba(34, 197, 94, 0.1);
		border: 1px solid rgba(34, 197, 94, 0.15);
		padding: 2px 6px;
		border-radius: 4px;
		letter-spacing: 0.02em;
	}

	.detail-kind-label {
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--color-text-muted);
		margin-top: 2px;
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

	/* ── Signature ── */
	.detail-signature {
		font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
		font-size: 0.72rem;
		line-height: 1.6;
		color: var(--color-text);
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		padding: 10px 12px;
		overflow-x: auto;
		white-space: pre;
		margin: 0;
	}

	.detail-signature code {
		font-family: inherit;
		font-size: inherit;
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

	.detail-ref-item {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 8px;
		font-size: 0.7rem;
		color: var(--color-text-muted);
		border-radius: 4px;
		transition: background 0.1s ease;
	}

	.detail-ref-item:hover {
		background: rgba(255, 255, 255, 0.04);
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
