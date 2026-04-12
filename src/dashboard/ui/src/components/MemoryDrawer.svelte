<script lang="ts">
	import type { Memory } from "../lib/stores";
	import { formatDate, renderMarkdown } from "../lib/utils";
	import Icon from "../lib/Icon.svelte";
	import { createMemoryHandler } from "../lib/composables/useMemory";
	import { TYPES, TYPE_LABELS, importanceColor, importanceBg } from "../lib/memoryConfig";

	// ─── Props ───────────────────────────────────────────────────────────────
	/** null  = create mode, Memory = edit/view mode */
	export let memory: Memory | null = null;
	export let open = false;
	export let onClose: () => void = () => {};
	export let onSaved: (mem: Memory) => void = () => {};
	export let onDeleted: (id: string) => void = () => {};

	// ─── Composable Logic ────────────────────────────────────────────────────
	const logic = createMemoryHandler({ onSaved, onDeleted, onClose });
	const { form, editing, saving, deleting, error, previewMode } = logic;

	// Reactivity
	$: isCreate = memory === null;

	// Reset logic state when drawer opens or memory change
	$: if (open || memory !== undefined) {
		if (open) logic.reset(memory);
	}
</script>

{#if open}
	<!-- Backdrop -->
	<!-- svelte-ignore a11y-click-events-have-key-events tabindex-no-interactive-non-semantic-element -->
	<div class="drawer-overlay" on:click={onClose} role="button" tabindex="0"></div>

	<!-- Slide-over panel -->
	<!-- svelte-ignore a11y-click-events-have-key-events -->
	<div class="drawer-panel animate-fade-in" on:click|stopPropagation role="dialog" aria-modal="true" tabindex="-1">
		<!-- ── HEADER ───────────────────────────────────────────────────── -->
		<div class="mem-header">
			<div style="flex:1;min-width:0;">
				{#if isCreate || $editing}
					<div
						style="font-size:0.62rem;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:var(--color-text-muted);margin-bottom:6px;"
					>
						{isCreate ? "✦ New Memory" : "✏️ Edit Memory"}
					</div>
					<input class="form-input mem-title-input" placeholder="Memory title…" bind:value={$form.title} />
				{:else if memory}
					<span class="type-chip type-{memory.type}" style="margin-bottom:8px;display:inline-flex;"
						>{TYPE_LABELS[memory.type] || memory.type}</span
					>
					<div class="drawer-title">{memory.title}</div>
				{/if}
			</div>
			<div class="mem-header-actions">
				{#if memory && !$editing}
					<button class="btn btn-ghost btn-sm" on:click={logic.startEditing} title="Edit memory" aria-label="Edit">
						<Icon name="edit" size={14} strokeWidth={2} />
						<span>Edit</span>
					</button>
					<button
						class="btn btn-ghost btn-sm"
						style="color:#ef4444;"
						disabled={$deleting}
						on:click={logic.deleteMemory}
						title="Delete memory"
						aria-label="Delete"
					>
						<Icon name="trash-2" size={14} strokeWidth={2} />
						<span>{$deleting ? "Deleting…" : "Delete"}</span>
					</button>
				{/if}
				<button class="btn btn-ghost btn-icon" on:click={onClose} aria-label="Close">
					<Icon name="x" size={18} strokeWidth={2.5} />
				</button>
			</div>
		</div>

		<!-- ── BODY ─────────────────────────────────────────────────────── -->
		<div class="drawer-body">
			{#if $error}
				<div class="mem-error">{$error}</div>
			{/if}

			<!-- ══ VIEW MODE ══ -->
			{#if memory && !$editing}
				<!-- Meta grid -->
				<div class="meta-grid" style="margin-bottom:16px;">
					{#each [{ label: "Importance", val: memory.importance }, { label: "Hit Count", val: memory.hit_count ?? 0 }, { label: "Created", val: formatDate(memory.created_at) }, { label: "Updated", val: formatDate(memory.updated_at) }] as m}
						<div class="meta-cell">
							<div class="meta-label">{m.label}</div>
							<div class="meta-value">{m.val}</div>
						</div>
					{/each}
				</div>

				<!-- Tags -->
				{#if memory.tags?.length}
					<div style="margin-bottom:16px;">
						<div class="section-label">Tags</div>
						<div style="display:flex;flex-wrap:wrap;gap:6px;">
							{#each memory.tags as tag}
								<span class="tag-chip">{tag}</span>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Content -->
				<div>
					<div class="section-label">Content</div>
					<div class="markdown-body md-card">{@html renderMarkdown(memory.content)}</div>
				</div>

				<!-- Metadata -->
				{#if (memory as any).metadata && Object.keys((memory as any).metadata).length > 0}
					<div style="margin-top:16px;">
						<div class="section-label">Metadata</div>
						<pre class="json-pre">{JSON.stringify((memory as any).metadata, null, 2)}</pre>
					</div>
				{/if}

				<!-- ══ CREATE / EDIT MODE ══ -->
			{:else}
				<div class="mem-form">
					<!-- Type + Importance row -->
					<div class="form-row-2">
						<div>
							<label for="mem_type" class="form-label">Type *</label>
							<select id="mem_type" class="form-select" bind:value={$form.type}>
								{#each TYPES as t}
									<option value={t}>{TYPE_LABELS[t]}</option>
								{/each}
							</select>
						</div>
						<div>
							<label for="mem_importance" class="form-label">
								Importance
								<span
									class="importance-badge"
									style="background:{importanceBg[$form.importance]};color:{importanceColor[$form.importance]};"
								>
									{$form.importance}
								</span>
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
								{#each [1, 2, 3, 4, 5] as n}
									<span class:active={$form.importance >= n}>{n}</span>
								{/each}
							</div>
						</div>
					</div>

					<!-- Tags -->
					<div>
						<label for="mem_tags" class="form-label"
							>Tags <span style="font-weight:400;font-style:italic;">(comma separated)</span></label
						>
						<input
							id="mem_tags"
							class="form-input"
							placeholder="react, typescript, architecture…"
							bind:value={$form.tags}
						/>
					</div>

					<!-- Agent + Model -->
					<div class="form-row-2">
						<div>
							<label for="mem_agent" class="form-label">Agent</label>
							<input id="mem_agent" class="form-input" placeholder="e.g. claude-opus" bind:value={$form.agent} />
						</div>
						<div>
							<label for="mem_model" class="form-label">Model</label>
							<input id="mem_model" class="form-input" placeholder="e.g. claude-3-opus" bind:value={$form.model} />
						</div>
					</div>

					<!-- Content editor -->
					<div>
						<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
							<label for="mem_content" class="form-label" style="margin-bottom:0;"
								>Content * <span style="font-weight:400;color:var(--color-text-muted);">(Markdown supported)</span
								></label
							>
							<button type="button" class="btn btn-ghost btn-sm" on:click={logic.togglePreview}>
								<Icon name={$previewMode ? "edit" : "eye"} size={12} strokeWidth={2} />
								{$previewMode ? "Edit" : "Preview"}
							</button>
						</div>
						{#if $previewMode}
							<div class="markdown-body md-card" style="min-height:200px;">
								{#if $form.content.trim()}
									{@html renderMarkdown($form.content)}
								{:else}
									<span style="color:var(--color-text-muted);font-style:italic;">Nothing to preview yet…</span>
								{/if}
							</div>
						{:else}
							<textarea
								id="mem_content"
								class="form-textarea"
								rows="10"
								style="font-family:'JetBrains Mono',monospace;font-size:0.82rem;resize:vertical;"
								placeholder="Write memory content in Markdown…"
								bind:value={$form.content}
							></textarea>
						{/if}
					</div>
				</div>
			{/if}
		</div>

		<!-- ── FOOTER (edit/create mode only) ────────────────────────── -->
		{#if isCreate || $editing}
			<div class="mem-footer">
				<button class="btn btn-ghost" on:click={logic.cancelEdit}> Cancel </button>
				<button class="btn btn-accent" disabled={$saving} on:click={logic.save}>
					<Icon name={$saving ? "loader" : "save"} size={14} strokeWidth={2} />
					{$saving ? "Saving…" : isCreate ? "Create Memory" : "Save Changes"}
				</button>
			</div>
		{/if}
	</div>
{/if}

<style>
	.mem-header {
		padding: 20px;
		border-bottom: 1px solid var(--color-border);
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		flex-shrink: 0;
	}

	.mem-header-actions {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
	}

	.mem-title-input {
		font-size: 0.95rem;
		font-weight: 700;
		padding: 6px 10px;
	}

	.mem-error {
		background: rgba(239, 68, 68, 0.08);
		border: 1px solid rgba(239, 68, 68, 0.22);
		border-radius: 10px;
		color: #ef4444;
		font-size: 0.8rem;
		padding: 10px 14px;
		margin-bottom: 14px;
	}

	.mem-form {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.form-row-2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}

	.form-label {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
		margin-bottom: 5px;
	}

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

	.mem-footer {
		padding: 14px 20px;
		border-top: 1px solid var(--color-border);
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		flex-shrink: 0;
		background: rgba(248, 250, 252, 0.6);
		backdrop-filter: blur(8px);
	}

	:global(html.dark) .mem-footer {
		background: rgba(5, 12, 25, 0.6);
	}

	/* Shared with DetailDrawer */
	.drawer-title {
		font-size: 1rem;
		font-weight: 700;
		color: var(--color-text);
		line-height: 1.3;
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

	:global(html.dark) .meta-cell {
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
</style>
