<script lang="ts">
	import { onMount } from "svelte";
	import { api } from "../lib/api";
	import Icon from "../lib/Icon.svelte";
	import { formatDate } from "../lib/utils";
	import type { Handoff, HandoffListResult, McpToolResponse, TaskClaim } from "../lib/interfaces";

	export let repo = "";

	let handoffs: Handoff[] = [];
	let loading = false;
	let creating = false;
	let claiming = false;
	let updatingStatus = false;
	let error = "";
	let status = "pending";
	let agentFilter = "";
	let selected: Handoff | null = null;
	let lastClaim: TaskClaim | null = null;
	let showCreate = false;
	let showClaim = false;

	let handoffForm = {
		from_agent: "",
		to_agent: "",
		task_code: "",
		summary: "",
		context: ""
	};
	const handoffContextPlaceholder = '{"next_steps":["..."],"blockers":[],"remaining_work":"..."}';

	let claimForm = {
		task_code: "",
		agent: "",
		role: "worker",
		metadata: ""
	};

	$: if (repo) {
		void loadHandoffs();
	}

	function structured<T>(response: unknown): T | null {
		const result = response as McpToolResponse<T>;
		return result?.structuredContent ?? null;
	}

	function parseObject(value: string): Record<string, unknown> {
		if (!value.trim()) return {};
		const parsed = JSON.parse(value) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error("JSON must be an object.");
		}
		return parsed as Record<string, unknown>;
	}

	function canCreateHandoff() {
		return (
			!!handoffForm.from_agent.trim() &&
			!!handoffForm.summary.trim() &&
			(!!handoffForm.to_agent.trim() || !!handoffForm.task_code.trim() || !!handoffForm.context.trim())
		);
	}

	function rowToHandoff(columns: string[], row: unknown[]): Handoff {
		const data = Object.fromEntries(columns.map((column, index) => [column, row[index]])) as Record<string, unknown>;
		return {
			id: String(data.id || ""),
			repo,
			from_agent: String(data.from_agent || ""),
			to_agent: data.to_agent ? String(data.to_agent) : null,
			task_id: data.task_id ? String(data.task_id) : null,
			summary: String(data.summary || ""),
			context: {},
			status: String(data.status || "pending") as Handoff["status"],
			created_at: String(data.created_at || ""),
			updated_at: String(data.created_at || ""),
			expires_at: null
		};
	}

	async function loadHandoffs() {
		if (!repo) return;
		loading = true;
		error = "";
		try {
			const args: Record<string, unknown> = {
				repo,
				status: status || undefined,
				limit: 50,
				structured: true
			};
			if (agentFilter.trim()) {
				args.to_agent = agentFilter.trim();
			}
			const result = structured<HandoffListResult>(await api.callTool("handoff-list", args));
			const columns = result?.handoffs?.columns || [];
			handoffs = (result?.handoffs?.rows || []).map((row) => rowToHandoff(columns, row));
			if (selected && !handoffs.some((handoff) => handoff.id === selected?.id)) selected = null;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	async function createHandoff() {
		if (!handoffForm.from_agent.trim() || !handoffForm.summary.trim()) return;
		creating = true;
		error = "";
		try {
			const result = structured<Handoff>(
				await api.callTool("handoff-create", {
					repo,
					from_agent: handoffForm.from_agent.trim(),
					to_agent: handoffForm.to_agent.trim() || undefined,
					task_code: handoffForm.task_code.trim() || undefined,
					summary: handoffForm.summary.trim(),
					context: parseObject(handoffForm.context),
					structured: true
				})
			);
			handoffForm = { from_agent: "", to_agent: "", task_code: "", summary: "", context: "" };
			showCreate = false;
			await loadHandoffs();
			selected = result || handoffs[0] || null;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			creating = false;
		}
	}

	async function claimTask() {
		if (!claimForm.task_code.trim() || !claimForm.agent.trim()) return;
		claiming = true;
		error = "";
		try {
			lastClaim = structured<TaskClaim>(
				await api.callTool("task-claim", {
					repo,
					task_code: claimForm.task_code.trim(),
					agent: claimForm.agent.trim(),
					role: claimForm.role.trim() || "worker",
					metadata: parseObject(claimForm.metadata),
					structured: true
				})
			);
			claimForm = { task_code: "", agent: claimForm.agent, role: claimForm.role, metadata: "" };
			showClaim = false;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			claiming = false;
		}
	}

	async function updateHandoffStatus(nextStatus: Handoff["status"]) {
		if (!selected) return;
		updatingStatus = true;
		error = "";
		try {
			await api.callTool("handoff-update", {
				id: selected.id,
				status: nextStatus,
				structured: true
			});
			await loadHandoffs();
			selected = handoffs.find((handoff) => handoff.id === selected?.id) || null;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			updatingStatus = false;
		}
	}

	onMount(() => {
		void loadHandoffs();
	});
</script>

<div class="feature-shell animate-fade-in">
	<div class="feature-toolbar glass card">
		<div class="toolbar-title">
			<Icon name="git-branch" size={16} strokeWidth={2} />
			<div>
				<div class="section-label">Handoffs & Claims</div>
				<div class="toolbar-subtitle">{handoffs.length} handoffs in view</div>
			</div>
		</div>
		<div class="toolbar-actions">
			<button class="btn btn-primary" on:click={() => (showCreate = !showCreate)}>
				<Icon name="git-branch" size={14} strokeWidth={2} />
				{showCreate ? "Close Handoff" : "New Handoff"}
			</button>
			<button class="btn btn-accent" on:click={() => (showClaim = !showClaim)}>
				<Icon name="check" size={14} strokeWidth={2} />
				{showClaim ? "Close Claim" : "Claim Task"}
			</button>
		</div>
		<div class="toolbar-controls">
			<select class="form-select" bind:value={status} on:change={() => loadHandoffs()}>
				<option value="">All statuses</option>
				<option value="pending">Pending</option>
				<option value="accepted">Accepted</option>
				<option value="rejected">Rejected</option>
				<option value="expired">Expired</option>
			</select>
			<input class="form-input" placeholder="To agent filter" bind:value={agentFilter} on:input={() => loadHandoffs()} />
			<button class="btn btn-ghost" on:click={loadHandoffs}>
				<Icon name="refresh-cw" size={14} strokeWidth={2} />
				Refresh
			</button>
		</div>
	</div>

	{#if error}
		<div class="error-banner">{error}</div>
	{/if}

	{#if showCreate || showClaim}
		<div class="action-grid">
			{#if showCreate}
				<div class="glass card panel-card action-panel">
			<div class="section-label">Create Handoff</div>
			<div class="form-stack">
				<label><span>From agent</span><input class="form-input" placeholder="agent-a" bind:value={handoffForm.from_agent} /></label>
				<label><span>To agent</span><input class="form-input" placeholder="agent-b (optional)" bind:value={handoffForm.to_agent} /></label>
				<label><span>Task code</span><input class="form-input" placeholder="TASK-123 (optional)" bind:value={handoffForm.task_code} /></label>
				<label><span>Summary</span><textarea class="form-textarea summary-input" placeholder="What should the next agent know?" bind:value={handoffForm.summary}></textarea></label>
				<label><span>Context JSON</span><textarea class="form-textarea json-input" placeholder={handoffContextPlaceholder} bind:value={handoffForm.context}></textarea></label>
				<button class="btn btn-primary" on:click={createHandoff} disabled={creating || !canCreateHandoff()}>
					<Icon name="git-branch" size={14} strokeWidth={2} />
					{creating ? "Creating..." : "Create Handoff"}
				</button>
			</div>
		</div>
			{/if}

			{#if showClaim}
				<div class="glass card panel-card action-panel">
			<div class="section-label">Claim Task</div>
			<div class="form-stack">
				<label><span>Task code</span><input class="form-input" placeholder="TASK-123" bind:value={claimForm.task_code} /></label>
				<label><span>Agent</span><input class="form-input" placeholder="agent-name" bind:value={claimForm.agent} /></label>
				<label><span>Role</span><input class="form-input" placeholder="worker" bind:value={claimForm.role} /></label>
				<label><span>Metadata JSON</span><textarea class="form-textarea json-input" placeholder="Metadata JSON object" bind:value={claimForm.metadata}></textarea></label>
				<button class="btn btn-accent" on:click={claimTask} disabled={claiming || !claimForm.task_code.trim() || !claimForm.agent.trim()}>
					<Icon name="check" size={14} strokeWidth={2} />
					{claiming ? "Claiming..." : "Claim Task"}
				</button>
			</div>
			{#if lastClaim}
				<div class="claim-result">
					<div class="row-title">Claimed {lastClaim.task_code || lastClaim.task_id}</div>
					<div class="row-meta">
						<span>{lastClaim.agent}</span>
						<span>{lastClaim.role}</span>
						<span>{formatDate(lastClaim.claimed_at)}</span>
					</div>
				</div>
			{/if}
		</div>
			{/if}
		</div>
	{/if}

	<div class="feature-grid">
		<div class="glass card panel-card list-panel">
			<div class="panel-heading">
				<div class="section-label">Handoff Queue</div>
				{#if handoffs.length === 0}
					<button class="btn btn-ghost btn-sm" on:click={() => (showCreate = true)}>Create handoff</button>
				{/if}
			</div>
			{#if loading}
				<div class="muted-state">Loading handoffs...</div>
			{:else if handoffs.length === 0}
				<div class="empty-state">
					<Icon name="git-branch" size={22} strokeWidth={1.75} />
					<div class="empty-title">No handoffs found</div>
					<div class="empty-copy">Create a handoff when work needs context transfer between agents.</div>
				</div>
			{:else}
				<div class="handoff-list">
					{#each handoffs as handoff (handoff.id)}
						<button class:selected={selected?.id === handoff.id} class="handoff-row" on:click={() => (selected = handoff)}>
							<div class="handoff-top">
								<span class="status-pill status-{handoff.status}">{handoff.status}</span>
								<span class="row-date">{formatDate(handoff.created_at)}</span>
							</div>
							<div class="row-title">{handoff.summary}</div>
							<div class="row-meta">
								<span>{handoff.from_agent} -> {handoff.to_agent || "unassigned"}</span>
								{#if handoff.task_id}<span>{handoff.task_id.slice(0, 8)}</span>{/if}
							</div>
						</button>
					{/each}
				</div>
			{/if}
		</div>

		<div class="glass card panel-card detail-panel">
			{#if selected}
				<div class="detail-title">{selected.summary}</div>
				<div class="detail-grid">
					<div><span>From</span><strong>{selected.from_agent}</strong></div>
					<div><span>To</span><strong>{selected.to_agent || "unassigned"}</strong></div>
					<div><span>Status</span><strong>{selected.status}</strong></div>
					<div><span>Created</span><strong>{formatDate(selected.created_at)}</strong></div>
				</div>
				<div class="status-actions">
					<button class="btn btn-ghost btn-sm" disabled={updatingStatus || selected.status === "accepted"} on:click={() => updateHandoffStatus("accepted")}>Accept</button>
					<button class="btn btn-ghost btn-sm" disabled={updatingStatus || selected.status === "expired"} on:click={() => updateHandoffStatus("expired")}>Expire</button>
					<button class="btn btn-ghost btn-sm" disabled={updatingStatus || selected.status === "rejected"} on:click={() => updateHandoffStatus("rejected")}>Reject</button>
				</div>
				{#if selected.task_id}
					<div class="linked-task">Task ID: {selected.task_id}</div>
				{/if}
			{:else}
				<div class="empty-state detail-empty">
					<Icon name="book-open" size={22} strokeWidth={1.75} />
					<div class="empty-title">Select a handoff</div>
					<div class="empty-copy">Details for the selected handoff appear here.</div>
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.feature-shell { display: flex; flex-direction: column; gap: 14px; }
	.feature-toolbar { display: grid; grid-template-columns: 1fr auto; gap: 14px; align-items: start; padding: 16px; }
	.toolbar-title { display: flex; align-items: center; gap: 10px; }
	.toolbar-subtitle { font-size: 0.72rem; color: var(--color-text-muted); font-weight: 600; margin-top: 2px; }
	.toolbar-actions { display: flex; align-items: center; gap: 8px; justify-content: flex-end; }
	.toolbar-controls { display: grid; grid-template-columns: 160px minmax(180px, 1fr) auto; gap: 10px; align-items: center; grid-column: 1 / -1; }
	.action-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
	.feature-grid { display: grid; grid-template-columns: minmax(360px, 0.95fr) minmax(0, 1.05fr); gap: 14px; align-items: start; }
	.panel-card { padding: 16px; min-width: 0; }
	.action-panel { min-height: 0; }
	.panel-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
	.form-stack { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
	label span { display: block; font-size: 0.68rem; color: var(--color-text-muted); font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 4px; }
	.summary-input { min-height: 92px; resize: vertical; }
	.json-input { min-height: 86px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.78rem; }
	.handoff-list { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; max-height: 650px; overflow: auto; }
	.handoff-row { text-align: left; border: 1px solid var(--color-border); background: rgba(255,255,255,0.48); border-radius: 8px; padding: 12px; cursor: pointer; color: var(--color-text); }
	.handoff-row:hover, .handoff-row.selected { border-color: rgba(14,165,233,0.45); background: rgba(14,165,233,0.08); }
	.handoff-top { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 8px; }
	.status-pill { border-radius: 999px; padding: 2px 8px; font-size: 0.67rem; text-transform: uppercase; font-weight: 850; border: 1px solid var(--color-border); }
	.status-pending { color: #0369a1; background: rgba(14,165,233,0.12); }
	.status-accepted { color: #047857; background: rgba(16,185,129,0.12); }
	.status-rejected { color: #b91c1c; background: rgba(239,68,68,0.12); }
	.status-expired { color: #64748b; background: rgba(100,116,139,0.12); }
	.row-title { font-size: 0.9rem; font-weight: 800; margin-bottom: 6px; line-height: 1.35; }
	.row-meta { display: flex; flex-wrap: wrap; gap: 8px; color: var(--color-text-muted); font-size: 0.72rem; font-weight: 600; }
	.row-date { color: var(--color-text-muted); font-size: 0.7rem; font-weight: 700; }
	.claim-result, .linked-task { margin-top: 14px; padding: 12px; border: 1px solid rgba(16,185,129,0.25); background: rgba(16,185,129,0.08); border-radius: 8px; }
	.detail-title { font-size: 1rem; font-weight: 850; color: var(--color-text); margin-bottom: 14px; line-height: 1.35; }
	.detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
	.detail-grid div { border: 1px solid var(--color-border); border-radius: 8px; padding: 10px; }
	.detail-grid span { display: block; font-size: 0.68rem; color: var(--color-text-muted); font-weight: 750; text-transform: uppercase; margin-bottom: 4px; }
	.detail-grid strong { font-size: 0.82rem; color: var(--color-text); word-break: break-word; }
	.status-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
	.muted-state { color: var(--color-text-muted); font-size: 0.85rem; padding: 24px 4px; text-align: center; }
	.empty-state { min-height: 260px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--color-text-muted); text-align: center; }
	.empty-title { color: var(--color-text); font-size: 0.92rem; font-weight: 850; }
	.empty-copy { max-width: 260px; font-size: 0.78rem; line-height: 1.45; }
	.detail-empty { min-height: 260px; }
	.error-banner { border: 1px solid #fecaca; background: #fef2f2; color: #dc2626; border-radius: 8px; padding: 10px 12px; font-size: 0.82rem; font-weight: 700; }
	:global(html.dark) .handoff-row { background: rgba(15,23,42,0.45); }
	:global(html.dark) .handoff-row:hover, :global(html.dark) .handoff-row.selected { background: rgba(14,165,233,0.12); }
	@media (max-width: 1280px) {
		.feature-toolbar { grid-template-columns: 1fr; }
		.toolbar-actions { justify-content: stretch; }
		.toolbar-actions .btn { flex: 1; justify-content: center; }
	}
	@media (max-width: 760px) {
		.toolbar-controls, .feature-grid, .detail-grid, .action-grid { grid-template-columns: 1fr; }
		.toolbar-actions { flex-direction: column; }
		.toolbar-actions .btn { width: 100%; }
	}
</style>
