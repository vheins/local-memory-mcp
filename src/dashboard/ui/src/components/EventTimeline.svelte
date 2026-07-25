<script lang="ts">
	import { createEventDispatcher } from "svelte";
	import Icon from "../lib/Icon.svelte";
	import type { EventLogEntry } from "../lib/arena/arenaEvents";

	export let events: EventLogEntry[] = [];
	export let visible: boolean = true;

	const dispatch = createEventDispatcher();

	let expanded = false;
	let paused = false;
	let activeFilter = "all"; // "all" | "errors" | "tasks" | "agents"
	let eventContainer: HTMLDivElement;

	// Auto-scroll logic
	$: if (expanded && !paused && eventContainer && events) {
		scrollToBottom();
	}

	async function scrollToBottom() {
		// Wait for DOM update
		await new Promise((resolve) => setTimeout(resolve, 0));
		if (eventContainer) {
			eventContainer.scrollTop = eventContainer.scrollHeight;
		}
	}

	function getEventColor(entry: EventLogEntry): string {
		switch (entry.type) {
			case "task-completed":
				return "#22C55E";
			case "task-failed":
				return "#EF4444";
			case "task-blocked":
				return "#F59E0B";
			case "agent-connected":
				return "#10B981";
			case "agent-disconnected":
				return "#6B7280";
			case "memory-created":
			case "memory-updated":
				return "#A855F7";
			case "task-started":
				return "#3B82F6";
			case "task-created":
				return "#06B6D4";
			default:
				return "#64748B";
		}
	}

	function getEventIcon(entry: EventLogEntry): string {
		switch (entry.type) {
			case "task-completed":
				return "circle-check";
			case "task-failed":
				return "circle-x";
			case "task-blocked":
				return "triangle-alert";
			case "task-started":
				return "clock";
			case "task-created":
				return "circle-dot";
			case "task-assigned":
				return "clipboard-list";
			case "agent-connected":
			case "agent-disconnected":
				return "zap";
			case "memory-created":
			case "memory-updated":
				return "brain";
			case "repository-locked":
			case "repository-unlocked":
				return "git-branch";
			default:
				return "activity";
		}
	}

	function getEventLabel(entry: EventLogEntry): string {
		const anyEntry = entry as any;
		if (!anyEntry.event) return entry.detail;
		const ev = anyEntry.event;
		switch (ev.type) {
			case "task-completed":
				return `Task Completed ${ev.taskId} · by ${ev.agentId}`;
			case "task-failed":
				return `Task Failed ${ev.taskId} · by ${ev.agentId}`;
			case "task-blocked":
				return `Task Blocked ${ev.taskId} · ${ev.reason}`;
			case "task-started":
				return `Task Started ${ev.taskId} · by ${ev.agentId}`;
			case "task-created":
				return `Task Created ${ev.taskId} · ${ev.title}`;
			case "task-assigned":
				return `Task Assigned ${ev.taskId} · to ${ev.agentId}`;
			case "task-progressed":
				return `Task Progress ${ev.taskId} · ${Math.round(ev.progress * 100)}%`;
			case "task-unblocked":
				return `Task Unblocked ${ev.taskId}`;
			case "task-retry-scheduled":
				return `Task Retry ${ev.taskId} · attempt ${ev.attempt}/${ev.maxRetries}`;
			case "agent-connected":
				return `Agent Connected ${ev.name} (${ev.role})`;
			case "agent-disconnected":
				return `Agent Disconnected ${ev.agentId}`;
			case "memory-created":
				return `Memory Created · by ${ev.agentId}`;
			case "memory-updated":
				return `Memory Updated · by ${ev.agentId}`;
			case "repository-locked":
				return `Repo Locked ${ev.repositoryId} · file: ${ev.file}`;
			case "repository-unlocked":
				return `Repo Unlocked ${ev.repositoryId}`;
			default:
				return entry.detail;
		}
	}

	function formatTime(timestamp: number): string {
		const d = new Date(timestamp);
		return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
	}

	function toggleExpand() {
		expanded = !expanded;
	}

	function handleEventClick(entry: EventLogEntry) {
		dispatch("eventClick", entry);
	}

	$: filteredEvents = events.filter((e) => {
		if (activeFilter === "all") return true;
		if (activeFilter === "errors") {
			return e.type === "task-failed" || e.type === "task-blocked";
		}
		if (activeFilter === "tasks") {
			return e.type.startsWith("task-");
		}
		if (activeFilter === "agents") {
			return e.type.startsWith("agent-") || e.type.startsWith("memory-");
		}
		return true;
	});
</script>

<div class="event-timeline glass" class:expanded class:visible>
	<!-- Collapsed handle -->
	<button class="timeline-handle" on:click={toggleExpand} aria-expanded={expanded}>
		<div class="handle-left">
			<Icon name="activity" size={14} className="activity-icon" />
			<span class="handle-title">Arena Events</span>
			<span class="event-count-badge">{events.length}</span>
		</div>
		<div class="handle-right">
			<Icon name={expanded ? "chevron-down" : "chevron-up"} size={14} />
		</div>
	</button>

	<!-- Expanded panel -->
	{#if expanded}
		<div class="timeline-body">
			<!-- Filters -->
			<div class="timeline-filters">
				<div class="filter-group">
					<button class="filter-btn" class:active={activeFilter === "all"} on:click={() => (activeFilter = "all")}
						>All</button
					>
					<button class="filter-btn" class:active={activeFilter === "errors"} on:click={() => (activeFilter = "errors")}
						>Errors</button
					>
					<button class="filter-btn" class:active={activeFilter === "tasks"} on:click={() => (activeFilter = "tasks")}
						>Tasks</button
					>
					<button class="filter-btn" class:active={activeFilter === "agents"} on:click={() => (activeFilter = "agents")}
						>Agents</button
					>
				</div>
				<div class="spacer"></div>
				<button
					class="pause-btn"
					class:paused
					on:click={() => (paused = !paused)}
					title={paused ? "Resume Auto-scroll" : "Pause Auto-scroll"}
				>
					{#if paused}
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="12"
							height="12"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg
						>
					{:else}
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="12"
							height="12"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							><rect x="14" y="4" width="4" height="16" rx="1"></rect><rect x="6" y="4" width="4" height="16" rx="1"
							></rect></svg
						>
					{/if}
					<span>{paused ? "Paused" : "Live"}</span>
				</button>
			</div>

			<!-- Event list -->
			<div class="event-list" bind:this={eventContainer}>
				{#if filteredEvents.length === 0}
					<div class="empty-events">No matching events</div>
				{:else}
					{#each filteredEvents as entry (entry.id)}
						<button class="event-row" on:click={() => handleEventClick(entry)}>
							<span class="event-time">{formatTime(entry.timestamp)}</span>
							<span class="event-icon" style="color: {getEventColor(entry)}">
								<Icon name={getEventIcon(entry)} size={11} />
							</span>
							<span class="event-label">{getEventLabel(entry)}</span>
							<span class="event-type-badge" style="background:{getEventColor(entry)}15; color:{getEventColor(entry)}">
								{entry.type}
							</span>
						</button>
					{/each}
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.event-timeline {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		z-index: 40;
		border-top: 1px solid var(--color-border);
		box-shadow: var(--glass-shadow-elevated);
		transform: translateY(100%);
		transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
		display: flex;
		flex-direction: column;
		background: var(--glass-bg-strong);
		border-radius: 0 0 12px 12px; /* round the bottom corners only to match card shape */
	}

	.event-timeline.visible {
		transform: translateY(calc(100% - 36px));
	}

	.event-timeline.expanded {
		transform: translateY(0);
	}

	.timeline-handle {
		height: 36px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 16px;
		background: rgba(255, 255, 255, 0.02);
		border: none;
		border-bottom: 1px solid transparent;
		width: 100%;
		cursor: pointer;
		color: var(--color-text);
		text-align: left;
		font-family: inherit;
		transition: background 0.2s ease;
	}

	.timeline-handle:hover {
		background: rgba(255, 255, 255, 0.05);
	}

	.event-timeline.expanded .timeline-handle {
		border-bottom-color: var(--color-border);
	}

	.handle-left {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	:global(.activity-icon) {
		color: var(--color-primary);
		animation: pulse 2s infinite;
	}

	@keyframes pulse {
		0% {
			opacity: 0.6;
		}
		50% {
			opacity: 1;
		}
		100% {
			opacity: 0.6;
		}
	}

	.handle-title {
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		opacity: 0.9;
	}

	.event-count-badge {
		font-size: 0.65rem;
		font-weight: 800;
		background: var(--color-border);
		color: var(--color-text-muted);
		padding: 1px 6px;
		border-radius: 999px;
	}

	.handle-right {
		display: flex;
		align-items: center;
		opacity: 0.7;
	}

	.timeline-body {
		height: 200px;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.timeline-filters {
		height: 34px;
		display: flex;
		align-items: center;
		padding: 0 12px;
		background: rgba(0, 0, 0, 0.05);
		border-bottom: 1px solid var(--color-border);
		gap: 12px;
	}

	.filter-group {
		display: flex;
		gap: 4px;
	}

	.filter-btn {
		background: transparent;
		border: 1px solid transparent;
		color: var(--color-text-muted);
		font-size: 0.68rem;
		font-weight: 700;
		padding: 2px 8px;
		border-radius: 4px;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.filter-btn:hover {
		color: var(--color-text);
		background: rgba(255, 255, 255, 0.05);
	}

	.filter-btn.active {
		color: var(--color-text);
		background: var(--color-border);
		border-color: rgba(148, 163, 184, 0.2);
	}

	.spacer {
		flex: 1;
	}

	.pause-btn {
		background: transparent;
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
		font-size: 0.65rem;
		font-weight: 700;
		padding: 2px 8px;
		border-radius: 4px;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 5px;
		transition: all 0.15s ease;
	}

	.pause-btn svg {
		opacity: 0.8;
	}

	.pause-btn:hover {
		color: var(--color-text);
		background: rgba(255, 255, 255, 0.05);
	}

	.pause-btn.paused {
		background: rgba(245, 158, 11, 0.1);
		border-color: rgba(245, 158, 11, 0.3);
		color: #f59e0b;
	}

	.event-list {
		flex: 1;
		overflow-y: auto;
		padding: 6px 0;
		display: flex;
		flex-direction: column;
	}

	/* Scrollbar Styling */
	.event-list::-webkit-scrollbar {
		width: 6px;
	}
	.event-list::-webkit-scrollbar-track {
		background: transparent;
	}
	.event-list::-webkit-scrollbar-thumb {
		background: var(--color-border);
		border-radius: 3px;
	}
	.event-list::-webkit-scrollbar-thumb:hover {
		background: var(--color-text-faint);
	}

	.empty-events {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		font-size: 0.72rem;
		color: var(--color-text-muted);
		font-weight: 600;
	}

	.event-row {
		height: 26px;
		min-height: 26px;
		display: flex;
		align-items: center;
		padding: 0 16px;
		border: none;
		background: transparent;
		width: 100%;
		cursor: pointer;
		text-align: left;
		font-family: inherit;
		transition: background 0.15s ease;
		animation: slide-in 0.2s cubic-bezier(0.4, 0, 0.2, 1);
	}

	.event-row:hover {
		background: rgba(255, 255, 255, 0.03);
	}

	.event-time {
		font-family: "JetBrains Mono", monospace;
		font-size: 0.65rem;
		color: var(--color-text-faint);
		min-width: 60px;
		opacity: 0.8;
	}

	.event-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		margin-right: 8px;
		width: 14px;
	}

	.event-label {
		font-size: 0.7rem;
		color: var(--color-text);
		font-weight: 600;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		opacity: 0.95;
	}

	.event-type-badge {
		font-size: 0.58rem;
		font-weight: 800;
		padding: 1px 6px;
		border-radius: 4px;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		margin-left: 8px;
	}

	@keyframes slide-in {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
