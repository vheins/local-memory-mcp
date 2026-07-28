<script lang="ts">
	import Icon from "../lib/Icon.svelte";
	import { api, type CodeSymbol } from "../lib/api";
	import { currentRepo } from "../lib/stores";
	import CodebaseSymbolDetail from "./CodebaseSymbolDetail.svelte";
	import CodebaseIndexStatus from "./CodebaseIndexStatus.svelte";
	import CodebaseSearchBar from "./CodebaseSearchBar.svelte";
	import CodebaseFileTree from "./CodebaseFileTree.svelte";
	import CodebaseSymbolList from "./CodebaseSymbolList.svelte";
	import CodebaseEmptyState from "./CodebaseEmptyState.svelte";
	import CodebaseLanguageBreakdown from "./CodebaseLanguageBreakdown.svelte";

	let { repo = "" }: { repo: string } = $props();

	// --- Types ---
	interface ArchitectureData {
		root: {
			path: string;
			name: string;
			type: string;
			children?: Array<Record<string, unknown>>;
		};
		summary: Record<string, unknown>;
	}

	interface LanguageEntry {
		name: string;
		count: number;
		percentage: number;
		color: string;
	}

	interface TopExport {
		name: string;
		kind: string;
		file_path: string;
	}

	// --- State ---
	let loading = $state(false);
	let error = $state("");
	let hasIndex = $state(false);
	let indexData = $state<Record<string, unknown> | null>(null);
	let sidebarOpen = $state(true);
	let selectedSymbol = $state<CodeSymbol | null>(null);
	let selectedFile = $state<string | null>(null);
	let fileSymbols = $state<CodeSymbol[]>([]);
	let fileSymbolsLoading = $state(false);
	let fileSymbolsError = $state("");
	let architectureData = $state<ArchitectureData | null>(null);
	let architectureLoading = $state(false);
	let architectureError = $state("");

	// --- Derived: language breakdown ---
	let languageEntries = $derived.by<LanguageEntry[]>(() => {
		const summary = architectureData?.summary;
		if (!summary) return [];
		const lb = summary.languageBreakdown as Record<string, number> | undefined;
		if (!lb || typeof lb !== "object") return [];
		const total = Object.values(lb).reduce((a: number, b: number) => a + b, 0);
		if (total === 0) return [];
		return Object.entries(lb)
			.map(([name, count]) => ({
				name,
				count,
				percentage: Math.round((count / total) * 100),
				color: ""
			}))
			.sort((a, b) => b.count - a.count);
	});

	// --- Derived: top-level exports ---
	let topLevelExports = $derived.by<TopExport[]>(() => {
		const summary = architectureData?.summary;
		if (!summary) return [];
		const exports = summary.topLevelExports as Array<{ name: string; kind: string; file_path: string }> | undefined;
		if (!Array.isArray(exports)) return [];
		return exports.slice(0, 10);
	});

	// --- Reactive: load index when repo changes ---
	$effect(() => {
		if (repo) {
			void loadCodebaseIndex();
		}
	});

	async function loadCodebaseIndex() {
		if (!repo) {
			hasIndex = false;
			indexData = null;
			return;
		}
		loading = true;
		error = "";
		try {
			const result = await api.codebaseIndexStatus(repo);
			if (result?.indexed === true) {
				hasIndex = true;
				indexData = result as unknown as Record<string, unknown>;
				void loadArchitecture();
			} else {
				hasIndex = false;
				indexData = null;
				architectureData = null;
			}
		} catch {
			hasIndex = false;
			indexData = null;
			architectureData = null;
		} finally {
			loading = false;
		}
	}

	async function loadArchitecture() {
		if (!repo) {
			architectureData = null;
			return;
		}
		architectureLoading = true;
		architectureError = "";
		try {
			const result = await api.codebaseArchitecture(repo, 5);
			architectureData = result as ArchitectureData;
		} catch (err) {
			architectureError = err instanceof Error ? err.message : "Failed to load file tree";
			architectureData = null;
		} finally {
			architectureLoading = false;
		}
	}

	function toggleSidebar() {
		sidebarOpen = !sidebarOpen;
	}

	async function startIndexing() {
		if (!repo) return;
		try {
			await api.codebaseReindex(repo);
			// After triggering, reload the index status (loadCodebaseIndex also loads architecture)
			await loadCodebaseIndex();
		} catch (err) {
			error = err instanceof Error ? err.message : "Failed to start indexing";
		}
	}

	function handleSymbolSelect(symbol: CodeSymbol) {
		selectedSymbol = symbol;
	}

	async function loadFileSymbols(filePath: string) {
		if (!repo || !filePath) {
			fileSymbols = [];
			return;
		}
		fileSymbolsLoading = true;
		fileSymbolsError = "";
		try {
			const result = await api.codebaseSymbols(repo, filePath);
			fileSymbols = result ?? [];
		} catch (err) {
			fileSymbolsError = err instanceof Error ? err.message : "Failed to load symbols";
			fileSymbols = [];
		} finally {
			fileSymbolsLoading = false;
		}
	}
</script>

<div class="codebase-page animate-fade-in">
	{#if !repo || loading || error || !hasIndex}
		<CodebaseEmptyState
			{repo}
			{hasIndex}
			{loading}
			{error}
			onRetry={() => void loadCodebaseIndex()}
			onStartIndexing={startIndexing}
		/>
	{:else}
		<!-- ─── Indexed Content (Sidebar + Content) ─── -->
		<div class="codebase-layout" class:sidebar-collapsed={!sidebarOpen}>
			<!-- Sidebar toggle for mobile -->
			<button
				class="sidebar-toggle"
				onclick={toggleSidebar}
				aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
			>
				<Icon name={sidebarOpen ? "chevron-left" : "chevron-right"} size={16} strokeWidth={2} />
			</button>

			<!-- File tree sidebar -->
			<aside class="codebase-sidebar" class:open={sidebarOpen}>
				<div class="sidebar-header">
					<Icon name="file-text" size={14} strokeWidth={1.75} />
					<span class="section-label">File Tree</span>
				</div>
				<div class="sidebar-content">
					<CodebaseFileTree
						architecture={architectureData?.root?.children ?? null}
						loading={architectureLoading}
						error={architectureError || null}
						onFileSelect={(filePath) => {
							selectedSymbol = null;
							selectedFile = filePath;
							void loadFileSymbols(filePath);
						}}
						onRetry={() => void loadArchitecture()}
					/>
				</div>
			</aside>

			<!-- Main content area -->
			<main class="codebase-content">
				<div class="codebase-content-scroll">
					<div class="glass card card-body">
						<CodebaseIndexStatus {repo} />

						<div class="search-container">
							<CodebaseSearchBar {repo} onSymbolSelect={handleSymbolSelect} />
						</div>

						<div class="flex items-center gap-2" style="margin-bottom:16px;">
							<Icon name="code" size={14} strokeWidth={1.75} />
							<div class="section-label">Codebase Overview</div>
							<div class="repo-badge">{$currentRepo}</div>
						</div>

						<!-- ─── Language Breakdown ─── -->
						<CodebaseLanguageBreakdown {languageEntries} />

						<!-- ─── Top-Level Exports (Enh 5) ─── -->
						{#if (topLevelExports ?? []).length > 0}
							<div class="overview-section">
								<div class="overview-section-label">
									<Icon name="package" size={12} strokeWidth={1.75} />
									Top-Level Exports
								</div>
								<div class="export-chips">
									{#each topLevelExports ?? [] as exp (exp.name)}
										<button class="export-chip" title="{exp.kind}: {exp.name} — {exp.file_path}">
											<span class="export-kind">{exp.kind}</span>
											<span class="export-sep">:</span>
											<span class="export-name">{exp.name}</span>
										</button>
									{/each}
								</div>
							</div>
						{/if}

						{#if selectedSymbol}
							<CodebaseSymbolDetail symbol={selectedSymbol} references={[]} loading={false} {repo} />
						{:else if selectedFile}
							<div class="muted-text" style="margin-bottom:12px;">
								Selected file: <code>{selectedFile}</code>
							</div>
							<CodebaseSymbolList
								symbols={fileSymbols}
								loading={fileSymbolsLoading}
								onSymbolSelect={handleSymbolSelect}
							/>
							{#if fileSymbolsError}
								<div class="muted-text" style="color:#ef4444;margin-top:8px;">{fileSymbolsError}</div>
							{/if}
						{:else if indexData}
							<div class="muted-text">
								Index loaded with {Object.keys(indexData).length} top-level entries. Select a file from the sidebar to view
								details.
							</div>
						{:else}
							<div class="muted-text">
								Codebase content will be displayed here. The index contains structured data about the repository's file
								system, which can be explored via the file tree sidebar.
							</div>
						{/if}
					</div>
				</div>
			</main>
		</div>
	{/if}
</div>

<style>
	.codebase-page {
		height: 100%;
		min-height: 400px;
	}

	/* ── Layout: sidebar + content ── */
	.codebase-layout {
		display: flex;
		gap: 0;
		height: calc(100vh - 180px);
		position: relative;
	}

	.codebase-layout.sidebar-collapsed .codebase-sidebar {
		width: 0;
		padding: 0;
		overflow: hidden;
		border: none;
	}

	.codebase-layout.sidebar-collapsed .codebase-content {
		flex: 1;
	}

	/* ── Sidebar ── */
	.codebase-sidebar {
		width: 260px;
		min-width: 200px;
		border-right: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.03);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		transition:
			width 0.2s ease,
			padding 0.2s ease;
		border-radius: 16px 0 0 16px;
	}

	.sidebar-header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 14px 16px;
		border-bottom: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.04);
	}

	.sidebar-content {
		flex: 1;
		overflow-y: auto;
	}

	/* ── Sidebar toggle ── */
	.sidebar-toggle {
		position: absolute;
		left: 0;
		top: 50%;
		transform: translateY(-50%);
		z-index: 5;
		width: 20px;
		height: 40px;
		border: none;
		background: var(--color-surface);
		border-radius: 0 8px 8px 0;
		color: var(--color-text-muted);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: 2px 0 8px rgba(0, 0, 0, 0.06);
		transition: color 0.15s ease;
	}

	.sidebar-toggle:hover {
		color: var(--color-text);
	}

	.sidebar-collapsed .sidebar-toggle {
		left: 0;
	}

	/* ── Content ── */
	.codebase-content {
		flex: 1;
		overflow: clip;
		padding: 0;
		position: relative;
	}

	.codebase-content-scroll {
		height: 100%;
		overflow-y: auto;
	}

	.search-container {
		margin-bottom: 20px;
	}

	/* ── Repo badge (reuse pattern) ── */
	.repo-badge {
		font-size: 0.68rem;
		font-weight: 800;
		color: var(--color-primary);
		background: rgba(99, 102, 241, 0.08);
		border: 1px solid rgba(99, 102, 241, 0.16);
		padding: 4px 8px;
		border-radius: 999px;
	}

	/* Top-level export chips */
	.export-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.export-chip {
		display: inline-flex;
		align-items: center;
		gap: 0;
		padding: 4px 8px;
		border-radius: 6px;
		border: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.04);
		cursor: pointer;
		transition: all 0.12s ease;
		font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
	}

	.export-chip:hover {
		background: rgba(99, 102, 241, 0.1);
		border-color: rgba(99, 102, 241, 0.25);
	}

	.export-kind {
		font-size: 0.64rem;
		font-weight: 600;
		color: var(--color-primary);
		opacity: 0.8;
	}

	.export-sep {
		font-size: 0.64rem;
		color: var(--color-text-muted);
		opacity: 0.5;
		margin: 0 1px;
	}

	.export-name {
		font-size: 0.68rem;
		font-weight: 600;
		color: var(--color-text);
	}

	/* ── Responsive: sidebar becomes overlay on narrow screens ── */
	@media (max-width: 768px) {
		.codebase-sidebar {
			position: absolute;
			left: 0;
			top: 0;
			bottom: 0;
			z-index: 10;
			box-shadow: 4px 0 24px rgba(0, 0, 0, 0.12);
			background: var(--color-surface);
		}

		.codebase-layout:not(.sidebar-collapsed) .codebase-content {
			opacity: 0.3;
			pointer-events: none;
		}
	}
</style>
