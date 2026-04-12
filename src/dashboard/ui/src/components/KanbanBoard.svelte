<script lang="ts">
	import { taskSearch } from "../lib/stores";
	import Icon from "../lib/Icon.svelte";
	import TaskCard from "./TaskCard.svelte";
	import type { Task } from "../lib/stores";
	import { createKanbanHandler, COLUMNS } from "../lib/composables/useKanban";

	export let onTaskClick: (task: Task) => void = () => {};
	export let onAddTask: () => void = () => {};
	export let onBulkImport: () => void = () => {};

	const kanban = createKanbanHandler();
	const kanbanState = { subscribe: kanban.subscribe };

	export function loadTasks(repo: string) {
		kanban.loadTasks(repo, $taskSearch);
	}
</script>

<div>
	<!-- Toolbar -->
	<div class="flex items-center justify-between mb-4">
		<div class="search-wrap">
			<span class="search-icon-inner">
				<Icon name="search" size={13} strokeWidth={2} />
			</span>
			<input
				class="form-input"
				style="padding-left:32px;width:220px;font-size:0.8rem;"
				type="text"
				placeholder="Search tasks…"
				bind:value={$taskSearch}
			/>
		</div>
		<div class="flex gap-2">
			<div class="flex gap-1 mr-1">
				<button class="btn btn-ghost btn-sm" on:click={() => kanban.handleExport("json")} title="Export JSON">
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
						><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line
							x1="12"
							y1="15"
							x2="12"
							y2="3"
						/></svg
					>
					JSON
				</button>
				<button class="btn btn-ghost btn-sm" on:click={() => kanban.handleExport("csv")} title="Export CSV">
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
						><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line
							x1="12"
							y1="15"
							x2="12"
							y2="3"
						/></svg
					>
					CSV
				</button>
			</div>
			<div style="width:1px;height:24px;background:var(--color-border);margin:0 4px;"></div>
			<button class="btn btn-ghost btn-sm" on:click={onBulkImport} title="Bulk Import">
				<Icon name="upload" size={14} strokeWidth={2.5} />
				Import
			</button>
			<button class="btn btn-accent btn-sm" on:click={onAddTask}>
				<Icon name="plus" size={14} strokeWidth={2.5} />
				Add Task
			</button>
		</div>
	</div>

	<!-- Kanban Board -->
	<div class="kanban-board" style="padding-bottom:16px;">
		{#each COLUMNS as col}
			<!-- svelte-ignore a11y-no-static-element-interactions -->
			<div
				class="kanban-col {$kanbanState.dragOverCol === col.status ? 'drag-over' : ''}"
				style="background:{col.bg};border:1px solid {col.border};padding:12px;border-radius:16px;transition: border-color 0.2s;"
				on:dragover={(e) => kanban.handleDragOver(e, col.status)}
				on:dragleave={() => kanban.handleDragLeave(col.status)}
				on:drop={() => kanban.handleDrop(col.status)}
			>
				<!-- Column header -->
				<div class="flex items-center gap-2 mb-3">
					<span style="color:{col.color};display:flex;flex-shrink:0;">
						<Icon name={col.icon} size={13} strokeWidth={2} />
					</span>
					<span style="font-size:0.78rem;font-weight:700;color:var(--color-text);">{col.label}</span>
					<span
						class="col-count"
						style="margin-left:auto;background:{col.bg};color:{col.color};border:1px solid {col.border};"
					>
						{$kanbanState.columnTasks[col.status]?.length || 0}{$kanbanState.pagination[col.status]?.hasMore ? "+" : ""}
					</span>
				</div>

				<!-- Task cards -->
				<div class="flex flex-col" style="gap:8px;overflow-y:auto;max-height:calc(100vh - 340px);padding-right:2px;">
					{#if ($kanbanState.columnTasks[col.status] || []).length === 0}
						{#if $kanbanState.loadingCols.has(col.status)}
							<div class="skeleton" style="height:80px;border-radius:12px;"></div>
							<div class="skeleton" style="height:60px;border-radius:12px;"></div>
						{:else}
							<div class="empty-col">
								<span style="color:{col.color};opacity:0.5;"><Icon name={col.icon} size={22} strokeWidth={1.25} /></span
								>
								<div style="font-size:0.75rem;color:var(--color-text-muted);margin-top:6px;">No tasks</div>
							</div>
						{/if}
					{:else}
						{#each $kanbanState.columnTasks[col.status] as task (task.id)}
							<!-- svelte-ignore a11y-no-static-element-interactions -->
							<div
								draggable="true"
								on:dragstart={(e) => kanban.handleDragStart(e, task, col.status)}
								style="cursor: grab;"
							>
								<TaskCard {task} on:click={() => onTaskClick(task)} />
							</div>
						{/each}

						<!-- Load more -->
						{#if $kanbanState.pagination[col.status]?.hasMore}
							<button
								class="btn btn-ghost btn-sm w-full"
								style="margin-top:4px;justify-content:center;"
								on:click={() => kanban.loadMore(col.status)}
								disabled={$kanbanState.loadingCols.has(col.status)}
							>
								{#if $kanbanState.loadingCols.has(col.status)}
									<span class="animate-spin"><Icon name="refresh-cw" size={12} strokeWidth={2} /></span>
								{:else}
									<Icon name="chevron-down" size={12} strokeWidth={2} />
								{/if}
								{$kanbanState.loadingCols.has(col.status) ? "Loading…" : "Load more"}
							</button>
						{/if}
					{/if}
				</div>
			</div>
		{/each}
	</div>
</div>

<style>
	.search-wrap {
		position: relative;
	}

	.search-icon-inner {
		position: absolute;
		left: 10px;
		top: 50%;
		transform: translateY(-50%);
		color: var(--color-text-muted);
		display: flex;
		pointer-events: none;
	}

	.col-count {
		font-size: 0.65rem;
		font-weight: 700;
		padding: 1px 8px;
		border-radius: 9999px;
	}

	.empty-col {
		text-align: center;
		padding: 28px 8px;
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.drag-over {
		border-color: var(--color-accent) !important;
		background: rgba(99, 102, 241, 0.1) !important;
	}
</style>
