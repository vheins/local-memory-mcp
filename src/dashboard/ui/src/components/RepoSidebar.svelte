<script lang="ts">
	import {
		availableRepos,
		currentRepo,
		isRepoSidebarCollapsed,
		orderedRepos,
		repoSearchQuery,
		activeTab
	} from "../lib/stores";
	import { NAV_GROUPS } from "../lib/navigation";
	import { createRepoSidebarHandler } from "../lib/composables/useRepoSidebar";
	import Icon from "../lib/Icon.svelte";
	import RepoItem from "./RepoItem.svelte";

	export let onRepoSelect: (repo: string) => void = () => {};
	export let onTabSelect: (tab: string) => void = () => {};

	const handler = createRepoSidebarHandler(onRepoSelect);

	$: collapsed = $isRepoSidebarCollapsed;
</script>

<aside
	class="sidebar glass-strong flex flex-col"
	class:collapsed
	style="border-right: 1px solid var(--color-border);"
	aria-label="Repository sidebar"
>
	<!-- Header -->
	<div class="sidebar-header" style="border-bottom: 1px solid var(--color-border);">
		{#if !collapsed}
			<div class="flex items-center gap-2">
				<div class="brand-icon">
					<Icon name="brain" size={14} strokeWidth={1.75} />
				</div>
				<div>
					<div class="font-bold text-sm" style="color:var(--color-text);letter-spacing:-0.02em;">Memory MCP</div>
					<div class="section-label" style="font-size:0.6rem;margin-top:0;">Dashboard</div>
				</div>
			</div>
		{:else}
			<div class="brand-icon" style="margin:auto;">
				<Icon name="brain" size={14} strokeWidth={1.75} />
			</div>
		{/if}

		<button
			class="btn btn-ghost btn-icon btn-sm collapse-btn"
			on:click={handler.toggleCollapse}
			title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
			aria-label={collapsed ? "Expand" : "Collapse"}
		>
			<span
				style="transition: transform 0.3s ease; display:inline-flex; transform: rotate({collapsed ? '180deg' : '0deg'})"
			>
				<Icon name="chevron-left" size={14} strokeWidth={2} />
			</span>
		</button>
	</div>

	<!-- Scope-aware primary navigation. Groups make the global/workspace/system
	     boundary explicit without adding another click or changing route ids. -->
	<nav class="nav-section" class:collapsed aria-label="Primary navigation">
		{#each NAV_GROUPS as group (group.id)}
			<div class="nav-group" data-scope={group.id}>
				{#if !collapsed}
					<div class="nav-group-label">
						<span>{group.label}</span>
						{#if group.id === "workspace" && $currentRepo}
							<span class="scope-dot" aria-hidden="true"></span>
						{/if}
					</div>
				{/if}
				{#each group.items as tab (tab.id)}
					<button
						class="nav-item"
						class:active={$activeTab === tab.id}
						class:collapsed
						on:click={() => onTabSelect(tab.id)}
						title={collapsed ? `${tab.label} — ${tab.description}` : tab.description}
						id="nav-{tab.id}"
						aria-current={$activeTab === tab.id ? "page" : undefined}
					>
						<Icon name={tab.icon} size={collapsed ? 18 : 16} strokeWidth={1.75} />
						{#if !collapsed}
							<span class="nav-label">{tab.label}</span>
							{#if $activeTab === tab.id}<span class="nav-active-dot" aria-hidden="true"></span>{/if}
						{/if}
					</button>
				{/each}
			</div>
		{/each}
	</nav>

	<!-- Workspace selector -->
	<div class="workspace-section" class:collapsed>
		{#if !collapsed}
			<div class="workspace-heading">
				<div>
					<div class="nav-group-label">Workspace</div>
					<div class="workspace-caption">Choose repository context</div>
				</div>
				<span class="repo-count-chip">{$availableRepos.length}</span>
			</div>
			<div class="search-wrapper">
				<span class="search-icon"><Icon name="search" size={14} strokeWidth={2} /></span>
				<input
					class="form-input search-input"
					type="text"
					placeholder="Find a repository…"
					aria-label="Search repositories"
					bind:value={$repoSearchQuery}
				/>
			</div>
		{/if}
	</div>

	<!-- Repo List -->
	<div class="repo-list overflow-y-auto flex-1 p-2">
		{#if !collapsed}

			<!-- Pinned -->
			{#if $orderedRepos.pinned.length > 0}
				<div class="group-label">
					<Icon name="star" size={10} strokeWidth={2} />
					Pinned
				</div>
				{#each $orderedRepos.pinned as item (item.repo)}
					<RepoItem
						{item}
						draggable={true}
						pinned={true}
						selected={$currentRepo === item.repo}
						onSelect={() => handler.selectRepo(item.repo)}
						onPin={(e) => handler.togglePin(item.repo, e)}
						on:drag:start={(e) => handler.onDragStart(e.detail.repo, e.detail.event)}
						on:drag:over={(e) => handler.onDragOver(e.detail.repo, e.detail.event)}
						on:drop={(e) => handler.onDrop(e.detail.repo, e.detail.event)}
						on:drag:end={(e) => handler.onDragEnd(e.detail.event)}
					/>
				{/each}
			{/if}

			<!-- Unpinned -->
			{#if $orderedRepos.unpinned.length > 0}
				{#if $orderedRepos.pinned.length > 0}
					<div class="group-label" style="margin-top:6px;">
						<Icon name="layers" size={10} strokeWidth={2} />
						All
					</div>
				{/if}
				{#each $orderedRepos.unpinned as item (item.repo)}
					<RepoItem
						{item}
						draggable={false}
						pinned={false}
						selected={$currentRepo === item.repo}
						onSelect={() => handler.selectRepo(item.repo)}
						onPin={(e) => handler.togglePin(item.repo, e)}
					/>
				{/each}
			{/if}

			{#if $availableRepos.length === 0}
				<div style="text-align:center;padding:24px 16px;color:var(--color-text-muted);">
					<Icon name="inbox" size={24} strokeWidth={1.5} />
					<div style="font-size:0.82rem;margin-top:8px;">No repositories found</div>
				</div>
			{/if}
		{:else}
			<!-- Collapsed: show initials only -->
			{#each $availableRepos as item (item.repo)}
				<div
					class="repo-item collapsed"
					class:active={$currentRepo === item.repo}
					role="button"
					tabindex="0"
					on:click={() => handler.selectRepo(item.repo)}
					on:keydown={(e) => (e.key === "Enter" || e.key === " ") && handler.selectRepo(item.repo)}
					title={item.repo}
				>
					{#if $currentRepo === item.repo}
						<div class="repo-active-indicator"></div>
					{/if}
					<div class="repo-avatar" style="margin:auto;">{handler.getRepoInitials(item.repo)}</div>
				</div>
			{/each}
		{/if}
	</div>
</aside>

<style>
	.sidebar-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 16px;
		min-height: 60px;
	}

	.brand-icon {
		width: 30px;
		height: 30px;
		border-radius: 9px;
		background: linear-gradient(135deg, #0ea5e9, #6366f1);
		display: flex;
		align-items: center;
		justify-content: center;
		color: white;
		flex-shrink: 0;
		box-shadow: 0 4px 12px rgba(14, 165, 233, 0.3);
		transition:
			box-shadow 0.2s ease,
			transform 0.2s ease;
	}

	.brand-icon:hover {
		box-shadow: 0 4px 18px rgba(14, 165, 233, 0.5);
		transform: scale(1.05);
	}

	.collapse-btn {
		flex-shrink: 0;
	}

	.nav-section {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 12px 10px;
		border-bottom: 1px solid var(--color-border);
	}

	.nav-group {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.nav-group-label {
		display: flex;
		align-items: center;
		gap: 6px;
		min-height: 18px;
		padding: 0 10px 4px;
		font-size: 0.6875rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-text-faint);
	}

	.scope-dot {
		width: 6px;
		height: 6px;
		border-radius: 999px;
		background: var(--color-success);
	}

	.nav-item {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 40px;
		padding: 9px 10px;
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text-muted);
		background: transparent;
		border: none;
		cursor: pointer;
		transition: background-color 180ms ease-out, color 180ms ease-out;
		text-align: left;
		position: relative;
		width: 100%;
	}

	.nav-item:hover {
		color: var(--color-text);
		background: rgba(14, 165, 233, 0.07);
	}

	.nav-item.active {
		color: var(--color-primary, #0ea5e9);
		background: rgba(14, 165, 233, 0.1);
	}

	:global(html.dark) .nav-item:hover {
		background: rgba(14, 165, 233, 0.1);
	}

	:global(html.dark) .nav-item.active {
		background: rgba(56, 189, 248, 0.12);
		color: #7dd3fc;
	}

	.nav-label {
		flex: 1;
	}

	.nav-active-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--color-primary, #0ea5e9);
		flex-shrink: 0;
	}

	:global(html.dark) .nav-active-dot {
		background: #7dd3fc;
	}

	.nav-section.collapsed {
		align-items: stretch;
		padding: 10px 6px;
		gap: 10px;
	}

	.nav-section.collapsed .nav-group {
		gap: 4px;
	}

	.nav-item.collapsed {
		justify-content: center;
		padding: 9px 4px;
		width: auto;
		align-self: stretch;
	}

	.workspace-section {
		padding: 12px;
		border-bottom: 1px solid var(--color-border);
	}

	.workspace-section.collapsed {
		display: none;
	}

	.workspace-heading {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 8px;
	}

	.workspace-heading .nav-group-label {
		padding: 0;
	}

	.workspace-caption {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.repo-list {
		scrollbar-width: thin;
	}

	.search-wrapper {
		position: relative;
	}

	.search-icon {
		position: absolute;
		left: 10px;
		top: 50%;
		transform: translateY(-50%);
		color: var(--color-text-muted);
		display: flex;
		pointer-events: none;
	}

	.search-input {
		min-height: 40px;
		padding-left: 34px;
		font-size: 0.8125rem;
		background: var(--color-surface);
	}

	:global(html.dark) .search-input {
		background: rgba(10, 18, 38, 0.5);
	}

	.group-label {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 0.6rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--color-text-muted);
		padding: 6px 10px 4px;
		opacity: 0.75;
	}

	.repo-count-chip {
		font-size: 0.62rem;
		font-weight: 700;
		background: rgba(14, 165, 233, 0.12);
		/* TASK-404: #0ea5e9 @ ~9.92px = 2.77:1 on the light sidebar (fails WCAG
		   AA 4.5:1). sky-700 #0369a1 ≈ 5.6:1 on white — passes AA for small text. */
		color: #0369a1;
		padding: 1px 7px;
		border-radius: 9999px;
		border: 1px solid rgba(14, 165, 233, 0.22);
	}

	/* Dark theme: #0369a1 is too dim on the navy surface — restore a lighter
	   sky blue that keeps ≥4.5:1 there. */
	:global(html.dark) .repo-count-chip {
		color: #38bdf8;
	}
</style>
