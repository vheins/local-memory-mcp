<script lang="ts">
	import Icon from "../lib/Icon.svelte";
	import type { Readable } from "svelte/store";
	import type { ReferenceItem } from "../lib/stores";

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	export let handler: any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	export let appState: Readable<any>;
	export let filteredTools: Readable<ReferenceItem[]>;
	export let filteredPrompts: Readable<ReferenceItem[]>;
	export let filteredResources: Readable<ReferenceItem[]>;

	$: state = $appState;
	$: tools = $filteredTools;
	$: prompts = $filteredPrompts;
	$: resources = $filteredResources;

	function handleKeydown(e: KeyboardEvent, type: "tool" | "prompt" | "resource", item: ReferenceItem["data"]) {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			handler.openReferenceDrawer(type, item);
		}
	}
</script>

<div class="animate-fade-in">
	<!-- Header -->
	<div class="glass card" style="margin-bottom:16px;padding:14px 18px;">
		<div class="ref-header">
			<div class="flex items-center gap-2">
				<Icon name="book-open" size={15} strokeWidth={1.75} />
				<span style="font-size:0.9rem;font-weight:800;color:var(--color-text);letter-spacing:-0.02em;"
					>MCP Reference</span
				>
				{#if state.capabilities}
					<span class="ref-total-badge"
						>{(state.capabilities.tools?.length || 0) + (state.capabilities.prompts?.length || 0)} items</span
					>
				{/if}
			</div>
			<!-- Quick Search -->
			<div class="ref-search-wrap">
				<span class="ref-search-icon"><Icon name="search" size={12} strokeWidth={2} /></span>
				<input
					class="form-input ref-search-input"
					type="text"
					placeholder="Search tools & prompts…"
					bind:value={$appState.referenceSearch}
				/>
				{#if state.referenceSearch}
					<button class="ref-clear-btn" on:click={() => handler.setReferenceSearch("")}>
						<Icon name="x" size={11} strokeWidth={2.5} />
					</button>
				{/if}
			</div>
		</div>
	</div>

	<!-- Body: sidebar + main -->
	<div class="ref-body">
		<!-- Category sidebar -->
		<div class="glass ref-sidebar">
			<div class="ref-sidebar-label">Category</div>
			{#each [{ id: "all", icon: "layers", label: "All", count: (state.capabilities?.tools?.length || 0) + (state.capabilities?.prompts?.length || 0) + (state.capabilities?.resources?.length || 0) }, { id: "tools", icon: "tool", label: "Tools", count: state.capabilities?.tools?.length || 0 }, { id: "prompts", icon: "sparkle", label: "Prompts", count: state.capabilities?.prompts?.length || 0 }, { id: "resources", icon: "database", label: "Resources", count: state.capabilities?.resources?.length || 0 }] as cat}
				<button
					class="ref-cat-btn"
					class:active={state.referenceFilter === cat.id}
					on:click={() => handler.setReferenceFilter(cat.id)}
				>
					<Icon name={cat.icon} size={13} strokeWidth={1.75} />
					<span>{cat.label}</span>
					<span class="ref-cat-count">{cat.count}</span>
				</button>
			{/each}
		</div>

		<!-- Main content -->
		<div class="ref-main">
			{#if !state.capabilities}
				<div style="padding:40px;text-align:center;">
					<div class="skeleton" style="height:60px;border-radius:12px;margin-bottom:10px;"></div>
					<div class="skeleton" style="height:60px;border-radius:12px;margin-bottom:10px;"></div>
					<div class="skeleton" style="height:60px;border-radius:12px;"></div>
				</div>
			{:else}
				<!-- Tools section -->
				{#if tools.length > 0}
					<div class="ref-section-header">
						<Icon name="tool" size={13} strokeWidth={1.75} />
						<span>Tools</span>
						<span class="ref-section-count">{tools.length}</span>
					</div>
					<div class="ref-grid">
						{#each tools as tool}
							<div
								class="ref-card ref-card-tool animate-fade-in"
								on:click={() => handler.openReferenceDrawer("tool", tool.data)}
								on:keydown={(e) => handleKeydown(e, "tool", tool.data)}
								role="button"
								tabindex="0"
							>
								<div class="ref-card-top">
									<span class="ref-type-badge ref-type-tool">
										<Icon name="tool" size={10} strokeWidth={2} />
										Tool
									</span>
								</div>
								<div class="ref-card-name">{tool.data.name}</div>
								{#if tool.data.description}
									<div class="ref-card-desc">{tool.data.description}</div>
								{/if}
								{#if tool.data.inputSchema?.properties}
									<div class="ref-params">
										{#each Object.entries(tool.data.inputSchema.properties).slice(0, 4) as [param]}
											<code class="ref-param-tag">{param}</code>
										{/each}
										{#if Object.keys(tool.data.inputSchema.properties).length > 4}
											<code class="ref-param-tag ref-param-more"
												>+{Object.keys(tool.data.inputSchema.properties).length - 4}</code
											>
										{/if}
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}

				<!-- Prompts section -->
				{#if prompts.length > 0}
					<div class="ref-section-header" style="margin-top:{tools.length > 0 ? '20px' : '0'}">
						<Icon name="sparkle" size={13} strokeWidth={1.75} />
						<span>Prompts</span>
						<span class="ref-section-count">{prompts.length}</span>
					</div>
					<div class="ref-grid">
						{#each prompts as prompt}
							<div
								class="ref-card ref-card-prompt animate-fade-in"
								on:click={() => handler.openReferenceDrawer("prompt", prompt.data)}
								on:keydown={(e) => handleKeydown(e, "prompt", prompt.data)}
								role="button"
								tabindex="0"
							>
								<div class="ref-card-top">
									<span class="ref-type-badge ref-type-prompt">
										<Icon name="sparkle" size={10} strokeWidth={2} />
										Prompt
									</span>
								</div>
								<div class="ref-card-name">{prompt.data.name}</div>
								{#if prompt.data.description}
									<div class="ref-card-desc">{prompt.data.description}</div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}

				<!-- Resources section -->
				{#if resources.length > 0}
					<div class="ref-section-header" style="margin-top:{tools.length > 0 || prompts.length > 0 ? '20px' : '0'}">
						<Icon name="database" size={13} strokeWidth={1.75} />
						<span>Resources</span>
						<span class="ref-section-count">{resources.length}</span>
					</div>
					<div class="ref-grid">
						{#each resources as resource}
							<div
								class="ref-card ref-card-resource animate-fade-in"
								on:click={() => handler.openReferenceDrawer("resource", resource.data)}
								on:keydown={(e) => handleKeydown(e, "resource", resource.data)}
								role="button"
								tabindex="0"
							>
								<div class="ref-card-top">
									<span class="ref-type-badge ref-type-resource">
										<Icon name="database" size={10} strokeWidth={2} />
										Resource
									</span>
								</div>
								<div class="ref-card-name">{resource.data.name}</div>
								{#if resource.data.description}
									<div class="ref-card-desc">{resource.data.description}</div>
								{/if}
								{#if resource.data.uri}
									<div class="ref-params">
										<code class="ref-param-tag" style="background:var(--color-bg);border:1px solid var(--color-border);"
											>{resource.data.uri}</code
										>
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}

				{#if tools.length === 0 && prompts.length === 0 && resources.length === 0}
					<div style="text-align:center;padding:48px 16px;color:var(--color-text-muted);">
						<Icon name="search" size={28} strokeWidth={1.25} />
						<div style="font-size:0.82rem;margin-top:10px;">No results for "{state.referenceSearch}"</div>
					</div>
				{/if}
			{/if}
		</div>
	</div>
</div>

<style>
	.ref-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
	}

	.ref-total-badge {
		font-size: 0.62rem;
		font-weight: 700;
		background: rgba(14, 165, 233, 0.1);
		color: #0ea5e9;
		padding: 2px 8px;
		border-radius: 9999px;
		border: 1px solid rgba(14, 165, 233, 0.2);
	}

	.ref-search-wrap {
		position: relative;
		flex: 1;
		max-width: 300px;
	}

	.ref-search-icon {
		position: absolute;
		left: 10px;
		top: 50%;
		transform: translateY(-50%);
		color: var(--color-text-muted);
		display: flex;
		pointer-events: none;
	}

	.ref-search-input {
		padding-left: 32px;
		padding-right: 28px;
		font-size: 0.8rem;
		width: 100%;
	}

	.ref-clear-btn {
		position: absolute;
		right: 8px;
		top: 50%;
		transform: translateY(-50%);
		background: transparent;
		border: none;
		cursor: pointer;
		color: var(--color-text-muted);
		display: flex;
		padding: 2px;
		border-radius: 4px;
		transition: color 0.15s ease;
	}

	.ref-clear-btn:hover {
		color: var(--color-text);
	}

	.ref-body {
		display: grid;
		grid-template-columns: 160px 1fr;
		gap: 16px;
		align-items: start;
	}

	@media (max-width: 700px) {
		.ref-body {
			grid-template-columns: 1fr;
		}
	}

	.ref-sidebar {
		padding: 12px;
		border-radius: 16px;
		border: 1px solid var(--color-border);
		display: flex;
		flex-direction: column;
		gap: 3px;
		position: sticky;
		top: 80px;
	}

	.ref-sidebar-label {
		font-size: 0.6rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--color-text-muted);
		padding: 4px 8px 8px;
	}

	.ref-cat-btn {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 7px 10px;
		border-radius: 9px;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--color-text-muted);
		background: transparent;
		border: none;
		cursor: pointer;
		width: 100%;
		text-align: left;
		transition: all 0.15s ease;
	}

	.ref-cat-btn:hover {
		background: rgba(14, 165, 233, 0.06);
		color: var(--color-text);
	}

	.ref-cat-btn.active {
		background: rgba(14, 165, 233, 0.1);
		color: #0ea5e9;
		border: 1px solid rgba(14, 165, 233, 0.2);
	}

	:global(html.dark) .ref-cat-btn.active {
		background: rgba(14, 165, 233, 0.15);
		color: #38bdf8;
		border-color: rgba(56, 189, 248, 0.25);
	}

	.ref-cat-count {
		margin-left: auto;
		font-size: 0.62rem;
		font-weight: 700;
		background: rgba(100, 116, 139, 0.12);
		color: var(--color-text-muted);
		padding: 1px 6px;
		border-radius: 9999px;
	}

	.ref-main {
		display: flex;
		flex-direction: column;
	}

	.ref-section-header {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--color-text-muted);
		margin-bottom: 10px;
	}

	.ref-section-count {
		font-size: 0.6rem;
		background: rgba(100, 116, 139, 0.1);
		color: var(--color-text-muted);
		padding: 1px 6px;
		border-radius: 9999px;
		font-weight: 700;
	}

	.ref-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		gap: 10px;
	}

	.ref-card {
		padding: 18px 20px;
		border-radius: 16px;
		border: 1px solid rgba(0, 0, 0, 0.06);
		background: #ffffff;
		box-shadow:
			0 4px 6px -1px rgba(0, 0, 0, 0.05),
			0 2px 4px -2px rgba(0, 0, 0, 0.03);
		transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
		display: flex;
		flex-direction: column;
		gap: 8px;
		cursor: pointer;
		position: relative;
		overflow: hidden;
	}

	.ref-card::before {
		content: "";
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 3px;
		background: transparent;
		transition: all 0.2s ease;
	}

	.ref-card:hover {
		transform: translateY(-2px);
		box-shadow:
			0 12px 24px -4px rgba(0, 0, 0, 0.08),
			0 8px 12px -6px rgba(0, 0, 0, 0.04);
		border-color: rgba(0, 0, 0, 0.08);
	}

	:global(html.dark) .ref-card {
		background: rgba(10, 18, 38, 0.8);
		border: 1px solid rgba(255, 255, 255, 0.08);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
	}

	:global(html.dark) .ref-card:hover {
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
		border-color: rgba(255, 255, 255, 0.15);
	}

	.ref-card-tool:hover::before {
		background: linear-gradient(90deg, #6366f1, #a855f7);
	}
	.ref-card-prompt:hover::before {
		background: linear-gradient(90deg, #a855f7, #ec4899);
	}
	.ref-card-resource:hover::before {
		background: linear-gradient(90deg, #10b981, #3b82f6);
	}

	.ref-card-top {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.ref-type-badge {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 0.6rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		padding: 2px 7px;
		border-radius: 9999px;
		border: 1px solid transparent;
	}

	.ref-type-tool {
		background: rgba(99, 102, 241, 0.1);
		color: #6366f1;
		border-color: rgba(99, 102, 241, 0.2);
	}

	.ref-type-prompt {
		background: rgba(168, 85, 247, 0.1);
		color: #a855f7;
		border-color: rgba(168, 85, 247, 0.2);
	}

	:global(html.dark) .ref-type-tool {
		color: #818cf8;
	}
	:global(html.dark) .ref-type-prompt {
		color: #c084fc;
	}

	.ref-card-name {
		font-size: 0.82rem;
		font-weight: 700;
		color: var(--color-text);
		word-break: break-word;
	}

	.ref-card-desc {
		font-size: 0.72rem;
		color: var(--color-text-muted);
		line-height: 1.55;
	}

	.ref-params {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 4px;
	}

	.ref-param-tag {
		font-family: "JetBrains Mono", "Fira Code", monospace;
		font-size: 0.65rem;
		background: rgba(14, 165, 233, 0.08);
		color: #0ea5e9;
		padding: 1px 6px;
		border-radius: 5px;
		border: 1px solid rgba(14, 165, 233, 0.18);
	}

	.ref-param-more {
		background: rgba(100, 116, 139, 0.1);
		color: var(--color-text-muted);
		border-color: rgba(100, 116, 139, 0.2);
	}

	:global(html.dark) .ref-param-tag {
		background: rgba(14, 165, 233, 0.12);
		color: #38bdf8;
		border-color: rgba(56, 189, 248, 0.2);
	}
</style>
