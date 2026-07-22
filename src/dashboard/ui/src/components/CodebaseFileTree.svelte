<script lang="ts">
	import Icon from "../lib/Icon.svelte";

	/** Directory/file tree data from codebase index */
	export let architecture: Record<string, unknown>[] | null = null;
	/** Callback when a file is selected */
	export let onFileSelect: ((filePath: string) => void) | null = null;
	/** Loading state */
	export let loading: boolean = false;
	/** Error state message */
	export let error: string | null = null;
	/** Retry callback for error state */
	export let onRetry: (() => void) | null = null;

	// Track which directories are expanded
	let expandedDirs: Record<string, boolean> = {};
	// Currently active/selected file
	let activeFile: string | null = null;

	/** Toggle directory expansion */
	function toggleDir(path: string) {
		expandedDirs[path] = !expandedDirs[path];
		expandedDirs = expandedDirs; // trigger reactivity
	}

	/** Select a file and invoke callback */
	function selectFile(filePath: string) {
		activeFile = filePath;
		if (typeof onFileSelect === "function") {
			onFileSelect(filePath);
		}
	}

	/** Keyboard handler for interactive elements */
	function handleKeyDown(e: KeyboardEvent, action: () => void) {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			action();
		}
	}

	/** Count files and symbols in a directory node */
	function countChildren(node: Record<string, unknown>): { files: number; symbols: number } {
		const children = node.children as Record<string, unknown>[] | undefined;
		if (!children || !Array.isArray(children)) {
			return { files: 0, symbols: 0 };
		}
		let files = 0;
		let symbols = 0;
		for (const child of children) {
			const t = child.type as string | undefined;
			const childPath = (child.path as string) || "";
			const isDir =
				t === "directory" ||
				t === "dir" ||
				(!t && childPath.endsWith("/")) ||
				(!t && Array.isArray(child.children) && child.children.length > 0);
			if (isDir) {
				const sub = countChildren(child);
				files += sub.files;
				symbols += sub.symbols;
			} else {
				files += 1;
				if (child.symbolCounts && typeof child.symbolCounts === "object") {
					symbols += Object.values(child.symbolCounts as Record<string, number>).reduce(
						(a: number, b: number) => a + b,
						0
					);
				}
			}
		}
		return { files, symbols };
	}

	/** Get file extension for icon/label */
	function getExt(name: string): string {
		const dot = name.lastIndexOf(".");
		return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
	}

	/** Get icon name for file type */
	function fileIcon(name: string): string {
		const ext = getExt(name);
		switch (ext) {
			case "ts":
			case "tsx":
				return "file-text";
			case "js":
			case "jsx":
				return "file-code";
			case "json":
				return "braces";
			case "md":
				return "book-open";
			case "css":
			case "scss":
			case "tailwind":
				return "palette";
			case "svelte":
				return "flame";
			case "html":
				return "globe";
			case "yaml":
			case "yml":
				return "settings";
			default:
				return "file";
		}
	}

	/** Map extension to label for suffix badge */
	function extLabel(name: string): string {
		const ext = getExt(name);
		if (ext) return `.${ext}`;
		return "";
	}

	/** Color for extension badge */
	function extColor(name: string): string {
		const ext = getExt(name);
		switch (ext) {
			case "ts":
				return "#3178c6";
			case "tsx":
				return "#3178c6";
			case "js":
				return "#f7df1e";
			case "jsx":
				return "#61dafb";
			case "svelte":
				return "#ff3e00";
			case "css":
			case "scss":
				return "#cc6699";
			case "json":
				return "#a8b1c4";
			case "md":
				return "#755838";
			default:
				return "var(--color-text-muted)";
		}
	}

	/** Check if node is a directory */
	function isDir(node: Record<string, unknown>): boolean {
		const t = node.type as string | undefined;
		const p = (node.path as string) || "";
		if (t === "directory" || t === "dir") return true;
		if (Array.isArray(node.children) && node.children.length > 0) return true;
		if (!t && p.endsWith("/")) return true;
		return false;
	}
</script>

<!-- ═══════════════════════════════════════════════════════════════════════════ -->
<!-- Loading State -->
<!-- ═══════════════════════════════════════════════════════════════════════════ -->
{#if loading}
	<div class="filetree-skeleton" aria-label="Loading file tree">
		{#each Array(8) as _, i (i)}
			<div class="skeleton-row" style="padding-left:{12 + (i % 3) * 16}px;">
				<div class="skeleton-icon skeleton-pulse"></div>
				<div class="skeleton-text skeleton-pulse" style="width:{50 + ((i * 17) % 40)}%;"></div>
			</div>
		{/each}
	</div>

	<!-- ═══════════════════════════════════════════════════════════════════════════ -->
	<!-- Error State -->
	<!-- ═══════════════════════════════════════════════════════════════════════════ -->
{:else if error}
	<div class="filetree-state">
		<div class="filetree-state-icon error">
			<Icon name="triangle-alert" size={20} strokeWidth={1.5} />
		</div>
		<div class="filetree-state-title">Failed to load file tree</div>
		<div class="filetree-state-text">{error}</div>
		{#if typeof onRetry === "function"}
			<button
				class="filetree-retry-btn"
				on:click={() => onRetry?.()}
				on:keydown={(e) => handleKeyDown(e, () => onRetry?.())}
			>
				<Icon name="refresh-cw" size={12} strokeWidth={2} />
				<span>Retry</span>
			</button>
		{/if}
	</div>

	<!-- ═══════════════════════════════════════════════════════════════════════════ -->
	<!-- Empty State -->
	<!-- ═══════════════════════════════════════════════════════════════════════════ -->
{:else if !architecture || architecture.length === 0}
	<div class="filetree-state">
		<div class="filetree-state-icon empty">
			<Icon name="folder-open" size={20} strokeWidth={1.5} />
		</div>
		<div class="filetree-state-title">No files indexed</div>
		<div class="filetree-state-text">
			This repository hasn't been indexed yet. Start indexing to browse its file structure.
		</div>
	</div>

	<!-- ═══════════════════════════════════════════════════════════════════════════ -->
	<!-- File Tree -->
	<!-- ═══════════════════════════════════════════════════════════════════════════ -->
{:else}
	<nav class="filetree" aria-label="File tree">
		<ul class="filetree-list" role="tree">
			{#each architecture as node (node.path || node.name)}
				{#if isDir(node)}
					{@const counts = countChildren(node)}
					{@const dirPath = (node.path as string) || (node.name as string) || ""}
					{@const dirName = (node.name as string) || dirPath.split("/").filter(Boolean).pop() || dirPath}
					<li role="treeitem" aria-expanded={!!expandedDirs[dirPath]} aria-selected={false}>
						<button
							class="filetree-dir"
							on:click={() => toggleDir(dirPath)}
							on:keydown={(e) => handleKeyDown(e, () => toggleDir(dirPath))}
							style="padding-left:12px;"
							aria-label="{expandedDirs[dirPath] ? 'Collapse' : 'Expand'} directory {dirName}"
						>
							<span class="filetree-chevron" class:expanded={!!expandedDirs[dirPath]}>
								<Icon name="chevron-right" size={12} strokeWidth={2} />
							</span>
							<Icon name="folder" size={14} strokeWidth={1.75} />
							<span class="filetree-name">{dirName}</span>
							<span class="filetree-badge">
								{counts.files}
								{counts.files === 1 ? "file" : "files"}
								{#if counts.symbols > 0}
									<span class="filetree-badge-sep">&middot;</span>
									{counts.symbols}
									{counts.symbols === 1 ? "symbol" : "symbols"}
								{/if}
							</span>
						</button>

						{#if expandedDirs[dirPath] && Array.isArray(node.children)}
							<ul class="filetree-list filetree-children" role="group">
								{#each node.children as child (child.path || child.name)}
									{#if isDir(child)}
										{@const childCounts = countChildren(child)}
										{@const childDirPath = (child.path as string) || (child.name as string) || ""}
										{@const childDirName =
											(child.name as string) || childDirPath.split("/").filter(Boolean).pop() || childDirPath}
										<li role="treeitem" aria-expanded={!!expandedDirs[childDirPath]} aria-selected={false}>
											<button
												class="filetree-dir"
												on:click={() => toggleDir(childDirPath)}
												on:keydown={(e) => handleKeyDown(e, () => toggleDir(childDirPath))}
												style="padding-left:28px;"
												aria-label="{expandedDirs[childDirPath] ? 'Collapse' : 'Expand'} directory {childDirName}"
											>
												<span class="filetree-chevron" class:expanded={!!expandedDirs[childDirPath]}>
													<Icon name="chevron-right" size={12} strokeWidth={2} />
												</span>
												<Icon name="folder" size={14} strokeWidth={1.75} />
												<span class="filetree-name">{childDirName}</span>
												<span class="filetree-badge">
													{childCounts.files}
													{childCounts.files === 1 ? "file" : "files"}
												</span>
											</button>

											{#if expandedDirs[childDirPath] && Array.isArray(child.children)}
												<ul class="filetree-list filetree-children" role="group">
													{#each child.children as leaf (leaf.path || leaf.name)}
														{@const leafName =
															(leaf.name as string) ||
															((leaf.path as string) || "").split("/").filter(Boolean).pop() ||
															"file"}
														{@const leafPath = (leaf.path as string) || leafName}
														{@const leafExt = extLabel(leafName)}
														<li role="treeitem" aria-selected={activeFile === leafPath}>
															<button
																class="filetree-file"
																class:active={activeFile === leafPath}
																on:click={() => selectFile(leafPath)}
																on:keydown={(e) => handleKeyDown(e, () => selectFile(leafPath))}
																style="padding-left:44px;"
																aria-label="Open file {leafName}"
															>
																<Icon name={fileIcon(leafName)} size={13} strokeWidth={1.75} />
																<span class="filetree-name">{leafName}</span>
																{#if leafExt}
																	<span class="filetree-ext" style="color:{extColor(leafName)};">
																		{leafExt}
																	</span>
																{/if}
																{#if leaf.symbolCounts && typeof leaf.symbolCounts === "object"}
																	{@const totalSymbolCount = Object.values(
																		leaf.symbolCounts as Record<string, number>
																	).reduce((a: number, b: number) => a + b, 0)}
																	<span class="filetree-symcount">{totalSymbolCount}</span>
																{/if}
															</button>
														</li>
													{/each}
												</ul>
											{/if}
										</li>
									{:else}
										{@const fileName =
											(child.name as string) ||
											((child.path as string) || "").split("/").filter(Boolean).pop() ||
											"file"}
										{@const filePath = (child.path as string) || fileName}
										{@const fileExt = extLabel(fileName)}
										<li role="treeitem" aria-selected={activeFile === filePath}>
											<button
												class="filetree-file"
												class:active={activeFile === filePath}
												on:click={() => selectFile(filePath)}
												on:keydown={(e) => handleKeyDown(e, () => selectFile(filePath))}
												style="padding-left:28px;"
												aria-label="Open file {fileName}"
											>
												<Icon name={fileIcon(fileName)} size={13} strokeWidth={1.75} />
												<span class="filetree-name">{fileName}</span>
												{#if fileExt}
													<span class="filetree-ext" style="color:{extColor(fileName)};">
														{fileExt}
													</span>
												{/if}
												{#if child.symbolCounts && typeof child.symbolCounts === "object"}
													{@const totalSymbolCount = Object.values(child.symbolCounts as Record<string, number>).reduce(
														(a: number, b: number) => a + b,
														0
													)}
													<span class="filetree-symcount">{totalSymbolCount}</span>
												{/if}
											</button>
										</li>
									{/if}
								{/each}
							</ul>
						{/if}
					</li>
				{:else}
					{@const fileName =
						(node.name as string) || ((node.path as string) || "").split("/").filter(Boolean).pop() || "file"}
					{@const filePath = (node.path as string) || fileName}
					{@const fileExt = extLabel(fileName)}
					<li role="treeitem" aria-selected={activeFile === filePath}>
						<button
							class="filetree-file"
							class:active={activeFile === filePath}
							on:click={() => selectFile(filePath)}
							on:keydown={(e) => handleKeyDown(e, () => selectFile(filePath))}
							style="padding-left:12px;"
							aria-label="Open file {fileName}"
						>
							<Icon name={fileIcon(fileName)} size={13} strokeWidth={1.75} />
							<span class="filetree-name">{fileName}</span>
							{#if fileExt}
								<span class="filetree-ext" style="color:{extColor(fileName)};">
									{fileExt}
								</span>
							{/if}
							{#if node.symbolCounts && typeof node.symbolCounts === "object"}
								{@const totalSymbolCount = Object.values(node.symbolCounts as Record<string, number>).reduce(
									(a: number, b: number) => a + b,
									0
								)}
								<span class="filetree-symcount">{totalSymbolCount}</span>
							{/if}
						</button>
					</li>
				{/if}
			{/each}
		</ul>
	</nav>
{/if}

<style>
	/* ── Skeleton Loading ── */
	.filetree-skeleton {
		padding: 8px 0;
	}

	.skeleton-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 12px;
	}

	.skeleton-icon {
		width: 14px;
		height: 14px;
		border-radius: 4px;
		background: rgba(255, 255, 255, 0.06);
		flex-shrink: 0;
	}

	.skeleton-text {
		height: 10px;
		border-radius: 4px;
		background: rgba(255, 255, 255, 0.06);
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

	/* ── State Containers ── */
	.filetree-state {
		text-align: center;
		padding: 24px 16px;
	}

	.filetree-state-icon {
		display: inline-flex;
		width: 44px;
		height: 44px;
		border-radius: 12px;
		align-items: center;
		justify-content: center;
		margin-bottom: 10px;
	}

	.filetree-state-icon.empty {
		background: rgba(14, 165, 233, 0.1);
		color: var(--color-primary);
		border: 1px solid rgba(14, 165, 233, 0.15);
	}

	.filetree-state-icon.error {
		background: rgba(239, 68, 68, 0.1);
		color: #ef4444;
		border: 1px solid rgba(239, 68, 68, 0.15);
	}

	.filetree-state-title {
		font-size: 0.82rem;
		font-weight: 700;
		color: var(--color-text);
		margin-bottom: 4px;
	}

	.filetree-state-text {
		font-size: 0.72rem;
		color: var(--color-text-muted);
		line-height: 1.5;
		margin-bottom: 10px;
	}

	.filetree-retry-btn {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 6px 14px;
		border-radius: 8px;
		border: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.06);
		color: var(--color-text);
		font-size: 0.72rem;
		font-weight: 700;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.filetree-retry-btn:hover {
		background: rgba(255, 255, 255, 0.1);
		border-color: var(--color-primary);
	}

	/* ── Tree Layout ── */
	.filetree {
		padding: 4px 0;
	}

	.filetree-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.filetree-children {
		border-left: 1px solid rgba(255, 255, 255, 0.06);
		margin-left: 18px;
	}

	:global(html.dark) .filetree-children {
		border-left-color: rgba(255, 255, 255, 0.08);
	}

	/* ── Directory Row ── */
	.filetree-dir {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		border: none;
		background: transparent;
		color: var(--color-text);
		font-size: 0.76rem;
		font-weight: 600;
		padding: 5px 12px;
		cursor: pointer;
		transition: background 0.12s ease;
		border-radius: 6px;
		margin: 1px 6px;
		text-align: left;
	}

	.filetree-dir:hover {
		background: rgba(255, 255, 255, 0.06);
	}

	:global(html.dark) .filetree-dir:hover {
		background: rgba(255, 255, 255, 0.04);
	}

	.filetree-dir:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: -2px;
	}

	/* ── Chevron ── */
	.filetree-chevron {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 14px;
		height: 14px;
		transition: transform 0.15s ease;
		color: var(--color-text-muted);
		flex-shrink: 0;
	}

	.filetree-chevron.expanded {
		transform: rotate(90deg);
	}

	/* ── File Row ── */
	.filetree-file {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		border: none;
		background: transparent;
		color: var(--color-text-muted);
		font-size: 0.74rem;
		font-weight: 500;
		padding: 4px 12px;
		cursor: pointer;
		transition:
			background 0.12s ease,
			color 0.12s ease;
		border-radius: 6px;
		margin: 1px 6px;
		text-align: left;
	}

	.filetree-file:hover {
		background: rgba(255, 255, 255, 0.06);
		color: var(--color-text);
	}

	:global(html.dark) .filetree-file:hover {
		background: rgba(255, 255, 255, 0.04);
	}

	.filetree-file.active {
		background: rgba(14, 165, 233, 0.1);
		color: var(--color-primary);
		border: 1px solid rgba(14, 165, 233, 0.15);
	}

	.filetree-file:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: -2px;
	}

	/* ── File Name ── */
	.filetree-name {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		flex: 1;
		min-width: 0;
	}

	/* ── Extension Badge ── */
	.filetree-ext {
		font-size: 0.58rem;
		font-weight: 700;
		padding: 1px 5px;
		border-radius: 4px;
		background: rgba(255, 255, 255, 0.06);
		flex-shrink: 0;
		letter-spacing: 0.02em;
	}

	/* ── Directory Badge ── */
	.filetree-badge {
		font-size: 0.58rem;
		font-weight: 600;
		color: var(--color-text-muted);
		opacity: 0.7;
		margin-left: auto;
		flex-shrink: 0;
		white-space: nowrap;
	}

	.filetree-badge-sep {
		margin: 0 2px;
		opacity: 0.5;
	}

	/* ── Symbol Count (files) ── */
	.filetree-symcount {
		font-size: 0.54rem;
		font-weight: 600;
		color: var(--color-text-muted);
		opacity: 0.5;
		background: rgba(255, 255, 255, 0.04);
		padding: 1px 4px;
		border-radius: 3px;
		flex-shrink: 0;
	}
</style>
