<script lang="ts">
	import Icon from "../lib/Icon.svelte";
	import { api, type CodeSymbol } from "../lib/api";
	import { currentRepo } from "../lib/stores";
	import CodebaseSymbolDetail from "./CodebaseSymbolDetail.svelte";
	import CodebaseIndexStatus from "./CodebaseIndexStatus.svelte";
	import CodebaseSearchBar from "./CodebaseSearchBar.svelte";
	import CodebaseFileTree from "./CodebaseFileTree.svelte";

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

	// --- State ---
	let loading = $state(false);
	let error = $state("");
	let hasIndex = $state(false);
	let indexData = $state<Record<string, unknown> | null>(null);
	let sidebarOpen = $state(true);
	let selectedSymbol = $state<CodeSymbol | null>(null);
	let selectedFile = $state<string | null>(null);
	let architectureData = $state<ArchitectureData | null>(null);
	let architectureLoading = $state(false);
	let architectureError = $state("");

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
			const result = await api.codebaseArchitecture(repo);
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
						}}
						onRetry={() => void loadArchitecture()}
					/>
				</div>
			</aside>

			<!-- Main content area -->
			<main class="codebase-content">
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

					{#if selectedSymbol}
						<CodebaseSymbolDetail symbol={selectedSymbol} references={[]} loading={false} />
					{:else if selectedFile}
						<div class="muted-text">
							Selected file: <code>{selectedFile}</code>
						</div>
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
		overflow-y: auto;
		padding: 0;
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
