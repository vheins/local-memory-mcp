<script lang="ts">
	import type { Memory } from "../lib/stores";
	import { formatDate } from "../lib/utils";
	import Icon from "../lib/Icon.svelte";
	import Markdown from "./Markdown.svelte";
	import { createMemoryHandler } from "../lib/composables/useMemory";
	import { TYPES, TYPE_LABELS, importanceColor, importanceBg } from "../lib/memoryConfig";

	// ─── Props ───────────────────────────────────────────────────────────────
	/** null = create mode, Memory = edit/view mode */
	export let memory: Memory | null = null;
	export let open = false;
	export let onClose: () => void = () => {};
	export let onSaved: (mem: Memory) => void = () => {};
	export let onDeleted: (id: string) => void = () => {};

	// ─── Logic ───────────────────────────────────────────────────────────────
	const logic = createMemoryHandler({ onSaved, onDeleted, onClose });
	const { form, editing, saving, deleting, error, previewMode } = logic;

	$: isCreate = memory === null;
	$: isEditing = isCreate || $editing;

	// Reset form whenever the modal opens / memory changes
	$: if (open) logic.reset(memory);

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === "Escape") onClose();
	}
</script>

<svelte:window on:keydown={handleKeyDown} />

{#if open}
	<!-- Backdrop -->
	<div
		class="modal-backdrop"
		role="button"
		tabindex="-1"
		aria-label="Close"
		on:click={onClose}
		on:keydown={(e) => e.key === "Escape" && onClose()}
	></div>

	<!-- Modal panel -->
	<div class="modal-panel animate-fade-in" role="dialog" aria-modal="true" tabindex="-1">
		<!-- ── HEADER ─────────────────────────────────────────────────────── -->
		<div class="modal-header">
			<div class="modal-header-icon">
				<Icon name="brain" size={14} strokeWidth={2.2} />
			</div>
			<div style="flex:1;min-width:0;">
				{#if isEditing}
					<div class="modal-mode-label">{isCreate ? "New Memory" : "Edit Memory"}</div>
					<input class="form-input modal-title-input" placeholder="Memory title…" bind:value={$form.title} />
				{:else if memory}
					<div class="modal-mode-label">View Memory</div>
					<div class="modal-title-text">{memory.title}</div>
				{/if}
			</div>

			<div class="modal-header-actions">
				{#if memory && !$editing}
					<button class="btn btn-ghost btn-sm" on:click={logic.startEditing} title="Edit memory">
						<Icon name="edit" size={13} strokeWidth={2} />
						Edit
					</button>
					<button
						class="btn btn-ghost btn-sm danger-btn"
						disabled={$deleting}
						on:click={logic.deleteMemory}
						title="Delete memory"
					>
						<Icon name="trash-2" size={13} strokeWidth={2} />
						{$deleting ? "Deleting…" : "Delete"}
					</button>
				{/if}
				<button class="modal-close-btn" on:click={onClose} aria-label="Close">
					<Icon name="x" size={14} strokeWidth={2.5} />
				</button>
			</div>
		</div>

		<!-- ── BODY ───────────────────────────────────────────────────────── -->
		<div class="modal-body">
			<!-- Error banner -->
			{#if $error}
				<div class="mem-error">
					<Icon name="circle-alert" size={13} strokeWidth={2} />
					{$error}
				</div>
			{/if}

			<!-- ══ VIEW MODE ══ -->
			{#if memory && !$editing}
				<!-- Type chip -->
				<div style="margin-bottom:14px;">
					<span class="type-chip type-{memory.type}">{TYPE_LABELS[memory.type] || memory.type}</span>
				</div>

				<!-- Meta grid -->
				<div class="meta-grid">
					{#each [{ label: "Importance", val: memory.importance }, { label: "Hit Count", val: memory.hit_count ?? 0 }, { label: "Created", val: formatDate(memory.created_at) }, { label: "Updated", val: formatDate(memory.updated_at) }] as m (m.label)}
						<div class="meta-cell">
							<div class="meta-label">{m.label}</div>
							<div class="meta-value">{m.val}</div>
						</div>
					{/each}
				</div>

				<!-- Tags -->
				{#if memory.tags?.length}
					<div class="section-block">
						<div class="field-label">Tags</div>
						<div class="tags-row">
							{#each memory.tags as tag (tag)}
								<span class="tag-chip">{tag}</span>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Content -->
				<div class="section-block">
					<div class="field-label">Content</div>
					<div class="markdown-body md-card">
						<Markdown content={memory.content} />
					</div>
				</div>

				<!-- Metadata JSON -->
				{#if memory.metadata && Object.keys(memory.metadata).length > 0}
					<div class="section-block">
						<div class="field-label">Metadata</div>
						<pre class="json-pre">{JSON.stringify(memory.metadata, null, 2)}</pre>
					</div>
				{/if}

				<!-- ══ CREATE / EDIT MODE ══ -->
			{:else}
				<!-- Type + Importance -->
				<div class="field-grid-2">
					<div class="field-group">
						<label for="mem_type" class="field-label">Type <span class="required">*</span></label>
						<select id="mem_type" class="form-select" bind:value={$form.type}>
							{#each TYPES as t (t)}
								<option value={t}>{TYPE_LABELS[t]}</option>
							{/each}
						</select>
					</div>
					<div class="field-group">
						<label for="mem_importance" class="field-label">
							Importance
							<span
								class="importance-badge"
								style="background:{importanceBg[$form.importance]};color:{importanceColor[$form.importance]};"
								>{$form.importance}</span
							>
						</label>
						<input
							id="mem_importance"
							type="range"
							min="1"
							max="5"
							step="1"
							bind:value={$form.importance}
							class="importance-slider"
							style="accent-color:{importanceColor[$form.importance]};"
						/>
						<div class="importance-ticks">
							{#each [1, 2, 3, 4, 5] as n (n)}
								<span class:active={$form.importance >= n}>{n}</span>
							{/each}
						</div>
					</div>
				</div>

				<!-- Tags -->
				<div class="field-group">
					<label for="mem_tags" class="field-label">
						Tags <span class="field-hint">(comma separated)</span>
					</label>
					<input
						id="mem_tags"
						class="form-input"
						placeholder="react, typescript, architecture…"
						bind:value={$form.tags}
					/>
				</div>

				<!-- Agent + Model -->
				<div class="field-grid-2">
					<div class="field-group">
						<label for="mem_agent" class="field-label">Agent</label>
						<input id="mem_agent" class="form-input" placeholder="e.g. claude-opus" bind:value={$form.agent} />
					</div>
					<div class="field-group">
						<label for="mem_model" class="field-label">Model</label>
						<input id="mem_model" class="form-input" placeholder="e.g. claude-3-opus" bind:value={$form.model} />
					</div>
				</div>

				<!-- Content editor -->
				<div class="field-group">
					<div class="content-label-row">
						<label for="mem_content" class="field-label" style="margin-bottom:0;">
							Content <span class="required">*</span>
							<span class="field-hint">(Markdown supported)</span>
						</label>
						<button type="button" class="btn btn-ghost btn-sm preview-btn" on:click={logic.togglePreview}>
							<Icon name={$previewMode ? "edit" : "eye"} size={12} strokeWidth={2} />
							{$previewMode ? "Edit" : "Preview"}
						</button>
					</div>
					{#if $previewMode}
						<div class="markdown-body md-card" style="min-height:160px;">
							{#if $form.content.trim()}
								<Markdown content={$form.content} />
							{:else}
								<span style="color:var(--color-text-muted);font-style:italic;">Nothing to preview yet…</span>
							{/if}
						</div>
					{:else}
						<textarea
							id="mem_content"
							class="form-textarea content-textarea"
							rows="8"
							placeholder="Write memory content in Markdown…"
							bind:value={$form.content}
						></textarea>
					{/if}
				</div>
			{/if}
		</div>

		<!-- ── FOOTER (create/edit mode) ──────────────────────────────────── -->
		{#if isEditing}
			<div class="modal-footer">
				<button class="btn btn-ghost" on:click={logic.cancelEdit}>Cancel</button>
				<button
					class="btn btn-primary modal-save-btn"
					disabled={$saving || !$form.title.trim() || !$form.content.trim()}
					on:click={logic.save}
				>
					<Icon name={$saving ? "loader" : "save"} size={13} strokeWidth={2} />
					{$saving ? "Saving…" : isCreate ? "Create Memory" : "Save Changes"}
				</button>
			</div>
		{/if}
	</div>
{/if}

<style>
	/* ── Backdrop ── */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 58;
		background: rgba(1, 12, 30, 0.45);
		backdrop-filter: blur(4px);
		-webkit-backdrop-filter: blur(4px);
	}

	/* ── Panel ── */
	.modal-panel {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		z-index: 59;
		width: 600px;
		max-width: 96vw;
		max-height: 92vh;
		overflow-y: auto;
		border-radius: 20px;
		background: var(--color-surface, #fff);
		border: 1px solid var(--color-border);
		box-shadow:
			0 32px 96px rgba(1, 12, 30, 0.2),
			0 8px 32px rgba(1, 12, 30, 0.12),
			inset 0 1px 0 rgba(255, 255, 255, 0.7);
		display: flex;
		flex-direction: column;
	}

	:global(html.dark) .modal-panel {
		background: #070f1f;
		border-color: rgba(148, 163, 184, 0.12);
		box-shadow:
			0 32px 96px rgba(0, 0, 0, 0.6),
			0 8px 32px rgba(0, 0, 0, 0.4),
			inset 0 1px 0 rgba(255, 255, 255, 0.04);
	}

	/* ── Header ── */
	.modal-header {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 18px 20px 16px;
		border-bottom: 1px solid var(--color-border);
		flex-shrink: 0;
	}

	.modal-header-icon {
		width: 34px;
		height: 34px;
		border-radius: 10px;
		background: linear-gradient(135deg, #6366f1, #a855f7);
		display: flex;
		align-items: center;
		justify-content: center;
		color: white;
		flex-shrink: 0;
		box-shadow: 0 4px 12px rgba(99, 102, 241, 0.35);
	}

	.modal-mode-label {
		font-size: 0.62rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--color-text-muted);
		margin-bottom: 4px;
	}

	.modal-title-input {
		font-size: 0.92rem;
		font-weight: 700;
		padding: 5px 10px;
		width: 100%;
	}

	.modal-title-text {
		font-size: 0.95rem;
		font-weight: 700;
		color: var(--color-text);
		line-height: 1.3;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.modal-header-actions {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
		margin-left: auto;
	}

	.danger-btn {
		color: #ef4444 !important;
	}

	.modal-close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: 8px;
		border: none;
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		transition:
			background 0.15s ease,
			color 0.15s ease;
		flex-shrink: 0;
	}

	.modal-close-btn:hover {
		background: rgba(239, 68, 68, 0.1);
		color: #ef4444;
	}

	/* ── Body ── */
	.modal-body {
		padding: 18px 20px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		flex: 1;
		overflow-y: auto;
	}

	/* ── Fields ── */
	.field-grid-2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}

	.field-group {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}

	.field-label {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-muted);
	}

	.required {
		color: #ef4444;
		font-size: 0.7rem;
	}

	.field-hint {
		margin-left: 2px;
		font-size: 0.62rem;
		font-weight: 400;
		text-transform: none;
		letter-spacing: 0;
		font-style: italic;
		color: var(--color-text-faint);
	}

	/* ── Importance ── */
	.importance-badge {
		font-size: 0.72rem;
		font-weight: 800;
		padding: 1px 7px;
		border-radius: 9999px;
		margin-left: 4px;
	}

	.importance-slider {
		width: 100%;
		height: 4px;
		border-radius: 9999px;
		cursor: pointer;
		outline: none;
		border: none;
		background: transparent;
		padding: 0;
		margin-top: 4px;
	}

	.importance-ticks {
		display: flex;
		justify-content: space-between;
		font-size: 0.6rem;
		color: var(--color-text-muted);
		margin-top: 2px;
		padding: 0 2px;
	}

	.importance-ticks span {
		font-weight: 600;
		transition: color 0.2s;
	}

	.importance-ticks span.active {
		color: var(--color-text);
	}

	/* ── Content field ── */
	.content-label-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 2px;
	}

	.preview-btn {
		font-size: 0.65rem;
		padding: 3px 8px;
	}

	.content-textarea {
		font-family: "JetBrains Mono", monospace;
		font-size: 0.82rem;
		resize: vertical;
		min-height: 140px;
		line-height: 1.6;
	}

	/* ── View mode ── */
	.meta-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}

	.meta-cell {
		padding: 10px 12px;
		background: rgba(241, 245, 249, 0.8);
		border-radius: 10px;
		border: 1px solid var(--color-border);
	}

	:global(html.dark) .meta-cell {
		background: rgba(30, 41, 59, 0.8);
	}

	.meta-label {
		font-size: 0.62rem;
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

	.section-block {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.tags-row {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.tag-chip {
		font-size: 0.72rem;
		background: rgba(99, 102, 241, 0.1);
		color: #6366f1;
		border: 1px solid rgba(99, 102, 241, 0.2);
		padding: 2px 10px;
		border-radius: 9999px;
	}

	:global(html.dark) .tag-chip {
		background: rgba(99, 102, 241, 0.18);
		color: #a5b4fc;
		border-color: rgba(99, 102, 241, 0.3);
	}

	.md-card {
		background: rgba(248, 250, 252, 0.8);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		padding: 16px;
	}

	:global(html.dark) .md-card {
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

	:global(html.dark) .json-pre {
		background: rgba(15, 23, 42, 0.8);
	}

	/* ── Error ── */
	.mem-error {
		display: flex;
		align-items: center;
		gap: 8px;
		background: rgba(239, 68, 68, 0.08);
		border: 1px solid rgba(239, 68, 68, 0.22);
		border-radius: 10px;
		color: #ef4444;
		font-size: 0.8rem;
		padding: 10px 14px;
	}

	/* ── Footer ── */
	.modal-footer {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
		padding: 14px 20px;
		border-top: 1px solid var(--color-border);
		flex-shrink: 0;
	}

	.modal-save-btn:disabled {
		opacity: 0.45;
		pointer-events: none;
	}
</style>
