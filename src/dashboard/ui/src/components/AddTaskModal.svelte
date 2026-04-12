<script lang="ts">
	import { getStatusLabel, getPriorityLabel } from "../lib/utils";
	import Icon from "../lib/Icon.svelte";
	import type { Task } from "../lib/stores";

	export let open = false;
	export let newTask: Partial<Task>;
	export let onClose: () => void = () => {};
	export let onSave: () => void = () => {};
</script>

{#if open}
	<div
		class="drawer-overlay"
		style="display:flex;align-items:center;justify-content:center;z-index:60;"
		on:click={onClose}
		on:keydown={(e) => e.key === "Escape" && onClose()}
		role="button"
		tabindex="0"
		aria-label="Close modal"
	>
		<div
			class="glass card animate-fade-in"
			style="width:500px;max-width:95vw;border:1px solid var(--color-border);"
			on:click|stopPropagation
			on:keydown|stopPropagation
			role="dialog"
			aria-modal="true"
			tabindex="-1"
		>
			<div class="flex items-center gap-2" style="margin-bottom:16px;">
				<Icon name="plus" size={16} strokeWidth={2} />
				<span style="font-size:0.9rem;font-weight:700;color:var(--color-text);">New Task</span>
			</div>
			<div style="display:flex;flex-direction:column;gap:10px;">
				<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
					<div>
						<label
							for="new_task_code"
							style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-muted);display:block;margin-bottom:4px;"
							>Task Code *</label
						>
						<input id="new_task_code" class="form-input" bind:value={newTask.task_code} placeholder="TASK-001" />
					</div>
					<div>
						<label
							for="new_task_phase"
							style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-muted);display:block;margin-bottom:4px;"
							>Phase</label
						>
						<input id="new_task_phase" class="form-input" bind:value={newTask.phase} placeholder="Implementation" />
					</div>
				</div>
				<div>
					<label
						for="new_task_title"
						style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-muted);display:block;margin-bottom:4px;"
						>Title *</label
					>
					<input id="new_task_title" class="form-input" bind:value={newTask.title} placeholder="Task title" />
				</div>
				<div>
					<label
						for="new_task_description"
						style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-muted);display:block;margin-bottom:4px;"
						>Description</label
					>
					<textarea
						id="new_task_description"
						class="form-textarea"
						bind:value={newTask.description}
						placeholder="Task description..."
						rows="4"
					></textarea>
				</div>
				<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
					<div>
						<label
							for="new_task_status"
							style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-muted);display:block;margin-bottom:4px;"
							>Status</label
						>
						<select id="new_task_status" class="form-select" bind:value={newTask.status}>
							{#each ["backlog", "pending", "in_progress"] as s}
								<option value={s}>{getStatusLabel(s)}</option>
							{/each}
						</select>
					</div>
					<div>
						<label
							for="new_task_priority"
							style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-muted);display:block;margin-bottom:4px;"
							>Priority</label
						>
						<select id="new_task_priority" class="form-select" bind:value={newTask.priority}>
							{#each [1, 2, 3, 4, 5] as p}
								<option value={p}>{getPriorityLabel(p)}</option>
							{/each}
						</select>
					</div>
				</div>
			</div>
			<div class="flex justify-between" style="margin-top:16px;">
				<button class="btn btn-ghost" on:click={onClose}>Cancel</button>
				<button class="btn btn-accent" on:click={onSave}>Create Task</button>
			</div>
		</div>
	</div>
{/if}
