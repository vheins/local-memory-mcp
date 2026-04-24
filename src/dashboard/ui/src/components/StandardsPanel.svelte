<script lang="ts">
	import { onMount } from "svelte";
	import { api } from "../lib/api";
	import Icon from "../lib/Icon.svelte";
	import Markdown from "./Markdown.svelte";
	import { formatDate } from "../lib/utils";
	import type { CodingStandard, McpToolResponse, StandardSearchResult } from "../lib/interfaces";

	export let repo = "";

	let standards: CodingStandard[] = [];
	let loading = false;
	let saving = false;
	let error = "";
	let query = "";
	let language = "";
	let stack = "";
	let scope: "repo" | "global" | "all" = "repo";
	let selected: CodingStandard | null = null;

	let form = {
		name: "",
		context: "general",
		version: "1.0.0",
		language: "",
		stack: "",
		tags: "",
		content: ""
	};

	$: if (repo) {
		void loadStandards();
	}

	function structured<T>(response: unknown): T | null {
		const result = response as McpToolResponse<T>;
		return result?.structuredContent ?? null;
	}

	function splitList(value: string) {
		return value
			.split(",")
			.map((item) => item.trim())
			.filter(Boolean);
	}

	async function loadStandards() {
		if (!repo) return;
		loading = true;
		error = "";
		try {
			const args: Record<string, unknown> = {
				query: query || undefined,
				language: language || undefined,
				stack: splitList(stack),
				limit: 50,
				structured: true
			};
			if (scope === "repo") args.repo = repo;
			if (scope === "global") args.is_global = true;

			const result = structured<StandardSearchResult>(await api.callTool("standard-search", args));
			standards = result?.standards || [];
			if (selected && !standards.some((item) => item.id === selected?.id)) selected = null;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	async function saveStandard() {
		if (!form.name.trim() || !form.content.trim()) return;
		saving = true;
		error = "";
		try {
			const isGlobal = scope === "global";
			const result = structured<{ standard: CodingStandard }>(
				await api.callTool("standard-store", {
					name: form.name.trim(),
					content: form.content.trim(),
					context: form.context.trim() || "general",
					version: form.version.trim() || "1.0.0",
					language: form.language.trim() || undefined,
					stack: splitList(form.stack),
					tags: splitList(form.tags),
					repo: isGlobal ? undefined : repo,
					is_global: isGlobal,
					structured: true
				})
			);
			form = { name: "", context: "general", version: "1.0.0", language: "", stack: "", tags: "", content: "" };
			await loadStandards();
			selected = result?.standard || standards[0] || null;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			saving = false;
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

	<div class="feature-grid">
		<div class="glass card panel-card">
			<div class="section-label">New Standard</div>
			<div class="form-grid">
				<input class="form-input" placeholder="Name" bind:value={form.name} />
				<input class="form-input" placeholder="Context" bind:value={form.context} />
				<input class="form-input" placeholder="Version" bind:value={form.version} />
				<input class="form-input" placeholder="Language" bind:value={form.language} />
				<input class="form-input" placeholder="Stack, comma separated" bind:value={form.stack} />
				<input class="form-input" placeholder="Tags, comma separated" bind:value={form.tags} />
			</div>
			<textarea class="form-textarea content-input" placeholder="Standard content..." bind:value={form.content}></textarea>
			<button class="btn btn-primary" on:click={saveStandard} disabled={saving || !form.name.trim() || !form.content.trim()}>
				<Icon name="check" size={14} strokeWidth={2} />
				{saving ? "Saving..." : "Save Standard"}
			</button>
		</div>

		<div class="glass card panel-card list-panel">
			<div class="section-label">Standards</div>
			{#if loading}
				<div class="muted-state">Loading standards...</div>
			{:else if standards.length === 0}
				<div class="muted-state">No standards found.</div>
			{:else}
				<div class="standard-list">
					{#each standards as standard (standard.id)}
						<button class:selected={selected?.id === standard.id} class="standard-row" on:click={() => (selected = standard)}>
							<div class="row-title">{standard.title}</div>
							<div class="row-meta">
								<span>{standard.context}</span>
								<span>{standard.language || "any language"}</span>
								<span>{standard.is_global ? "global" : standard.repo || repo}</span>
							</div>
							{#if standard.stack.length || standard.tags.length}
								<div class="tag-row">
									{#each [...standard.stack, ...standard.tags].slice(0, 6) as tag (tag)}
										<span class="mini-chip">{tag}</span>
									{/each}
								</div>
							{/if}
						</button>
					{/each}
				</div>
			{/if}
		</div>

		<div class="glass card panel-card detail-panel">
			{#if selected}
				<div class="detail-heading">
					<div>
						<div class="detail-title">{selected.title}</div>
						<div class="row-meta">
							<span>{selected.context}</span>
							<span>v{selected.version}</span>
							<span>{formatDate(selected.updated_at)}</span>
						</div>
					</div>
					<span class="scope-pill">{selected.is_global ? "Global" : "Repo"}</span>
				</div>
				<div class="markdown-body md-card">
					<Markdown content={selected.content} />
				</div>
			{:else}
				<div class="muted-state">Select a standard to inspect the full content.</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.feature-shell { display: flex; flex-direction: column; gap: 14px; }
	.feature-toolbar { display: flex; flex-direction: column; gap: 14px; padding: 16px; }
	.toolbar-title { display: flex; align-items: center; gap: 10px; }
	.toolbar-subtitle { font-size: 0.72rem; color: var(--color-text-muted); font-weight: 600; margin-top: 2px; }
	.toolbar-controls { display: grid; grid-template-columns: 1.2fr 0.7fr 1fr 0.7fr; gap: 10px; }
	.feature-grid { display: grid; grid-template-columns: 0.95fr 1fr 1.15fr; gap: 14px; align-items: start; }
	.panel-card { padding: 16px; min-width: 0; }
	.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 12px 0 8px; }
	.content-input { min-height: 180px; resize: vertical; margin-bottom: 10px; }
	.list-panel, .detail-panel { min-height: 430px; }
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
	.error-banner { border: 1px solid #fecaca; background: #fef2f2; color: #dc2626; border-radius: 8px; padding: 10px 12px; font-size: 0.82rem; font-weight: 700; }
	:global(html.dark) .standard-row { background: rgba(15,23,42,0.45); }
	:global(html.dark) .standard-row:hover, :global(html.dark) .standard-row.selected { background: rgba(14,165,233,0.12); }
	@media (max-width: 1100px) {
		.toolbar-controls, .feature-grid, .form-grid { grid-template-columns: 1fr; }
	}
</style>
