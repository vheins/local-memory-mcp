<script lang="ts">
	import { onMount } from "svelte";
	import { api } from "../lib/api";
	import Icon from "../lib/Icon.svelte";
	import DetailDrawer from "./DetailDrawer.svelte";
	import { formatDate } from "../lib/utils";
	import type { Handoff, HandoffListResult, McpToolResponse, TaskClaim } from "../lib/interfaces";

	export let repo = "";

	let handoffs: Handoff[] = [];
	let loading = false;
	let error = "";
	let status = "";
	let agentFilter = "";
	let claims: TaskClaim[] = [];
	let claimsLoading = false;
	let releasingClaimId: string | null = null;

	// Detail drawer
	let selectedHandoff: Handoff | null = null;
	let handoffDrawerOpen = false;

	$: if (repo) {
		void refreshCoordination();
	}

	function structured<T>(response: unknown): T | null {
		const result = response as McpToolResponse<T>;
		return result?.structuredContent ?? null;
	}

	function rowToHandoff(columns: string[], row: unknown[]): Handoff {
		const data = Object.fromEntries(columns.map((column, index) => [column, row[index]])) as Record<string, unknown>;
		return {
			id: String(data.id || ""),
			repo,
			from_agent: String(data.from_agent || ""),
			to_agent: data.to_agent ? String(data.to_agent) : null,
			task_id: data.task_id ? String(data.task_id) : null,
			task_code: data.task_code ? String(data.task_code) : null,
			summary: String(data.summary || ""),
			context:
				data.context && typeof data.context === "object" && !Array.isArray(data.context)
					? (data.context as Record<string, unknown>)
					: {},
			status: String(data.status || "pending") as Handoff["status"],
			created_at: String(data.created_at || ""),
			updated_at: String(data.updated_at || data.created_at || ""),
			expires_at: data.expires_at ? String(data.expires_at) : null
		};
	}

	async function loadClaims() {
		if (!repo) return;
		claimsLoading = true;
		try {
			const result = await api.coordinationClaims({ repo, active_only: true, pageSize: 20 });
			claims = result.claims || [];
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			claimsLoading = false;
		}
	}

	async function loadHandoffs() {
		if (!repo) return;
		loading = true;
		error = "";
		try {
			const args: Record<string, unknown> = { repo, limit: 50, structured: true };
			if (status) args.status = status;
			if (agentFilter.trim()) args.to_agent = agentFilter.trim();
			const result = structured<HandoffListResult>(await api.callTool("handoff-list", args));
			const columns = result?.handoffs?.columns || [];
			handoffs = (result?.handoffs?.rows || []).map((row) => rowToHandoff(columns, row));
			if (selectedHandoff && !handoffs.some((h) => h.id === selectedHandoff?.id)) {
				selectedHandoff = null;
			}
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	async function refreshCoordination() {
		await Promise.all([loadHandoffs(), loadClaims()]);
	}

	function openCreateDrawer() {
		selectedHandoff = null;
		handoffDrawerOpen = true;
	}

	function openViewDrawer(handoff: Handoff) {
		selectedHandoff = handoff;
		handoffDrawerOpen = true;
	}

	function closeHandoffDrawer() {
		handoffDrawerOpen = false;
		selectedHandoff = null;
	}

	function handleHandoffCreated() {
		closeHandoffDrawer();
		void refreshCoordination();
	}

	function handleHandoffUpdated() {
		closeHandoffDrawer();
		void refreshCoordination();
	}

	async function releaseClaim(claim: TaskClaim) {
		releasingClaimId = claim.id;
		error = "";
		try {
			await api.releaseClaim({ repo, task_id: claim.task_id, agent: claim.agent });
			await loadClaims();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			releasingClaimId = null;
		}
	}

	async function handleDeleteRow(handoff: Handoff) {
		if (!confirm(`Expire handoff "${handoff.summary}"?`)) return;
		try {
			await api.callTool("handoff-update", { id: handoff.id, status: "expired", structured: true });
			void refreshCoordination();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	$: pendingCount = handoffs.filter((h) => h.status === "pending").length;
	$: resolvedCount = handoffs.filter((h) => h.status !== "pending").length;

	onMount(() => {
		void refreshCoordination();
	});
</script>

<div class="feature-shell animate-fade-in">
	<div class="feature-toolbar glass card">
		<div class="toolbar-title">
			<Icon name="git-branch" size={16} strokeWidth={2} />
			<div>
				<div class="section-label">HANDOFFS & CLAIMS</div>
				<div class="toolbar-subtitle">
					Handoffs transfer context between agents. Claims reserve a task for one owner.
				</div>
			</div>
		</div>
		<button class="btn btn-primary toolbar-action" on:click={openCreateDrawer}>
			<Icon name="plus" size={14} strokeWidth={2} />
			New Handoff
		</button>
		<div class="toolbar-controls">
			<select class="form-select" bind:value={status} on:change={loadHandoffs}>
				<option value="">All statuses</option>
				<option value="pending">Pending</option>
				<option value="accepted">Accepted</option>
				<option value="rejected">Rejected</option>
				<option value="expired">Expired</option>
			</select>
			<input
				class="form-input"
				placeholder="To agent filter"
				bind:value={agentFilter}
				on:input={loadHandoffs}
			/>
			<button class="btn btn-ghost" on:click={refreshCoordination}>
				<Icon name="refresh-cw" size={14} strokeWidth={2} />
				Refresh
			</button>
		</div>
	</div>

	<div class="insight-strip">
		<div class="insight-card">
			<span>Pending</span>
			<strong>{pendingCount}</strong>
		</div>
		<div class="insight-card">
			<span>Resolved</span>
			<strong>{resolvedCount}</strong>
		</div>
		<div class="insight-card">
			<span>Claims</span>
			<strong>{claims.length}</strong>
		</div>
		<div class="insight-card">
			<span>Total</span>
			<strong>{handoffs.length}</strong>
		</div>
	</div>

	{#if error}
		<div class="error-banner">{error}</div>
	{/if}

	<!-- Table -->
	<div class="mem-table-wrap">
		<table class="mem-table">
			<thead>
				<tr class="mem-thead-row">
					<th class="mem-th" style="min-width:140px;">From</th>
					<th class="mem-th" style="min-width:140px;">To</th>
					<th class="mem-th" style="min-width:100px;">Task</th>
					<th class="mem-th" style="min-width:200px;">Summary</th>
					<th class="mem-th" style="width:100px;">Status</th>
					<th class="mem-th" style="width:130px;">Created</th>
					<th class="mem-th" style="width:130px;">Expires</th>
					<th class="mem-th" style="width:60px;"></th>
				</tr>
			</thead>
			<tbody>
				{#if loading}
					{#each { length: 5 } as _, i (i)}
						<tr>
							<td colspan="8" class="mem-td">
								<div class="skeleton" style="height:20px;border-radius:6px;"></div>
							</td>
						</tr>
					{/each}
				{:else if handoffs.length === 0}
					<tr>
						<td colspan="8" class="mem-td" style="padding:40px;text-align:center;color:var(--color-text-muted);">
							<Icon name="git-branch" size={22} strokeWidth={1.75} />
							<div style="margin-top:8px;">No handoffs found</div>
							<div style="font-size:0.78rem;margin-top:4px;">Create a handoff when work needs context transfer between agents.</div>
						</td>
					</tr>
				{:else}
					{#each handoffs as handoff (handoff.id)}
						<tr
							class="mem-row"
							on:click={() => openViewDrawer(handoff)}
							role="button"
							tabindex="0"
							on:keydown={(e) => e.key === "Enter" && openViewDrawer(handoff)}
						>
							<td class="mem-td" style="font-size:0.82rem;color:var(--color-text);font-weight:600;">
								{handoff.from_agent}
							</td>
							<td class="mem-td" style="font-size:0.82rem;color:var(--color-text);">
								{handoff.to_agent || "—"}
							</td>
							<td class="mem-td" style="font-size:0.75rem;color:var(--color-text-muted);">
								{handoff.task_code || handoff.task_id?.slice(0, 8) || "—"}
							</td>
							<td class="mem-td" style="max-width:300px;">
								<div class="truncate font-semibold" style="font-size:0.82rem;color:var(--color-text);">
									{handoff.summary}
								</div>
							</td>
							<td class="mem-td">
								<span
									class="status-pill"
									class:status-pending={handoff.status === "pending"}
									class:status-accepted={handoff.status === "accepted"}
									class:status-rejected={handoff.status === "rejected"}
									class:status-expired={handoff.status === "expired"}
								>{handoff.status}</span>
							</td>
							<td class="mem-td" style="font-size:0.75rem;color:var(--color-text-muted);white-space:nowrap;">
								{formatDate(handoff.created_at)}
							</td>
							<td class="mem-td" style="font-size:0.75rem;color:var(--color-text-muted);white-space:nowrap;">
								{handoff.expires_at ? formatDate(handoff.expires_at) : "—"}
							</td>
							<td class="mem-td row-actions" on:click|stopPropagation>
								<button
									class="row-action-btn delete-btn"
									on:click={() => handleDeleteRow(handoff)}
									title="Expire"
									aria-label="Expire handoff"
									disabled={handoff.status === "expired"}
								>
									<Icon name="trash-2" size={13} strokeWidth={2} />
								</button>
							</td>
						</tr>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>

	<!-- Claims section -->
	<div class="claims-section">
		<div class="claims-header">
			<div class="section-label">Active Claims</div>
			<span class="toolbar-subtitle">{claims.length} active</span>
		</div>
		{#if claimsLoading}
			<div class="muted-state">Loading claims...</div>
		{:else if claims.length === 0}
			<div class="empty-claims">
				<Icon name="check" size={20} strokeWidth={1.75} />
				<div class="empty-title">No active claims</div>
				<div class="empty-copy">Claimed tasks will appear here so you can inspect or release them.</div>
			</div>
		{:else}
			<div class="claim-list">
				{#each claims as claim (claim.id)}
					<div class="claim-row">
						<div>
							<div class="row-title">{claim.task_code || claim.task_id}</div>
							<div class="row-meta">
								<span>{claim.agent}</span>
								<span>{claim.role}</span>
								<span>{formatDate(claim.claimed_at)}</span>
							</div>
						</div>
						<button
							class="btn btn-ghost btn-sm"
							disabled={releasingClaimId === claim.id}
							on:click={() => releaseClaim(claim)}
						>
							{releasingClaimId === claim.id ? "Releasing..." : "Release"}
						</button>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

<DetailDrawer
	handoff={selectedHandoff}
	open={handoffDrawerOpen}
	onClose={closeHandoffDrawer}
	onHandoffCreated={handleHandoffCreated}
	onHandoffUpdated={handleHandoffUpdated}
	{repo}
/>

<style>
	.feature-shell {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.feature-toolbar {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 14px;
		align-items: start;
		padding: 16px;
	}
	.toolbar-title {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.toolbar-action {
		justify-self: end;
	}
	.toolbar-subtitle {
		font-size: 0.72rem;
		color: var(--color-text-muted);
		font-weight: 600;
		margin-top: 2px;
		line-height: 1.45;
	}
	.section-label {
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
	}
	.insight-strip {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 10px;
	}
	.insight-card {
		padding: 12px 14px;
		border-radius: 14px;
		border: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.32);
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.insight-card span {
		font-size: 0.66rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-muted);
	}
	.insight-card strong {
		font-size: 0.84rem;
		color: var(--color-text);
	}
	.toolbar-controls {
		display: grid;
		grid-template-columns: 160px minmax(180px, 1fr) auto;
		gap: 10px;
		align-items: center;
		grid-column: 1 / -1;
	}

	/* ── Table ── */
	.mem-table-wrap {
		overflow-x: auto;
		border-radius: 14px;
		border: 1px solid var(--color-border);
		background: var(--color-surface, #fff);
	}
	.mem-table {
		width: 100%;
		border-collapse: collapse;
		min-width: 750px;
	}
	.mem-thead-row {
		border-bottom: 1px solid var(--color-border);
		background: rgba(248, 250, 252, 0.9);
	}
	:global(html.dark) .mem-thead-row {
		background: rgba(10, 18, 38, 0.85);
	}
	.mem-th {
		padding: 10px 12px;
		text-align: left;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
		white-space: nowrap;
		user-select: none;
	}
	.mem-td {
		padding: 10px 12px;
		border-bottom: 1px solid var(--color-border);
	}
	:global(html.dark) .mem-td {
		border-color: rgba(148, 163, 184, 0.08);
	}
	.mem-row {
		cursor: pointer;
		transition: background 0.15s ease;
	}
	.mem-row:hover {
		background: rgba(241, 245, 249, 0.7);
	}
	:global(html.dark) .mem-row:hover {
		background: rgba(14, 165, 233, 0.05);
	}
	.mem-row:last-child .mem-td {
		border-bottom: none;
	}
	.row-actions {
		display: flex;
		align-items: center;
		gap: 4px;
		opacity: 0;
		transition: opacity 0.15s ease;
		white-space: nowrap;
	}
	.mem-row:hover .row-actions {
		opacity: 1;
	}
	.row-action-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: 7px;
		border: none;
		cursor: pointer;
		background: transparent;
		transition: background 0.15s ease, color 0.15s ease;
		color: var(--color-text-muted);
	}
	.delete-btn:hover {
		background: rgba(239, 68, 68, 0.1);
		color: #ef4444;
	}
	:global(html.dark) .delete-btn:hover {
		background: rgba(239, 68, 68, 0.15);
		color: #fca5a5;
	}

	/* ── Status pills ── */
	.status-pill {
		border-radius: 999px;
		padding: 2px 8px;
		font-size: 0.67rem;
		text-transform: uppercase;
		font-weight: 850;
		border: 1px solid var(--color-border);
		display: inline-block;
	}
	.status-pending {
		color: #0369a1;
		background: rgba(14, 165, 233, 0.12);
	}
	.status-accepted {
		color: #047857;
		background: rgba(16, 185, 129, 0.12);
	}
	.status-rejected {
		color: #b91c1c;
		background: rgba(239, 68, 68, 0.12);
	}
	.status-expired {
		color: #64748b;
		background: rgba(100, 116, 139, 0.12);
	}

	/* ── Claims section ── */
	.claims-section {
		border-radius: 14px;
		border: 1px solid var(--color-border);
		background: var(--color-surface, #fff);
		padding: 16px;
	}
	.claims-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 12px;
	}
	.claim-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.claim-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 12px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: rgba(255, 255, 255, 0.04);
	}
	.row-title {
		font-size: 0.82rem;
		font-weight: 700;
		color: var(--color-text);
		margin-bottom: 4px;
	}
	.row-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		color: var(--color-text-muted);
		font-size: 0.72rem;
		font-weight: 600;
	}
	.muted-state {
		color: var(--color-text-muted);
		font-size: 0.85rem;
		padding: 24px 4px;
		text-align: center;
	}
	.empty-claims {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		color: var(--color-text-muted);
		text-align: center;
		padding: 24px;
	}
	.empty-title {
		color: var(--color-text);
		font-size: 0.92rem;
		font-weight: 850;
	}
	.empty-copy {
		max-width: 260px;
		font-size: 0.78rem;
		line-height: 1.45;
	}
	.error-banner {
		border: 1px solid #fecaca;
		background: #fef2f2;
		color: #dc2626;
		border-radius: 8px;
		padding: 10px 12px;
		font-size: 0.82rem;
		font-weight: 700;
	}
	@media (max-width: 900px) {
		.insight-strip,
		.toolbar-controls {
			grid-template-columns: 1fr;
		}
	}
</style>
