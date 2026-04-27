<script lang="ts">
	import type { Memory, Task } from "../lib/stores";
	import { formatDate, getStatusColor, getStatusLabel, getPriorityLabel } from "../lib/utils";
	import Icon from "../lib/Icon.svelte";
	import Markdown from "./Markdown.svelte";
	import { createDetailHandler, STATUS_FLOW } from "../lib/composables/useDetail";

	// ─── Props ───────────────────────────────────────────────────────────────────
	export let memory: Memory | null = null;
	export let task: Task | null = null;
	export let open = false;
	export let onClose: () => void = () => {};
	export let onTaskUpdated: (task: Task) => void = () => {};
	export let onTaskDeleted: (id: string) => void = () => {};

	const handler = createDetailHandler();
	const { mode } = handler;

	// Sync props to composable
	$: if (open) {
		handler.setMemory(memory);
		handler.setTask(task);
	} else {
		handler.reset();
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === "Escape") onClose();
	}
</script>

{#if open && $mode}
	<div
		class="drawer-overlay"
		on:click={onClose}
		on:keydown={handleKeyDown}
		role="button"
		tabindex="0"
		aria-label="Close drawer"
	></div>

	<div
		class="drawer-panel animate-fade-in"
		on:click|stopPropagation
		on:keydown={handleKeyDown}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<!-- ─── HEADER ─────────────────────────────────────────────────────────── -->
		<div class="drawer-header">
			{#if $mode === "memory" && $handler.memory}
				<div>
					<span class="type-chip type-{$handler.memory.type}" style="margin-bottom:8px;display:inline-flex;"
						>{$handler.memory.type}</span
					>
					<div class="drawer-title">{$handler.memory.title || "Untitled Memory"}</div>
				</div>
			{:else if $mode === "task" && $handler.task}
				<div style="flex:1;min-width:0;">
					<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
						<span class="status-chip {getStatusColor($handler.task.status || 'pending')}"
							>{getStatusLabel($handler.task.status || "")}</span
						>
						<span style="font-size:0.7rem;font-weight:700;color:var(--color-text-muted);"
							>{$handler.task.task_code || "NEW-TASK"}</span
						>
					</div>
					{#if $handler.editingTitle}
						<div style="display:flex;gap:6px;align-items:center;">
							<input
								class="form-input"
								bind:value={$handler.editTitle}
								style="font-size:0.95rem;font-weight:700;flex:1;"
								on:keydown={(e) => handler.handleTitleKeydown(e, onTaskUpdated)}
							/>
							<button
								class="btn btn-accent"
								style="padding:4px 10px;font-size:0.75rem;"
								on:click={() => handler.saveTitle(onTaskUpdated)}>Save</button
							>
							<button
								class="btn btn-ghost"
								style="padding:4px 10px;font-size:0.75rem;"
								on:click={() => handler.toggleEditTitle(false)}>✕</button
							>
						</div>
					{:else}
						<button
							class="drawer-title editable-title"
							on:click={() => handler.toggleEditTitle(true)}
							title="Click to edit title"
							style="text-align: left; background: none; border: none; padding: 0; width: 100%; cursor: pointer;"
						>
							{$handler.task?.title ?? ""}
							<span class="edit-hint">✏️</span>
						</button>
					{/if}
				</div>
			{/if}

			<button class="btn btn-ghost btn-icon" on:click={onClose} aria-label="Close" style="flex-shrink:0;">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
					<path d="M18 6 6 18M6 6l12 12" />
				</svg>
			</button>
		</div>

		<!-- ─── BODY ───────────────────────────────────────────────────────────── -->
		<div class="drawer-body">
			<!-- ══ MEMORY MODE ══ -->
			{#if $mode === "memory" && $handler.memory}
				<!-- Meta grid -->
				<div class="meta-grid" style="margin-bottom:16px;">
					{#each [{ label: "Importance", val: $handler.memory?.importance || 0 }, { label: "Hit Count", val: $handler.memory?.hit_count ?? 0 }, { label: "Created", val: formatDate($handler.memory?.created_at) }, { label: "Updated", val: formatDate($handler.memory?.updated_at) }] as m (m.label)}
						<div class="meta-cell">
							<div class="meta-label">{m.label}</div>
							<div class="meta-value">{m.val}</div>
						</div>
					{/each}
				</div>

				<!-- Tags -->
				{#if $handler.memory.tags?.length}
					<div style="margin-bottom:16px;">
						<div class="section-label">Tags</div>
						<div style="display:flex;flex-wrap:wrap;gap:6px;">
							{#each $handler.memory.tags as tag (tag)}
								<span class="tag-chip">{tag}</span>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Content -->
				<div>
					<div class="section-label" style="display:flex; justify-content:space-between; align-items:center;">
						<span>Content</span>
						<button
							class="btn btn-ghost btn-icon"
							on:click={() => handler.handleCopyContent($handler.memory?.content || "")}
							title="Copy to clipboard"
							style="width:20px; height:20px; padding:0; border:none; background:transparent;"
						>
							<Icon
								name={$handler.contentCopied ? "check" : "copy"}
								size={12}
								strokeWidth={2}
								className={$handler.contentCopied ? "text-success" : ""}
							/>
						</button>
					</div>
					<div class="markdown-body md-card">
						<Markdown content={$handler.memory?.content || ""} />
					</div>
				</div>

				<!-- Metadata JSON -->
				{#if $handler.memory.metadata && Object.keys($handler.memory.metadata).length > 0}
					<div style="margin-top:16px;">
						<div class="section-label">Metadata</div>
						<pre class="json-pre">{JSON.stringify($handler.memory.metadata, null, 2)}</pre>
					</div>
				{/if}
			{/if}

			<!-- ══ TASK MODE ══ -->
			{#if $mode === "task" && $handler.task}
				<!-- Status action buttons -->
				{#if STATUS_FLOW[$handler.task.status]?.length}
					<div style="margin-bottom:16px;display:flex;flex-wrap:wrap;gap:8px;">
						{#each STATUS_FLOW[$handler.task.status] as action (action.next)}
							<button
								class="btn"
								style="background:{action.color};color:#fff;border:none;padding:6px 14px;font-size:0.78rem;font-weight:700;border-radius:8px;cursor:pointer;"
								on:click={() => handler.advanceStatus(action.next, onTaskUpdated)}
							>
								{action.label}
							</button>
						{/each}
					</div>
				{/if}

				<!-- Status dropdown -->
				<div style="margin-bottom:16px;">
					<div class="section-label">Status</div>
					<div style="display:flex; justify-content:space-between; align-items:center;">
						<span
							class="status-chip {getStatusColor($handler.task?.status || 'pending')}"
							style="font-size:0.85rem; padding: 4px 10px;">{getStatusLabel($handler.task?.status || "")}</span
						>

						{#if $handler.task?.status !== "completed"}
							<button
								class="btn btn-ghost"
								style="color: #ef4444;"
								on:click={() => handler.deleteTask(onTaskDeleted, onClose)}
							>
								<svg
									style="margin-right:4px;"
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
								>
									<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
									></path>
								</svg>
								Delete Task
							</button>
						{/if}
					</div>
				</div>

				<!-- Meta grid -->
				<div class="meta-grid" style="margin-bottom:16px;">
					{#each [{ label: "Priority", val: getPriorityLabel($handler.task?.priority || 1) }, { label: "Phase", val: $handler.task?.phase || "—" }, { label: "Agent", val: $handler.task?.agent || "—" }, { label: "Updated", val: formatDate($handler.task?.updated_at) }, { label: "Parent", val: $handler.task?.parent_code || "—" }, { label: "Depends On", val: $handler.task?.depends_on_code || "—" }] as m (m.label)}
						<div class="meta-cell">
							<div class="meta-label">{m.label}</div>
							<div class="meta-value">{m.val}</div>
						</div>
					{/each}
				</div>

				{#if $handler.task.coordination && (($handler.task.coordination.active_claim_count || 0) > 0 || ($handler.task.coordination.pending_handoff_count || 0) > 0)}
					<div style="margin-bottom:16px;">
						<div class="section-label">Coordination</div>
						<div class="meta-grid">
							{#if ($handler.task.coordination.active_claim_count || 0) > 0}
								<div class="meta-cell">
									<div class="meta-label">Active Claim</div>
									<div class="meta-value">{$handler.task.coordination.active_claim_agent || "claimed"}</div>
									<div class="meta-subvalue">
										{$handler.task.coordination.active_claim_role || "worker"}
										{#if $handler.task.coordination.active_claim_claimed_at}
											• {formatDate($handler.task.coordination.active_claim_claimed_at)}
										{/if}
									</div>
								</div>
							{/if}
							{#if ($handler.task.coordination.pending_handoff_count || 0) > 0}
								<div class="meta-cell">
									<div class="meta-label">Pending Handoff</div>
									<div class="meta-value">{$handler.task.coordination.pending_handoff_to_agent || "unassigned"}</div>
									<div class="meta-subvalue">
										{$handler.task.coordination.pending_handoff_summary || "Transfer waiting"}
									</div>
								</div>
							{/if}
						</div>
					</div>
				{/if}

				<!-- Description -->
				<div style="margin-bottom:16px;">
					<div class="section-label" style="display:flex;align-items:center;gap:6px;width:100%;">
						<span style="flex:1;">Description</span>
						<button
							class="btn btn-ghost btn-icon"
							on:click={() => handler.handleCopyDesc($handler.task?.description || "")}
							title="Copy to clipboard"
							style="width:20px; height:20px; padding:0; border:none; background:transparent; margin-right:4px;"
						>
							<Icon
								name={$handler.descCopied ? "check" : "copy"}
								size={12}
								strokeWidth={2}
								className={$handler.descCopied ? "text-success" : ""}
							/>
						</button>
						{#if !$handler.editingDescription}
							<button
								class="btn btn-ghost"
								style="padding:1px 6px;font-size:0.68rem;border-radius:4px;"
								on:click={() => handler.toggleEditDescription(true)}>Edit</button
							>
						{/if}
					</div>
					{#if $handler.editingDescription}
						<textarea
							class="form-textarea"
							bind:value={$handler.editDescription}
							rows="8"
							style="font-size:0.82rem;font-family:'JetBrains Mono',monospace;"
						></textarea>
						<div style="display:flex;gap:6px;margin-top:6px;">
							<button
								class="btn btn-accent"
								style="font-size:0.78rem;"
								on:click={() => handler.saveDescription(onTaskUpdated)}>Save</button
							>
							<button
								class="btn btn-ghost"
								style="font-size:0.78rem;"
								on:click={() => handler.toggleEditDescription(false)}>Cancel</button
							>
						</div>
					{:else if $handler.task?.description}
						<div class="markdown-body md-card">
							<Markdown content={$handler.task.description || ""} />
						</div>
					{:else}
						<div style="color:var(--color-text-muted);font-size:0.82rem;font-style:italic;">
							No description yet. Click Edit to add one.
						</div>
					{/if}
				</div>

				<!-- ─── Comments / Activity ─────────────────────────────────────────── -->
				<div>
					<div class="section-label">Activity ({$handler.task?.comments?.length ?? 0})</div>

					<!-- Add comment -->
					<div class="comment-compose" style="margin-bottom:16px;">
						<textarea
							class="form-textarea"
							placeholder="Add a comment or status note…"
							bind:value={$handler.newComment}
							rows="2"
							style="font-size:0.82rem;resize:vertical;"
							on:keydown={(e) => handler.handleCommentKeydown(e, onTaskUpdated)}
						></textarea>
						<div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;">
							<span style="font-size:0.65rem;color:var(--color-text-muted);">Ctrl+Enter to submit</span>
							<button
								class="btn btn-accent"
								style="font-size:0.78rem;"
								disabled={$handler.postingComment || !$handler.newComment.trim()}
								on:click={() => handler.postComment(onTaskUpdated)}
								>{$handler.postingComment ? "Posting…" : "Post Comment"}</button
							>
						</div>
					</div>

					<!-- Comment list -->
					{#if $handler.task?.comments?.length}
						<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;">
							{#each $handler.task.comments as c (c.id)}
								<div class="comment-card">
									<!-- Comment header -->
									<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
										<div style="display:flex;align-items:center;gap:6px;">
											<div class="comment-avatar">{(c.agent || "U").charAt(0).toUpperCase()}</div>
											<span style="font-size:0.72rem;font-weight:600;color:var(--color-text);"
												>{c.agent || "Unknown"}</span
											>
											{#if c.previous_status && c.next_status}
												<span style="font-size:0.65rem;color:var(--color-text-muted);">
													{getStatusLabel(c.previous_status)} → {getStatusLabel(c.next_status)}
												</span>
											{/if}
										</div>
										<div style="display:flex;align-items:center;gap:8px;">
											<span style="font-size:0.65rem;color:var(--color-text-muted);">{formatDate(c.created_at)}</span>
											{#if c.id}
												<button
													class="btn btn-ghost"
													style="padding:1px 5px;font-size:0.65rem;"
													on:click={() => handler.startEditComment(c)}
													title="Edit comment">✏️</button
												>
												<button
													class="btn btn-ghost"
													style="padding:1px 5px;font-size:0.65rem;color:#ef4444;"
													on:click={() => handler.deleteComment(c.id, onTaskUpdated)}
													title="Delete comment">🗑</button
												>
											{/if}
										</div>
									</div>

									<!-- Comment body: edit mode or read mode -->
									{#if $handler.editingCommentId === c.id}
										<textarea
											class="form-textarea"
											bind:value={$handler.editCommentText}
											rows="3"
											style="font-size:0.8rem;margin-bottom:6px;"
										></textarea>
										<div style="display:flex;gap:6px;">
											<button
												class="btn btn-accent"
												style="font-size:0.75rem;"
												disabled={$handler.savingComment}
												on:click={() => handler.saveEditComment(onTaskUpdated)}
												>{$handler.savingComment ? "Saving…" : "Save"}</button
											>
											<button class="btn btn-ghost" style="font-size:0.75rem;" on:click={handler.cancelEditComment}
												>Cancel</button
											>
										</div>
									{:else}
										<div class="markdown-body" style="font-size:0.78rem;color:var(--color-text);line-height:1.5;">
											<Markdown content={c.comment} />
										</div>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.drawer-header {
		padding: 20px;
		border-bottom: 1px solid var(--color-border);
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		flex-shrink: 0;
	}

	.drawer-title {
		font-size: 1rem;
		font-weight: 700;
		color: var(--color-text);
		line-height: 1.3;
	}

	.editable-title {
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 6px;
		border-radius: 6px;
		padding: 2px 4px;
		margin: -2px -4px;
		transition: background 0.15s;
	}

	.editable-title:hover {
		background: rgba(99, 102, 241, 0.07);
	}

	.edit-hint {
		font-size: 0.7rem;
		opacity: 0;
		transition: opacity 0.15s;
	}

	.editable-title:hover .edit-hint {
		opacity: 1;
	}

	.drawer-body {
		padding: 20px;
		flex: 1;
		overflow-y: auto;
	}

	.meta-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}

	.meta-cell {
		padding: 10px;
		background: rgba(241, 245, 249, 0.8);
		border-radius: 10px;
		border: 1px solid var(--color-border);
	}

	:global(.dark) .meta-cell {
		background: rgba(30, 41, 59, 0.8);
	}

	.meta-label {
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
		margin-bottom: 2px;
	}

	.meta-value {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.meta-subvalue {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		margin-top: 4px;
		line-height: 1.35;
	}

	.section-label {
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
		margin-bottom: 8px;
	}

	.tag-chip {
		font-size: 0.72rem;
		background: rgba(99, 102, 241, 0.1);
		color: #6366f1;
		border: 1px solid rgba(99, 102, 241, 0.2);
		padding: 2px 10px;
		border-radius: 9999px;
	}

	.md-card {
		background: rgba(248, 250, 252, 0.8);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		padding: 16px;
	}

	:global(.dark) .md-card {
		background: rgba(15, 23, 42, 0.8);
	}

	.json-pre {
		font-size: 0.75rem;
		background: rgba(248, 250, 252, 0.8);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		padding: 12px;
		overflow-x: auto;
		color: var(--color-text);
		font-family: "JetBrains Mono", monospace;
	}

	:global(.dark) .json-pre {
		background: rgba(15, 23, 42, 0.8);
	}

	.comment-card {
		padding: 10px 14px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: rgba(241, 245, 249, 0.5);
	}

	:global(.dark) .comment-card {
		background: rgba(30, 41, 59, 0.5);
	}

	.comment-avatar {
		width: 20px;
		height: 20px;
		border-radius: 9999px;
		background: linear-gradient(135deg, #6366f1, #0ea5e9);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 9px;
		color: white;
		font-weight: 700;
	}

	.comment-compose {
		padding: 12px;
		background: rgba(241, 245, 249, 0.5);
		border: 1px solid var(--color-border);
		border-radius: 10px;
	}

	:global(.dark) .comment-compose {
		background: rgba(30, 41, 59, 0.4);
	}
</style>
