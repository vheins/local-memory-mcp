<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import { availableRepos } from "../lib/stores";
	import { arenaStateManager } from "../lib/arena/arenaStateManager";
	import { ROLE_COLORS } from "../lib/arena/arenaTransform";
	import Icon from "../lib/Icon.svelte";
	import type { FilterState } from "../lib/arena/arenaEvents";

	// ── State ────────────────────────────────────────────────────────────────
	let collapsed = true;
	let currentFilter: FilterState = {
		repository: null,
		roles: [],
		priorities: [],
		statuses: [],
		search: ""
	};

	const AGENT_ROLES = [
		"backend",
		"frontend",
		"debugger",
		"devops",
		"data-engineer",
		"explore",
		"documentation",
		"general"
	] as const;

	const PRIORITIES = [
		{ key: "p0", label: "P0 Critical", color: "#ef4444" },
		{ key: "p1", label: "P1 High", color: "#f59e0b" },
		{ key: "p2", label: "P2 Medium", color: "#3b82f6" },
		{ key: "p3", label: "P3 Low", color: "#64748b" }
	] as const;

	const STATUSES = [
		{ key: "in_progress", label: "In Progress", color: "#a855f7" },
		{ key: "pending", label: "Pending", color: "#0ea5e9" },
		{ key: "blocked", label: "Blocked", color: "#ef4444" },
		{ key: "backlog", label: "Backlog", color: "#64748b" },
		{ key: "recovery", label: "Recovery", color: "#14b8a6" }
	] as const;

	// ── Subscribe to state manager for current filter ──────────────────────
	const unsub = arenaStateManager.getStore().subscribe(($state) => {
		currentFilter = { ...$state.ui.activeFilter };
	});

	onDestroy(() => unsub());

	// ── Keyboard shortcut ──────────────────────────────────────────────────
	function onKeyDown(e: KeyboardEvent): void {
		if (
			e.key === "f" &&
			!e.ctrlKey &&
			!e.metaKey &&
			!e.altKey &&
			e.target instanceof HTMLElement &&
			e.target.tagName !== "INPUT" &&
			e.target.tagName !== "TEXTAREA"
		) {
			e.preventDefault();
			collapsed = !collapsed;
		}
	}

	onMount(() => {
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	});

	// ── Filter mutators ────────────────────────────────────────────────────
	function toggleRepo(repo: string | null): void {
		const next = currentFilter.repository === repo ? null : repo;
		currentFilter.repository = next;
		arenaStateManager.setFilter({ repository: next });
	}

	function toggleRole(role: string): void {
		const roles = currentFilter.roles.includes(role)
			? currentFilter.roles.filter((r) => r !== role)
			: [...currentFilter.roles, role];
		currentFilter.roles = roles;
		arenaStateManager.setFilter({ roles });
	}

	function togglePriority(pKey: string): void {
		const priorities = currentFilter.priorities.includes(pKey)
			? currentFilter.priorities.filter((p) => p !== pKey)
			: [...currentFilter.priorities, pKey];
		currentFilter.priorities = priorities;
		arenaStateManager.setFilter({ priorities });
	}

	function toggleStatus(sKey: string): void {
		const statuses = currentFilter.statuses.includes(sKey)
			? currentFilter.statuses.filter((s) => s !== sKey)
			: [...currentFilter.statuses, sKey];
		currentFilter.statuses = statuses;
		arenaStateManager.setFilter({ statuses });
	}

	function onSearchInput(e: Event): void {
		const val = (e.target as HTMLInputElement).value;
		currentFilter.search = val;
		arenaStateManager.setFilter({ search: val });
	}

	function clearAll(): void {
		currentFilter = { repository: null, roles: [], priorities: [], statuses: [], search: "" };
		arenaStateManager.setFilter(currentFilter);
	}

	// ── Derived: active filter count ──────────────────────────────────────
	$: activeCount =
		(currentFilter.repository ? 1 : 0) +
		currentFilter.roles.length +
		currentFilter.priorities.length +
		currentFilter.statuses.length +
		(currentFilter.search ? 1 : 0);
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="filter-bar-root" class:collapsed>
	<!-- Toggle button -->
	<button
		class="filter-toggle"
		class:active={activeCount > 0}
		on:click={() => (collapsed = !collapsed)}
		title="Toggle filters (F)"
		aria-expanded={!collapsed}
		aria-label="Toggle filter bar"
	>
		<Icon name="circle-dot" size={14} strokeWidth={1.75} />
		{#if activeCount > 0}
			<span class="filter-count">{activeCount}</span>
		{/if}
	</button>

	{#if !collapsed}
		<!-- svelte-ignore a11y-no-static-element-interactions -->
		<div class="filter-panel">
			<!-- Search -->
			<div class="filter-section search-section">
				<span class="search-icon">
					<svg
						width="13"
						height="13"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg
					>
				</span>
				<input
					type="text"
					class="search-input"
					placeholder="Search agents, tasks…"
					value={currentFilter.search}
					on:input={onSearchInput}
				/>
				{#if currentFilter.search}
					<button
						class="search-clear"
						on:click={() => {
							currentFilter.search = "";
							arenaStateManager.setFilter({ search: "" });
						}}
						aria-label="Clear search"
					>
						<Icon name="circle-x" size={12} />
					</button>
				{/if}
			</div>

			<!-- Separator -->
			<div class="filter-sep"></div>

			<!-- Repository -->
			<div class="filter-section">
				<span class="filter-label">Repo</span>
				<select
					class="repo-select"
					value={currentFilter.repository ?? ""}
					on:change={(e) => toggleRepo((e.target as HTMLSelectElement).value || null)}
				>
					<option value="">All repos</option>
					{#each $availableRepos as r}
						<option value={r.repo}>{r.repo.split("/").pop()}</option>
					{/each}
				</select>
			</div>

			<div class="filter-sep"></div>

			<!-- Roles -->
			<div class="filter-section toggle-group">
				<span class="filter-label">Roles</span>
				{#each AGENT_ROLES as role}
					<button
						class="role-toggle"
						class:active={currentFilter.roles.includes(role)}
						style="--role-color:{ROLE_COLORS[role] ?? '#64748b'}"
						on:click={() => toggleRole(role)}
						title={role}
					>
						<span class="role-dot"></span>
						<span class="role-text">{role}</span>
					</button>
				{/each}
			</div>

			<div class="filter-sep"></div>

			<!-- Priority -->
			<div class="filter-section toggle-group">
				<span class="filter-label">Priority</span>
				{#each PRIORITIES as p}
					<button
						class="priority-toggle"
						class:active={currentFilter.priorities.includes(p.key)}
						style="--pri-color:{p.color}"
						on:click={() => togglePriority(p.key)}
						title={p.label}
					>
						<span class="pri-dot"></span>
						<span class="pri-text">{p.key}</span>
					</button>
				{/each}
			</div>

			<div class="filter-sep"></div>

			<!-- Status -->
			<div class="filter-section toggle-group">
				<span class="filter-label">Status</span>
				{#each STATUSES as s}
					<button
						class="status-toggle"
						class:active={currentFilter.statuses.includes(s.key)}
						style="--status-color:{s.color}"
						on:click={() => toggleStatus(s.key)}
						title={s.label}
					>
						<span class="status-dot"></span>
						<span class="status-text">{s.label}</span>
					</button>
				{/each}
			</div>

			<!-- Clear all -->
			{#if activeCount > 0}
				<div class="filter-sep"></div>
				<button class="clear-btn" on:click={clearAll} title="Clear all filters">
					<Icon name="circle-x" size={11} />
					Clear all
				</button>
			{/if}
		</div>
	{/if}
</div>

<style>
	.filter-bar-root {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 16px;
		border-bottom: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.02);
		min-height: 34px;
		flex-wrap: wrap;
	}

	.filter-toggle {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 4px 8px;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		font-size: 0.7rem;
		font-weight: 600;
		transition: all 0.15s ease;
		flex-shrink: 0;
	}
	.filter-toggle:hover {
		background: rgba(100, 116, 139, 0.08);
		color: var(--color-text);
	}
	.filter-toggle.active {
		border-color: var(--color-primary, #6366f1);
		color: var(--color-primary, #6366f1);
		background: rgba(99, 102, 241, 0.06);
	}
	.filter-count {
		font-size: 0.6rem;
		background: var(--color-primary, #6366f1);
		color: #fff;
		border-radius: 999px;
		padding: 0 5px;
		min-width: 14px;
		text-align: center;
		line-height: 14px;
		font-weight: 700;
	}

	.filter-panel {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
		flex: 1;
		min-width: 0;
		animation: filter-slide 0.15s ease;
	}

	@keyframes filter-slide {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.filter-section {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-wrap: wrap;
	}

	.filter-label {
		font-size: 0.6rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-muted);
		opacity: 0.6;
		margin-right: 2px;
		flex-shrink: 0;
	}

	.filter-sep {
		width: 1px;
		height: 18px;
		background: var(--color-border);
		flex-shrink: 0;
		margin: 0 2px;
	}

	/* ── Search ──────────────────────────────────────────────────────── */
	.search-section {
		position: relative;
		flex: 0 1 200px;
		min-width: 100px;
	}
	.search-icon {
		position: absolute;
		left: 7px;
		top: 50%;
		transform: translateY(-50%);
		color: var(--color-text-muted);
		opacity: 0.5;
		pointer-events: none;
		display: flex;
		align-items: center;
	}
	.search-input {
		width: 100%;
		padding: 4px 24px 4px 24px;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: transparent;
		color: var(--color-text);
		font-size: 0.7rem;
		font-family: inherit;
		outline: none;
		transition: border-color 0.15s ease;
	}
	.search-input::placeholder {
		color: var(--color-text-muted);
		opacity: 0.5;
	}
	.search-input:focus {
		border-color: var(--color-primary, #6366f1);
	}
	.search-clear {
		position: absolute;
		right: 4px;
		top: 50%;
		transform: translateY(-50%);
		background: none;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
		padding: 2px;
		display: flex;
		align-items: center;
		border-radius: 4px;
	}
	.search-clear:hover {
		color: var(--color-text);
		background: rgba(100, 116, 139, 0.12);
	}

	/* ── Repo select ────────────────────────────────────────────────── */
	.repo-select {
		padding: 3px 6px;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: transparent;
		color: var(--color-text);
		font-size: 0.67rem;
		font-family: inherit;
		outline: none;
		cursor: pointer;
		max-width: 140px;
		transition: border-color 0.15s ease;
	}
	.repo-select:focus {
		border-color: var(--color-primary, #6366f1);
	}

	/* ── Toggle groups ───────────────────────────────────────────────── */
	.toggle-group {
		gap: 3px;
	}

	.role-toggle,
	.priority-toggle,
	.status-toggle {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		padding: 2px 6px;
		border: 1px solid var(--color-border);
		border-radius: 5px;
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		font-size: 0.62rem;
		font-weight: 600;
		transition: all 0.12s ease;
		white-space: nowrap;
	}
	.role-toggle:hover,
	.priority-toggle:hover,
	.status-toggle:hover {
		background: rgba(100, 116, 139, 0.08);
	}

	/* ── Role toggles ───────────────────────────────────────────────── */
	.role-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--role-color);
		flex-shrink: 0;
		opacity: 0.45;
		transition: opacity 0.12s ease;
	}
	.role-toggle.active .role-dot {
		opacity: 1;
		box-shadow: 0 0 4px var(--role-color);
	}
	.role-toggle.active {
		border-color: var(--role-color);
		color: var(--color-text);
		background: color-mix(in srgb, var(--role-color) 8%, transparent);
	}
	.role-text {
		text-transform: capitalize;
	}

	/* ── Priority toggles ───────────────────────────────────────────── */
	.pri-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--pri-color);
		flex-shrink: 0;
		opacity: 0.45;
		transition: opacity 0.12s ease;
	}
	.priority-toggle.active .pri-dot {
		opacity: 1;
		box-shadow: 0 0 4px var(--pri-color);
	}
	.priority-toggle.active {
		border-color: var(--pri-color);
		color: var(--color-text);
		background: color-mix(in srgb, var(--pri-color) 8%, transparent);
	}
	.pri-text {
		text-transform: uppercase;
		font-size: 0.58rem;
		letter-spacing: 0.04em;
	}

	/* ── Status toggles ─────────────────────────────────────────────── */
	.status-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--status-color);
		flex-shrink: 0;
		opacity: 0.45;
		transition: opacity 0.12s ease;
	}
	.status-toggle.active .status-dot {
		opacity: 1;
		box-shadow: 0 0 4px var(--status-color);
	}
	.status-toggle.active {
		border-color: var(--status-color);
		color: var(--color-text);
		background: color-mix(in srgb, var(--status-color) 8%, transparent);
	}
	.status-text {
		font-size: 0.6rem;
	}

	/* ── Clear button ────────────────────────────────────────────────── */
	.clear-btn {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		padding: 3px 8px;
		border: 1px solid rgba(239, 68, 68, 0.25);
		border-radius: 6px;
		background: rgba(239, 68, 68, 0.06);
		color: #ef4444;
		cursor: pointer;
		font-size: 0.62rem;
		font-weight: 700;
		transition: all 0.12s ease;
		white-space: nowrap;
	}
	.clear-btn:hover {
		background: rgba(239, 68, 68, 0.12);
		border-color: rgba(239, 68, 68, 0.4);
	}

	/* ── Collapsed state ────────────────────────────────────────────── */
	.collapsed {
		padding: 4px 16px;
	}
</style>
