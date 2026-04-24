<script lang="ts">
	import { onMount } from "svelte";
	import { api } from "../lib/api";
	import Icon from "../lib/Icon.svelte";
	import Markdown from "./Markdown.svelte";
	import { formatDate } from "../lib/utils";
	import type { CodingStandard } from "../lib/interfaces";

	export let repo = "";

	let standards: CodingStandard[] = [];
	let standardTree: StandardTreeNode[] = [];
	let loading = false;
	let detailLoading = false;
	let saving = false;
	let deleting = false;
	let error = "";
	let query = "";
	let language = "";
	let stack = "";
	let scope: "repo" | "global" | "all" = "repo";
	let selected: CodingStandard | null = null;
	let showCreate = false;
	let editMode = false;

	let form = {
		name: "",
		parent_id: "",
		context: "general",
		version: "1.0.0",
		language: "",
		stack: "",
		tags: "",
		metadata: '{"source":"dashboard"}',
		content: ""
	};

	let editForm = {
		name: "",
		parent_id: "",
		context: "general",
		version: "1.0.0",
		language: "",
		stack: "",
		tags: "",
		metadata: '{"source":"dashboard"}',
		content: ""
	};

	function parseMetadata(value: string): Record<string, unknown> | null {
		try {
			const parsed = JSON.parse(value) as Record<string, unknown>;
			return parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.keys(parsed).length > 0 ? parsed : null;
		} catch {
			return null;
		}
	}

	$: if (repo) {
		void loadStandards();
	}

	function splitList(value: string) {
		return value
			.split(",")
			.map((item) => item.trim())
			.filter(Boolean);
	}

	function stringifyMetadata(value: Record<string, unknown>) {
		return JSON.stringify(value, null, 2);
	}

	type StandardTreeNode = {
		standard: CodingStandard;
		children: CodingStandard[];
	};

	function buildStandardTree(items: CodingStandard[]): StandardTreeNode[] {
		const byParent = new Map<string, CodingStandard[]>();
		const byId = new Set(items.map((item) => item.id));

		for (const item of items) {
			const parentId = item.parent_id;
			if (!parentId || !byId.has(parentId)) continue;
			const siblings = byParent.get(parentId) || [];
			siblings.push(item);
			byParent.set(parentId, siblings);
		}

		const roots = items.filter((item) => !item.parent_id || !byId.has(item.parent_id));
		return roots.map((root) => ({
			standard: root,
			children: (byParent.get(root.id) || []).sort((a, b) => a.title.localeCompare(b.title))
		}));
	}

	$: standardTree = buildStandardTree(standards);

	async function loadStandardDetail(id: string) {
		detailLoading = true;
		editMode = false;
		try {
			const detail = await api.standardById(id);
			selected = detail;
			if (detail) {
				editForm = {
					name: detail.title,
					parent_id: detail.parent_id || "",
					context: detail.context,
					version: detail.version,
					language: detail.language || "",
					stack: detail.stack.join(", "),
					tags: detail.tags.join(", "),
					metadata: stringifyMetadata(detail.metadata),
					content: detail.content
				};
			}
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			detailLoading = false;
		}
	}

	function startEdit() {
		if (!selected) return;
		editForm = {
			name: selected.title,
			parent_id: selected.parent_id || "",
			context: selected.context,
			version: selected.version,
			language: selected.language || "",
			stack: selected.stack.join(", "),
			tags: selected.tags.join(", "),
			metadata: stringifyMetadata(selected.metadata),
			content: selected.content
		};
		editMode = true;
	}

	function cancelEdit() {
		editMode = false;
	}

	async function loadStandards() {
		if (!repo) return;
		loading = true;
		error = "";
		try {
			const result = await api.standards({
				query: query || undefined,
				language: language || undefined,
				stack: stack || undefined,
				repo: scope === "repo" ? repo : undefined,
				is_global: scope === "global" ? true : undefined,
				page: 1,
				pageSize: 100
			});
			standards = result.standards || [];
			if (!selected || !standards.some((item) => item.id === selected?.id)) {
				selected = standards[0] || null;
			}
			if (selected?.id) {
				await loadStandardDetail(selected.id);
			}
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	async function saveStandard() {
		const metadata = parseMetadata(form.metadata);
		if (!form.name.trim() || !form.content.trim() || splitList(form.tags).length === 0 || !metadata) return;
		saving = true;
		error = "";
		try {
			const isGlobal = scope === "global";
			const result = await api.createStandard({
				title: form.name.trim(),
				content: form.content.trim(),
				parent_id: form.parent_id.trim() || undefined,
				context: form.context.trim() || "general",
				version: form.version.trim() || "1.0.0",
				language: form.language.trim() || undefined,
				stack: splitList(form.stack),
				tags: splitList(form.tags),
				metadata,
				repo: isGlobal ? undefined : repo,
				is_global: isGlobal
			});
			form = {
				name: "",
				parent_id: "",
				context: "general",
				version: "1.0.0",
				language: "",
				stack: "",
				tags: "",
				metadata: '{"source":"dashboard"}',
				content: ""
			};
			showCreate = false;
			await loadStandards();
			selected = result || selected;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			saving = false;
		}
	}

	async function updateStandard() {
		if (!selected) return;
		const metadata = parseMetadata(editForm.metadata);
		if (!editForm.name.trim() || !editForm.content.trim() || splitList(editForm.tags).length === 0 || !metadata) return;
		saving = true;
		error = "";
		try {
			await api.updateStandard(selected.id, {
				title: editForm.name.trim(),
				content: editForm.content.trim(),
				parent_id: editForm.parent_id.trim() || null,
				context: editForm.context.trim() || "general",
				version: editForm.version.trim() || "1.0.0",
				language: editForm.language.trim() || undefined,
				stack: splitList(editForm.stack),
				tags: splitList(editForm.tags),
				metadata,
				repo: selected.is_global ? undefined : selected.repo || repo,
				is_global: selected.is_global
			});
			editMode = false;
			await loadStandardDetail(selected.id);
			await loadStandards();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			saving = false;
		}
	}

	async function deleteStandard() {
		if (!selected) return;
		if (!confirm(`Delete coding standard "${selected.title}"?`)) return;
		deleting = true;
		error = "";
		try {
			await api.deleteStandard(selected.id);
			editMode = false;
			selected = null;
			await loadStandards();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			deleting = false;
		}
	}

	onMount(() => {
		void loadStandards();
	});
</script>

<div class="feature-shell animate-fade-in">
	<div class="feature-toolbar glass card">
		<div class="toolbar-title">
			<Icon name="check" size={16} strokeWidth={2} />
			<div>
				<div class="section-label">Coding Standards</div>
				<div class="toolbar-subtitle">{standards.length} matching standards</div>
			</div>
		</div>
		<button class="btn btn-primary toolbar-action" on:click={() => (showCreate = !showCreate)}>
			<Icon name={showCreate ? "chevron-left" : "plus"} size={14} strokeWidth={2} />
			{showCreate ? "Close Form" : "New Standard"}
		</button>
		<div class="toolbar-controls">
			<input class="form-input" placeholder="Search standards..." bind:value={query} on:input={() => loadStandards()} />
			<input class="form-input" placeholder="Language" bind:value={language} on:input={() => loadStandards()} />
			<input class="form-input" placeholder="Stack tags, comma separated" bind:value={stack} on:input={() => loadStandards()} />
			<select class="form-select" bind:value={scope} on:change={() => loadStandards()}>
				<option value="repo">Repo + global</option>
				<option value="global">Global only</option>
				<option value="all">All standards</option>
			</select>
		</div>
	</div>

	{#if error}
		<div class="error-banner">{error}</div>
	{/if}

	{#if showCreate}
		<div class="glass card panel-card create-panel">
			<div class="panel-heading">
				<div>
					<div class="section-label">New Standard</div>
					<div class="toolbar-subtitle">Save one atomic coding standard for this repo or globally.</div>
				</div>
			</div>
			<div class="form-grid">
				<label>
					<span>Name</span>
					<input class="form-input" placeholder="Error handling standard" bind:value={form.name} />
				</label>
				<label>
					<span>Parent ID</span>
					<input class="form-input" placeholder="Optional parent standard UUID" bind:value={form.parent_id} />
				</label>
				<label>
					<span>Context</span>
					<input class="form-input" placeholder="testing, security, routing" bind:value={form.context} />
				</label>
				<label>
					<span>Version</span>
					<input class="form-input" placeholder="1.0.0" bind:value={form.version} />
				</label>
				<label>
					<span>Language</span>
					<input class="form-input" placeholder="typescript, python" bind:value={form.language} />
				</label>
				<label>
					<span>Stack</span>
					<input class="form-input" placeholder="svelte, vite, express" bind:value={form.stack} />
				</label>
				<label>
					<span>Tags</span>
					<input class="form-input" placeholder="frontend, linting" bind:value={form.tags} />
				</label>
				<label>
					<span>Metadata JSON</span>
					<input class="form-input" placeholder="JSON metadata" bind:value={form.metadata} />
				</label>
			</div>
			<label class="content-label">
				<span>Content</span>
				<textarea class="form-textarea content-input" placeholder="Write the implementation rule in concise Markdown..." bind:value={form.content}></textarea>
			</label>
			<button
				class="btn btn-primary"
				on:click={saveStandard}
				disabled={saving || !form.name.trim() || !form.content.trim() || splitList(form.tags).length === 0 || !parseMetadata(form.metadata)}
			>
				<Icon name="check" size={14} strokeWidth={2} />
				{saving ? "Saving..." : "Save Standard"}
			</button>
		</div>
	{/if}

	<div class="feature-grid" class:with-create={showCreate}>
		<div class="glass card panel-card list-panel">
			<div class="panel-heading">
				<div class="section-label">Standards</div>
				{#if standards.length === 0}
					<button class="btn btn-ghost btn-sm" on:click={() => (showCreate = true)}>Add first standard</button>
				{/if}
			</div>
			{#if loading}
				<div class="muted-state">Loading standards...</div>
			{:else if standards.length === 0}
				<div class="empty-state">
					<Icon name="check" size={22} strokeWidth={1.75} />
					<div class="empty-title">No standards found</div>
					<div class="empty-copy">Adjust the filters or create a standard for this repository.</div>
				</div>
			{:else}
				<div class="standard-list">
					{#each standardTree as node (node.standard.id)}
						<div class="standard-group">
							<button
								class:selected={selected?.id === node.standard.id}
								class="standard-row standard-row-root"
								on:click={() => loadStandardDetail(node.standard.id)}
							>
								<div class="row-title">{node.standard.title}</div>
								<div class="row-meta">
									<span>{node.standard.context}</span>
									<span>{node.standard.language || "any language"}</span>
									<span>{node.standard.is_global ? "global" : node.standard.repo || repo}</span>
									<span>{node.children.length > 0 ? `${node.children.length} child` : "root"}</span>
								</div>
								{#if node.standard.stack.length || node.standard.tags.length}
									<div class="tag-row">
										{#each [...new Set([...node.standard.stack, ...node.standard.tags])].slice(0, 6) as tag}
											<span class="mini-chip">{tag}</span>
										{/each}
									</div>
								{/if}
							</button>
							{#if node.children.length > 0}
								<div class="standard-children">
									{#each node.children as child (child.id)}
										<button
											class:selected={selected?.id === child.id}
											class="standard-row standard-row-child"
											on:click={() => loadStandardDetail(child.id)}
										>
											<div class="row-title">
												<Icon name="corner-down-right" size={13} strokeWidth={2} />
												<span>{child.title}</span>
											</div>
											<div class="row-meta">
												<span>{child.context}</span>
												<span>{child.language || "any language"}</span>
												<span>{child.is_global ? "global" : child.repo || repo}</span>
												<span>child</span>
											</div>
											{#if child.stack.length || child.tags.length}
												<div class="tag-row">
													{#each [...new Set([...child.stack, ...child.tags])].slice(0, 6) as tag}
														<span class="mini-chip">{tag}</span>
													{/each}
												</div>
											{/if}
										</button>
									{/each}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<div class="glass card panel-card detail-panel">
			{#if detailLoading}
				<div class="muted-state">Loading standard detail...</div>
			{:else if selected}
				<div class="detail-heading">
					<div>
						<div class="detail-title">{selected.title}</div>
						<div class="row-meta">
							<span>{selected.context}</span>
							<span>v{selected.version}</span>
							<span>{selected.parent_id ? `child of ${selected.parent_id}` : "root"}</span>
							<span>{formatDate(selected.updated_at)}</span>
						</div>
					</div>
					<div class="detail-actions">
						<span class="scope-pill">{selected.is_global ? "Global" : "Repo"}</span>
						<button class="btn btn-ghost btn-sm" on:click={startEdit}>
							<Icon name="pencil" size={14} strokeWidth={2} />
							Edit
						</button>
						<button class="btn btn-ghost btn-sm danger-text" on:click={deleteStandard} disabled={deleting}>
							<Icon name="trash" size={14} strokeWidth={2} />
							{deleting ? "Deleting..." : "Delete"}
						</button>
					</div>
				</div>
				{#if editMode}
					<div class="form-grid">
						<label>
							<span>Name</span>
							<input class="form-input" bind:value={editForm.name} />
						</label>
						<label>
							<span>Parent ID</span>
							<input class="form-input" bind:value={editForm.parent_id} />
						</label>
						<label>
							<span>Context</span>
							<input class="form-input" bind:value={editForm.context} />
						</label>
						<label>
							<span>Version</span>
							<input class="form-input" bind:value={editForm.version} />
						</label>
						<label>
							<span>Language</span>
							<input class="form-input" bind:value={editForm.language} />
						</label>
						<label>
							<span>Stack</span>
							<input class="form-input" bind:value={editForm.stack} />
						</label>
						<label>
							<span>Tags</span>
							<input class="form-input" bind:value={editForm.tags} />
						</label>
						<label>
							<span>Metadata JSON</span>
							<input class="form-input" bind:value={editForm.metadata} />
						</label>
					</div>
					<label class="content-label">
						<span>Content</span>
						<textarea class="form-textarea content-input" bind:value={editForm.content}></textarea>
					</label>
					<div class="editor-actions">
						<button class="btn btn-primary" on:click={updateStandard} disabled={saving || !parseMetadata(editForm.metadata)}>
							<Icon name="check" size={14} strokeWidth={2} />
							{saving ? "Saving..." : "Save Changes"}
						</button>
						<button class="btn btn-ghost" on:click={cancelEdit} disabled={saving}>Cancel</button>
					</div>
				{:else}
					<div class="markdown-body md-card">
						<Markdown content={selected.content} />
					</div>
				{/if}
			{:else}
				<div class="empty-state detail-empty">
					<Icon name="book-open" size={22} strokeWidth={1.75} />
					<div class="empty-title">Select a standard</div>
					<div class="empty-copy">The full Markdown content and scope metadata appear here.</div>
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.feature-shell { display: flex; flex-direction: column; gap: 14px; }
	.feature-toolbar { display: grid; grid-template-columns: 1fr auto; gap: 14px; padding: 16px; align-items: start; }
	.toolbar-title { display: flex; align-items: center; gap: 10px; }
	.toolbar-action { justify-self: end; }
	.toolbar-subtitle { font-size: 0.72rem; color: var(--color-text-muted); font-weight: 600; margin-top: 2px; }
	.toolbar-controls { display: grid; grid-template-columns: minmax(220px, 1.2fr) minmax(130px, 0.6fr) minmax(180px, 1fr) minmax(140px, 0.6fr); gap: 10px; grid-column: 1 / -1; }
	.feature-grid { display: grid; grid-template-columns: minmax(320px, 0.9fr) minmax(0, 1.25fr); gap: 14px; align-items: start; }
	.panel-card { padding: 16px; min-width: 0; }
	.panel-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
	.form-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 12px 0 10px; }
	.standard-group { display: flex; flex-direction: column; gap: 8px; }
	.standard-children { display: flex; flex-direction: column; gap: 8px; margin-left: 14px; padding-left: 12px; border-left: 1px solid var(--color-border, rgba(148, 163, 184, 0.28)); }
	.standard-row-root { width: 100%; }
	.standard-row-child { width: 100%; background: rgba(148, 163, 184, 0.06); }
	.row-title :global(svg) { flex: 0 0 auto; }
	.detail-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
	.editor-actions { display: flex; gap: 10px; margin-top: 12px; }
	.danger-text { color: var(--color-danger, #d04b4b); }
	label span { display: block; font-size: 0.68rem; color: var(--color-text-muted); font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 4px; }
	.content-input { min-height: 150px; resize: vertical; margin-bottom: 10px; }
	.content-label { display: block; }
	.list-panel, .detail-panel { min-height: 460px; }
	.standard-list { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; max-height: 650px; overflow: auto; }
	.standard-row { text-align: left; border: 1px solid var(--color-border); background: rgba(255,255,255,0.48); border-radius: 8px; padding: 12px; cursor: pointer; color: var(--color-text); }
	.standard-row:hover, .standard-row.selected { border-color: rgba(14,165,233,0.45); background: rgba(14,165,233,0.08); }
	.row-title { font-size: 0.9rem; font-weight: 800; margin-bottom: 6px; }
	.row-meta { display: flex; flex-wrap: wrap; gap: 8px; color: var(--color-text-muted); font-size: 0.72rem; font-weight: 600; }
	.tag-row { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
	.mini-chip, .scope-pill { border: 1px solid var(--color-border); border-radius: 999px; padding: 2px 7px; font-size: 0.68rem; font-weight: 700; color: var(--color-text-muted); }
	.detail-heading { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; margin-bottom: 12px; }
	.detail-title { font-size: 1rem; font-weight: 850; color: var(--color-text); margin-bottom: 6px; }
	.muted-state { color: var(--color-text-muted); font-size: 0.85rem; padding: 24px 4px; text-align: center; }
	.empty-state { min-height: 260px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--color-text-muted); text-align: center; }
	.empty-title { color: var(--color-text); font-size: 0.92rem; font-weight: 850; }
	.empty-copy { max-width: 260px; font-size: 0.78rem; line-height: 1.45; }
	.detail-empty { min-height: 360px; }
	.error-banner { border: 1px solid #fecaca; background: #fef2f2; color: #dc2626; border-radius: 8px; padding: 10px 12px; font-size: 0.82rem; font-weight: 700; }
	:global(html.dark) .standard-row { background: rgba(15,23,42,0.45); }
	:global(html.dark) .standard-row:hover, :global(html.dark) .standard-row.selected { background: rgba(14,165,233,0.12); }
	@media (max-width: 1100px) {
		.toolbar-controls, .feature-grid, .form-grid { grid-template-columns: 1fr; }
		.feature-toolbar { grid-template-columns: 1fr; }
		.toolbar-action { justify-self: stretch; justify-content: center; }
		.list-panel, .detail-panel { min-height: auto; }
	}
</style>
