<script lang="ts">
	import Icon from "../lib/Icon.svelte";
	import { SvelteMap } from "svelte/reactivity";
	import type { TraceReference, TraceParent, CodebaseSymbolRow } from "../lib/api";
	import {
		getKindIcon,
		KIND_LABELS,
		buildLocationText,
		groupRefsByFile,
		groupRefsByKind,
		refKindLabel,
		refKindKey,
		REFERENCE_KIND_ORDER,
		otherRefKindLabels
	} from "../lib/symbolDetailUtils";

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
		traceRefs = [],
		references = [],
		traceLoading = false,
		traceError = "",
		traceParent = null,
		traceChildren = [],
		activeKindFilter = $bindable("all"),
		onSymbolSelect = null,
		onOpenFile = null
	}: {
		traceRefs: TraceReference[];
		references: string[];
		traceLoading: boolean;
		traceError: string;
		traceParent: TraceParent | null;
		traceChildren: CodebaseSymbolRow[];
		/** Reference-kind filter (Phase 1.1). Owned by CodebaseSymbolDetail so it
		 *  can be reset to "all" on every symbol transition; bound here so the
		 *  chip row can update it. */
		activeKindFilter?: string;
		/** Navigate to another symbol (parent / child) — mirrors CodebaseSymbolList. */
		onSymbolSelect?: ((symbol: CodeSymbol) => void) | null;
		/** Open a file (e.g. a derived-heritage site) in the file tree. */
		onOpenFile?: ((filePath: string) => void) | null;
	} = $props();

	// Trace-backed + legacy references combined count (section header display).
	let totalRefs = $derived(traceRefs.length + references.length);

	/** Label for a hierarchy row's symbol kind; unknown kinds show their raw value. */
	function symbolKindLabel(kind: string): string {
		return KIND_LABELS[kind] ?? kind;
	}

	// Per-kind counts for the filter chip row (stable order + "other").
	let refKindCounts = $derived.by(() => {
		const counts = new SvelteMap<string, number>();
		for (const ref of traceRefs) {
			const key = refKindKey(ref.kind);
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
		return counts;
	});

	let refKindChips = $derived.by(() => {
		const chips: { key: string; label: string; count: number }[] = [];
		for (const key of [...REFERENCE_KIND_ORDER, "other"]) {
			const count = refKindCounts.get(key) ?? 0;
			if (count > 0) chips.push({ key, label: refKindLabel(key), count });
		}
		return chips;
	});

	// Distinct raw kinds inside the "other" bucket (graceful unknown-kind rendering).
	let otherRawKinds = $derived(otherRefKindLabels(traceRefs));

	let filteredRefs = $derived(
		activeKindFilter === "all" ? traceRefs : traceRefs.filter((r) => refKindKey(r.kind) === activeKindFilter)
	);

	// Kind → refs, stable order (call → … → other), empty groups dropped.
	let refKindGroups = $derived(groupRefsByKind(filteredRefs));

	// Heritage edges (extends/implements) inside this symbol's references are
	// the declarations of types that derive from / implement the traced symbol.
	let heritageRefs = $derived(traceRefs.filter((r) => r.kind === "extends" || r.kind === "implements"));

	let hasHierarchy = $derived(!!traceParent || traceChildren.length > 0 || heritageRefs.length > 0);

	/** Build a selectable CodeSymbol from a TRACE row — symbol kinds are wider
	 *  than the CodeSymbol union at runtime (method/property/…), so the kind is
	 *  cast and falls back to a raw label in the header. */
	function toCodeSymbol(name: string, kind: string, filePath?: string | null, line?: number | null): CodeSymbol {
		return { name, kind: kind as CodeSymbol["kind"], filePath: filePath ?? undefined, line: line ?? undefined };
	}

	function navigateToParent() {
		if (!traceParent || typeof onSymbolSelect !== "function") return;
		onSymbolSelect(toCodeSymbol(traceParent.name, traceParent.kind, traceParent.filePath, traceParent.line));
	}

	function navigateToChild(child: CodebaseSymbolRow) {
		if (typeof onSymbolSelect !== "function") return;
		onSymbolSelect(toCodeSymbol(child.name, child.kind, child.file_path, child.start_line));
	}

	function openHeritageSite(ref: TraceReference) {
		if (typeof onOpenFile === "function") onOpenFile(ref.filePath);
	}
</script>

<!-- ─── Hierarchy (TASK-300: parent + children; Phase 1.1 heritage sites) ─── -->
{#if hasHierarchy}
	<div class="detail-section">
		<div class="detail-section-label">Hierarchy</div>
		{#if traceParent}
			<div class="hierarchy-subgroup">
				<div class="hierarchy-subgroup-label">Parent</div>
				<button
					class="hierarchy-row"
					onclick={navigateToParent}
					aria-label="Navigate to parent symbol {traceParent.name}"
				>
					<span class="hierarchy-row-icon"
						><Icon name={getKindIcon(traceParent.kind)} size={13} strokeWidth={1.75} /></span
					>
					<span class="hierarchy-row-name">{traceParent.name}</span>
					<span class="hierarchy-row-kind">{symbolKindLabel(traceParent.kind)}</span>
					<span class="hierarchy-row-loc">
						{buildLocationText(traceParent.filePath, traceParent.line ?? undefined)}
					</span>
				</button>
			</div>
		{/if}
		{#if traceChildren.length > 0}
			<div class="hierarchy-subgroup">
				<div class="hierarchy-subgroup-label">
					Children
					<span class="detail-section-count">{traceChildren.length}</span>
				</div>
				{#each traceChildren as child (child.id)}
					<button
						class="hierarchy-row"
						onclick={() => navigateToChild(child)}
						aria-label="Navigate to {child.kind} {child.name}"
					>
						<span class="hierarchy-row-icon"><Icon name={getKindIcon(child.kind)} size={13} strokeWidth={1.75} /></span>
						<span class="hierarchy-row-name">{child.name}</span>
						<span class="hierarchy-row-kind">{symbolKindLabel(child.kind)}</span>
						{#if child.start_line != null}
							<span class="hierarchy-row-loc">:{child.start_line}</span>
						{/if}
					</button>
				{/each}
			</div>
		{/if}
		{#if heritageRefs.length > 0}
			<div class="hierarchy-subgroup">
				<div class="hierarchy-subgroup-label">
					Inherited by
					<span class="detail-section-count">{heritageRefs.length}</span>
				</div>
				<div class="hierarchy-hint">Types that extend or implement this symbol at their heritage site.</div>
				{#each heritageRefs as ref (`${ref.kind}:${ref.filePath}:${ref.startLine}`)}
					<button
						class="hierarchy-row"
						onclick={() => openHeritageSite(ref)}
						aria-label="Open {ref.filePath}:{ref.startLine}"
					>
						<span class="hierarchy-row-icon"
							><Icon name={getKindIcon(ref.kind ?? "code")} size={12} strokeWidth={2} /></span
						>
						<span class="hierarchy-row-name">{refKindLabel(ref.kind)}</span>
						<span class="hierarchy-row-loc">{buildLocationText(ref.filePath, ref.startLine)}</span>
					</button>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<!-- ─── References (Enh 6: Trace-backed; Phase 1.1: kind groups + filter) ─── -->
<div class="detail-section">
	<div class="detail-section-label">
		References
		{#if traceLoading}
			<span class="detail-section-count" style="opacity:0.5">...</span>
		{:else if totalRefs > 0}
			<span class="detail-section-count"
				>{activeKindFilter === "all" ? totalRefs : `${filteredRefs.length}/${totalRefs}`}</span
			>
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
		<!-- Kind filter chips -->
		{#if traceRefs.length > 0 && refKindChips.length > 0}
			<div class="ref-kind-chips" role="group" aria-label="Filter references by kind">
				<button
					class="ref-kind-chip"
					class:active={activeKindFilter === "all"}
					aria-pressed={activeKindFilter === "all"}
					onclick={() => (activeKindFilter = "all")}
				>
					All
				</button>
				{#each refKindChips as chip (chip.key)}
					<button
						class="ref-kind-chip"
						class:active={activeKindFilter === chip.key}
						aria-pressed={activeKindFilter === chip.key}
						onclick={() => (activeKindFilter = chip.key)}
					>
						<Icon name={getKindIcon(chip.key)} size={10} strokeWidth={2} />
						{chip.label}
						<span class="ref-kind-chip-count">{chip.count}</span>
					</button>
				{/each}
			</div>
		{/if}

		<!-- Trace-backed references: grouped by edge kind, then by file -->
		{#if traceRefs.length > 0}
			{#each [...refKindGroups.entries()] as [kindKey, kindRefs] (kindKey)}
				<div class="detail-ref-kind-group">
					<div class="detail-ref-kind-header">
						<Icon name={getKindIcon(kindKey)} size={12} strokeWidth={2} />
						<span class="detail-ref-kind-label">{refKindLabel(kindKey)}</span>
						{#if kindKey === "other" && otherRawKinds.length > 0}
							<span class="detail-ref-kind-raw" title="Raw kinds: {otherRawKinds.join(', ')}"
								>{otherRawKinds.join(", ")}</span
							>
						{/if}
						<span class="detail-ref-file-count">{kindRefs.length}</span>
					</div>
					{#each [...groupRefsByFile(kindRefs).entries()] as [filePath, fileRefs] (filePath)}
						<div class="detail-ref-file-group">
							<div class="detail-ref-file-header">
								<Icon name="file-text" size={11} strokeWidth={2} />
								<span class="detail-ref-file-path">{filePath}</span>
								<span class="detail-ref-file-count">{fileRefs.length}</span>
							</div>
							{#each fileRefs as ref (`${ref.filePath}:${ref.startLine}`)}
								<div class="detail-ref-item">
									<span class="detail-ref-line">:{ref.startLine}</span>
									{#if ref.context}
										<span class="detail-ref-context">{ref.context}</span>
									{/if}
									{#if ref.targetFile}
										<span class="detail-ref-target" title="Defined in {ref.targetFile}">{ref.targetFile}</span>
									{/if}
								</div>
							{/each}
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

<style>
	/* ── Sections (scoped to trace blocks; shared primitives with the parent) ── */
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

	/* ── Reference kind groups (Phase 1.1) ── */
	.detail-ref-kind-group {
		margin-bottom: 8px;
	}

	.detail-ref-kind-header {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 4px 6px;
		font-size: 0.66rem;
		font-weight: 700;
		color: var(--color-primary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		border-left: 2px solid rgba(14, 165, 233, 0.35);
		margin: 6px 0 2px;
	}

	.detail-ref-kind-label {
		flex: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.detail-ref-kind-raw {
		font-size: 0.56rem;
		font-weight: 600;
		color: var(--color-text-muted);
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid var(--color-border);
		padding: 1px 5px;
		border-radius: 4px;
		font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
		white-space: nowrap;
		max-width: 140px;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* ── Reference secondary info: target file (v23) ── */
	.detail-ref-target {
		font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
		font-size: 0.6rem;
		color: var(--color-text-muted);
		opacity: 0.75;
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid var(--color-border);
		border-radius: 4px;
		padding: 0 4px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 160px;
		margin-left: auto;
		flex-shrink: 0;
	}

	/* ── Kind filter chips (Phase 1.1) ── */
	.ref-kind-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
		padding: 2px 0 8px;
	}

	.ref-kind-chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		border: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.04);
		color: var(--color-text-muted);
		font-size: 0.62rem;
		font-weight: 600;
		padding: 3px 8px;
		border-radius: 999px;
		cursor: pointer;
		transition:
			background 0.12s ease,
			border-color 0.12s ease,
			color 0.12s ease;
	}

	.ref-kind-chip:hover {
		background: rgba(255, 255, 255, 0.07);
		color: var(--color-text);
	}

	.ref-kind-chip.active {
		background: rgba(99, 102, 241, 0.14);
		border-color: rgba(99, 102, 241, 0.35);
		color: var(--color-primary);
	}

	.ref-kind-chip:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 1px;
	}

	.ref-kind-chip-count {
		font-size: 0.54rem;
		font-weight: 700;
		background: rgba(255, 255, 255, 0.08);
		border-radius: 4px;
		padding: 0 4px;
		opacity: 0.85;
	}

	/* ── Hierarchy block (TASK-300) ── */
	.hierarchy-subgroup {
		margin-bottom: 8px;
	}

	.hierarchy-subgroup-label {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.64rem;
		font-weight: 700;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 4px;
	}

	.hierarchy-hint {
		font-size: 0.64rem;
		color: var(--color-text-muted);
		opacity: 0.7;
		margin-bottom: 3px;
	}

	.hierarchy-row {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		border: none;
		background: transparent;
		color: var(--color-text-muted);
		font-size: 0.7rem;
		font-weight: 500;
		padding: 4px 8px;
		border-radius: 6px;
		cursor: pointer;
		text-align: left;
		transition:
			background 0.1s ease,
			color 0.1s ease;
	}

	.hierarchy-row:hover {
		background: rgba(255, 255, 255, 0.06);
		color: var(--color-text);
	}

	.hierarchy-row:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: -2px;
	}

	.hierarchy-row-icon {
		color: var(--color-primary);
		opacity: 0.85;
		flex-shrink: 0;
		display: inline-flex;
	}

	.hierarchy-row-name {
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		flex-shrink: 0;
		max-width: 45%;
	}

	.hierarchy-row-kind {
		font-size: 0.58rem;
		font-weight: 600;
		color: var(--color-text-muted);
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid var(--color-border);
		padding: 0 5px;
		border-radius: 4px;
		flex-shrink: 0;
	}

	.hierarchy-row-loc {
		font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
		font-size: 0.62rem;
		opacity: 0.75;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		flex: 1;
		min-width: 0;
		text-align: right;
	}
</style>
