<script lang="ts">
	import Icon from "../lib/Icon.svelte";
	import { api, type CodeSymbol } from "../lib/api";
	import { currentRepo } from "../lib/stores";
	import CodebaseSymbolDetail from "./CodebaseSymbolDetail.svelte";
	import CodebaseIndexStatus from "./CodebaseIndexStatus.svelte";
	import CodebaseSearchBar from "./CodebaseSearchBar.svelte";
	import CodebaseFileTree from "./CodebaseFileTree.svelte";
	import CodebaseSymbolList from "./CodebaseSymbolList.svelte";

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

	// --- Language color map ---
	const LANG_COLORS: Record<string, string> = {
		TypeScript: "#3178c6",
		JavaScript: "#f7df1e",
		Svelte: "#ff3e00",
		JSON: "#a8b1c4",
		Markdown: "#22c55e",
		CSS: "#cc6699",
		HTML: "#e34c26",
		YAML: "#cb171e",
		XML: "#0060ac",
		Shell: "#89e051",
		Python: "#3572A5"
	};

	const LANG_ICONS: Record<string, string> = {
		TypeScript: "file-text",
		JavaScript: "file-code",
		Svelte: "flame",
		JSON: "braces",
		Markdown: "book-open",
		CSS: "palette",
		HTML: "globe",
		YAML: "settings"
	};

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
				color: LANG_COLORS[name] || "var(--color-text-muted)"
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
	<!-- ─── No Repo Selected ─── -->
	{#if !repo}
		<div class="codebase-empty">
			<div class="codebase-empty-icon animate-float">
				<Icon name="code" size={32} strokeWidth={1.5} />
			</div>
			<div class="codebase-empty-title">Select a repository to view its codebase index.</div>
			<div class="codebase-empty-text">
				Choose a repository from the sidebar to browse its file structure and indexed content.
			</div>
		</div>
	{:else if loading}
		<!-- ─── Loading State ─── -->
		<div class="codebase-empty">
			<div class="codebase-empty-icon animate-float">
				<Icon name="refresh-cw" size={28} strokeWidth={1.5} />
			</div>
			<div class="codebase-empty-title">Loading codebase index...</div>
		</div>
	{:else if error}
		<!-- ─── Error State ─── -->
		<div class="codebase-empty">
			<div
				class="codebase-empty-icon animate-float"
				style="background:linear-gradient(135deg,rgba(239,68,68,0.15),rgba(220,38,38,0.15));border-color:rgba(239,68,68,0.2);"
			>
				<Icon name="triangle-alert" size={28} strokeWidth={1.5} />
			</div>
			<div class="codebase-empty-title">Failed to load codebase</div>
			<div class="codebase-empty-text">{error}</div>
			<button class="codebase-action-btn" onclick={() => void loadCodebaseIndex()}>
				<Icon name="refresh-cw" size={14} strokeWidth={2} />
				<span>Retry</span>
			</button>
		</div>
	{:else if !hasIndex}
		<!-- ─── No Index State ─── -->
		<div class="codebase-empty">
			<div class="codebase-empty-icon animate-float">
				<Icon name="file-text" size={32} strokeWidth={1.5} />
			</div>
			<div class="codebase-empty-title">No codebase index found</div>
			<div class="codebase-empty-text">
				This repository hasn't been indexed yet. Create an index to browse its file structure and enable codebase-aware
				features.
			</div>
			<button class="codebase-action-btn primary" onclick={startIndexing}>
				<Icon name="upload-cloud" size={14} strokeWidth={2} />
				<span>Index Now</span>
			</button>
		</div>
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

						<!-- ─── Language Breakdown (Enh 4) ─── -->
						{#if (languageEntries ?? []).length > 0}
							<div class="overview-section">
								<div class="overview-section-label">
									<Icon name="globe" size={12} strokeWidth={1.75} />
									Languages
								</div>
								<div class="lang-grid">
									{#each languageEntries ?? [] as lang (lang.name)}
										<div class="lang-badge" title="{lang.name}: {lang.count} files ({lang.percentage}%)">
											<span class="lang-icon" style="color:{lang.color}">
												<Icon name={LANG_ICONS[lang.name] || "file"} size={12} strokeWidth={1.75} />
											</span>
											<span class="lang-name">{lang.name}</span>
											<span class="lang-count">{lang.count}</span>
											<div class="lang-bar">
												<div class="lang-bar-fill" style="width:{lang.percentage}%;background:{lang.color}"></div>
											</div>
											<span class="lang-pct">{lang.percentage}%</span>
										</div>
									{/each}
								</div>
							</div>
						{/if}

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

	/* ── Empty / Loading / Error states ── */
	.codebase-empty {
		text-align: center;
		padding: 80px 20px;
	}

	.codebase-empty-icon {
		display: inline-flex;
		width: 72px;
		height: 72px;
		border-radius: 20px;
		background: linear-gradient(135deg, rgba(14, 165, 233, 0.15), rgba(99, 102, 241, 0.15));
		border: 1px solid rgba(14, 165, 233, 0.2);
		align-items: center;
		justify-content: center;
		margin-bottom: 20px;
		color: var(--color-primary);
	}

	.codebase-empty-title {
		font-size: 1.15rem;
		font-weight: 800;
		color: var(--color-text);
		margin-bottom: 8px;
		letter-spacing: -0.02em;
	}

	.codebase-empty-text {
		color: var(--color-text-muted);
		font-size: 0.85rem;
		max-width: 420px;
		margin: 0 auto 20px;
		line-height: 1.5;
	}

	/* ── Action buttons ── */
	.codebase-action-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 18px;
		border-radius: 10px;
		border: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.06);
		color: var(--color-text);
		font-size: 0.8rem;
		font-weight: 700;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.codebase-action-btn:hover {
		background: rgba(255, 255, 255, 0.1);
		border-color: var(--color-primary);
	}

	.codebase-action-btn.primary {
		background: linear-gradient(135deg, var(--color-primary), var(--color-accent));
		color: white;
		border: none;
		box-shadow: 0 4px 16px var(--glow-primary);
	}

	.codebase-action-btn.primary:hover {
		opacity: 0.92;
		transform: translateY(-1px);
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

	/* ── Overview sections: Language Breakdown + Top Exports ── */
	.overview-section {
		margin-bottom: 20px;
	}

	.overview-section-label {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.66rem;
		font-weight: 700;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		margin-bottom: 8px;
	}

	/* Language badge grid */
	.lang-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.lang-badge {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 10px;
		border-radius: 8px;
		border: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.03);
		transition: background 0.12s ease;
		min-width: 140px;
	}

	.lang-badge:hover {
		background: rgba(255, 255, 255, 0.06);
	}

	.lang-icon {
		display: flex;
		align-items: center;
		flex-shrink: 0;
	}

	.lang-name {
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--color-text);
		white-space: nowrap;
	}

	.lang-count {
		font-size: 0.62rem;
		font-weight: 700;
		color: var(--color-text-muted);
		min-width: 18px;
		text-align: right;
	}

	.lang-bar {
		flex: 1;
		height: 4px;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.06);
		overflow: hidden;
		min-width: 40px;
		max-width: 80px;
	}

	.lang-bar-fill {
		height: 100%;
		border-radius: 999px;
		transition: width 0.4s ease;
		min-width: 2px;
	}

	.lang-pct {
		font-size: 0.58rem;
		font-weight: 600;
		color: var(--color-text-muted);
		min-width: 28px;
		text-align: right;
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
