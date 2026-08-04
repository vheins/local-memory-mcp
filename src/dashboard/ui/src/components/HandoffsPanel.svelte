<script lang="ts">
	import { onMount } from "svelte";
	import { api } from "../lib/api";
	import DetailDrawer from "./DetailDrawer.svelte";
	import HandoffFilterBar from "./HandoffFilterBar.svelte";
	import HandoffList from "./HandoffList.svelte";
	import { confirmDelete } from "../lib/confirm";
	import type { Handoff, TaskClaim } from "../lib/interfaces";

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
			const params: { repo: string; pageSize: number; status?: string; to_agent?: string } = { repo, pageSize: 50 };
			if (status) params.status = status;
			if (agentFilter.trim()) params.to_agent = agentFilter.trim();
			const result = await api.coordinationHandoffs(params);
			handoffs = result.handoffs || [];
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
		if (!(await confirmDelete(`Expire handoff "${handoff.summary}"?`))) return;
		try {
			await api.updateHandoffStatus({ id: handoff.id, status: "expired" });
			void refreshCoordination();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	onMount(() => {
		void refreshCoordination();
	});
</script>

<div class="feature-shell animate-fade-in">
	<HandoffFilterBar
		bind:status
		bind:agentFilter
		pendingCount={handoffs.filter((h) => h.status === "pending").length}
		resolvedCount={handoffs.filter((h) => h.status !== "pending").length}
		claimsCount={claims.length}
		totalCount={handoffs.length}
		onStatusChange={loadHandoffs}
		onAgentFilterChange={loadHandoffs}
		onRefresh={refreshCoordination}
		onNewHandoff={openCreateDrawer}
	/>

	{#if error}
		<div class="error-banner">{error}</div>
	{/if}

	<HandoffList
		{handoffs}
		{loading}
		{claims}
		{claimsLoading}
		{releasingClaimId}
		onOpenViewDrawer={openViewDrawer}
		onDeleteRow={handleDeleteRow}
		onReleaseClaim={releaseClaim}
	/>
</div>

<DetailDrawer
	drawerMode={selectedHandoff ? "handoff" : "new-handoff"}
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

	.error-banner {
		border: 1px solid #fecaca;
		background: #fef2f2;
		color: #dc2626;
		border-radius: 8px;
		padding: 10px 12px;
		font-size: 0.82rem;
		font-weight: 700;
	}
</style>
