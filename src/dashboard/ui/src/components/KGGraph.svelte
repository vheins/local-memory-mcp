<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import { api } from "$lib/api";
	import Icon from "$lib/Icon.svelte";
	import type { KGNode, KGEdge } from "$lib/interfaces";
	import { initializeLayout, runForceLayout } from "$lib/kg/KGForceLayout";
	import type { LayoutNode, LayoutEdge } from "$lib/kg/KGForceLayout";
	import { NODE_RADIUS, resizeCanvas as resizeCanvasFn, renderGraph } from "$lib/kg/KGCanvasRenderer";
	import type { RenderState } from "$lib/kg/KGCanvasRenderer";
	import KGModal from "./KGModal.svelte";

	export let repo: string;

	// ─── State ─────────────────────────────────────────────────────────────────
	let nodes: KGNode[] = [];
	let edges: KGEdge[] = [];
	let isLoading = true;
	let errorMsg = "";

	// Layout state
	let layoutNodes: LayoutNode[] = [];
	let layoutEdges: LayoutEdge[] = [];

	// O(1) node lookup map (rebuilt after layout init)
	let nodeMap = new Map<string, LayoutNode>();

	// Canvas refs
	let canvas: HTMLCanvasElement;
	let ctx: CanvasRenderingContext2D;
	let canvasWidth = 800;
	let canvasHeight = 600;
	let dpr = 1;

	// Interaction state
	let graphState: RenderState = {
		hoveredNode: null,
		selectedNode: null,
		selectedEdge: null,
		tooltipPos: { x: 0, y: 0 },
		showTooltip: false
	};

	// Modal state
	let showAddEntityModal = false;
	let showAddRelationModal = false;
	let showDeleteConfirm = false;
	let deleteTarget: { type: "node" | "edge"; name?: string } | null = null;

	// ─── Helpers ────────────────────────────────────────────────────────────────

	function buildNodeMap(layoutNodes: LayoutNode[]): Map<string, LayoutNode> {
		const map = new Map<string, LayoutNode>();
		for (const n of layoutNodes) {
			map.set(n.id, n);
			map.set(n.name, n);
		}
		return map;
	}

	function scheduleRender() {
		if (ctx) {
			renderGraph(ctx, canvasWidth, canvasHeight, layoutNodes, layoutEdges, graphState);
		}
	}

	// ─── Load graph data ────────────────────────────────────────────────────────
	async function loadGraph() {
		if (!repo) return;
		isLoading = true;
		errorMsg = "";
		try {
			const data = await api.kgGraph(repo);
			nodes = data.nodes || [];
			edges = data.edges || [];
			initLayout();
		} catch (e: unknown) {
			errorMsg = e instanceof Error ? e.message : "Failed to load graph";
		} finally {
			isLoading = false;
		}
	}

	function initLayout() {
		if (!ctx) return;

		layoutNodes = initializeLayout(
			nodes.map((n) => ({
				id: n.id,
				name: n.name,
				type: n.type,
				description: n.description,
				memoryCount: n.memoryCount,
				x: 0,
				y: 0,
				vx: 0,
				vy: 0,
				pinned: false
			})),
			canvasWidth,
			canvasHeight
		);

		layoutEdges = edges.map((e) => ({
			source: e.source,
			target: e.target,
			relation_type: e.relation_type
		}));

		nodeMap = buildNodeMap(layoutNodes);
		runForceLayout(layoutNodes, layoutEdges, canvasWidth, canvasHeight);
		scheduleRender();
	}

	// ─── Canvas lifecycle ──────────────────────────────────────────────────────

	function handleResize() {
		if (!canvas) return;
		const result = resizeCanvasFn(canvas);
		canvasWidth = result.width;
		canvasHeight = result.height;
		dpr = result.dpr;
		ctx = result.ctx;
		if (layoutNodes.length > 0) {
			runForceLayout(layoutNodes, layoutEdges, canvasWidth, canvasHeight);
			scheduleRender();
		}
	}

	// ─── Interaction handlers ───────────────────────────────────────────────────

	function handleCanvasClick(e: MouseEvent) {
		const rect = canvas.getBoundingClientRect();
		const mx = e.clientX - rect.left;
		const my = e.clientY - rect.top;

		// Check nodes first (rendered on top)
		for (const n of layoutNodes) {
			const r = NODE_RADIUS + 4;
			const dx = mx - n.x;
			const dy = my - n.y;
			if (dx * dx + dy * dy <= r * r) {
				graphState.selectedNode = n;
				graphState.selectedEdge = null;
				graphState.tooltipPos = { x: mx, y: my };
				graphState.showTooltip = true;
				scheduleRender();
				return;
			}
		}

		// Check edges (distance to line segment)
		for (const e of layoutEdges) {
			const a = nodeMap.get(e.source);
			const b = nodeMap.get(e.target);
			if (!a || !b) continue;
			const dist = distToSegment(mx, my, a.x, a.y, b.x, b.y);
			if (dist < 10) {
				graphState.selectedEdge = e;
				graphState.selectedNode = null;
				graphState.showTooltip = false;
				scheduleRender();
				return;
			}
		}

		// Click on empty space
		graphState.selectedNode = null;
		graphState.selectedEdge = null;
		graphState.showTooltip = false;
		scheduleRender();
	}

	function handleCanvasDblClick(e: MouseEvent) {
		const rect = canvas.getBoundingClientRect();
		const mx = e.clientX - rect.left;
		const my = e.clientY - rect.top;

		for (const n of layoutNodes) {
			const r = NODE_RADIUS + 4;
			const dx = mx - n.x;
			const dy = my - n.y;
			if (dx * dx + dy * dy <= r * r) {
				deleteTarget = { type: "node", name: n.name };
				showDeleteConfirm = true;
				return;
			}
		}
	}

	function handleCanvasRightClick(e: MouseEvent) {
		e.preventDefault();
		const rect = canvas.getBoundingClientRect();
		const mx = e.clientX - rect.left;
		const my = e.clientY - rect.top;

		// Check edges
		for (const e of layoutEdges) {
			const a = nodeMap.get(e.source);
			const b = nodeMap.get(e.target);
			if (!a || !b) continue;
			const dist = distToSegment(mx, my, a.x, a.y, b.x, b.y);
			if (dist < 10) {
				deleteTarget = { type: "edge", name: `${e.source} → ${e.target} (${e.relation_type})` };
				showDeleteConfirm = true;
				return;
			}
		}
	}

	function handleCanvasMove(e: MouseEvent) {
		const rect = canvas.getBoundingClientRect();
		const mx = e.clientX - rect.left;
		const my = e.clientY - rect.top;

		let found: LayoutNode | null = null;
		for (const n of layoutNodes) {
			const r = NODE_RADIUS + 4;
			const dx = mx - n.x;
			const dy = my - n.y;
			if (dx * dx + dy * dy <= r * r) {
				found = n;
				break;
			}
		}

		if (found !== graphState.hoveredNode) {
			graphState.hoveredNode = found;
			canvas.style.cursor = found ? "pointer" : "default";
			scheduleRender();
		}
	}

	function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
		const dx = x2 - x1;
		const dy = y2 - y1;
		const len2 = dx * dx + dy * dy;
		if (len2 === 0) return Math.hypot(px - x1, py - y1);
		let t = ((px - x1) * dx + (py - y1) * dy) / len2;
		t = Math.max(0, Math.min(1, t));
		return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
	}

	// ─── Modal event handlers ──────────────────────────────────────────────────

	async function handleAddEntity(event: CustomEvent<{ name: string; type: string; description?: string }>) {
		const { name, type, description } = event.detail;
		try {
			await api.kgCreateEntity({ name, type, description, repo });
			showAddEntityModal = false;
			await loadGraph();
		} catch (e: unknown) {
			errorMsg = e instanceof Error ? e.message : "Failed to create entity";
		}
	}

	async function handleAddRelation(
		event: CustomEvent<{ from_entity: string; to_entity: string; relation_type: string }>
	) {
		const { from_entity, to_entity, relation_type } = event.detail;
		try {
			await api.kgCreateRelation({ from_entity, to_entity, relation_type, repo });
			showAddRelationModal = false;
			await loadGraph();
		} catch (e: unknown) {
			errorMsg = e instanceof Error ? e.message : "Failed to create relation";
		}
	}

	async function handleDelete() {
		if (!deleteTarget) return;
		try {
			if (deleteTarget.type === "node" && deleteTarget.name) {
				await api.kgDeleteEntity(deleteTarget.name);
			} else if (deleteTarget.type === "edge") {
				const e = graphState.selectedEdge;
				if (e) {
					await api.kgDeleteRelation({
						from_entity: e.source,
						to_entity: e.target,
						relation_type: e.relation_type
					});
				}
			}
			showDeleteConfirm = false;
			deleteTarget = null;
			graphState.selectedEdge = null;
			graphState.selectedNode = null;
			graphState.showTooltip = false;
			await loadGraph();
		} catch (e: unknown) {
			errorMsg = e instanceof Error ? e.message : "Failed to delete";
		}
	}

	function cancelDelete() {
		showDeleteConfirm = false;
		deleteTarget = null;
	}

	// ─── Keyboard dismiss ──────────────────────────────────────────────────────

	function onKeyDown(e: KeyboardEvent) {
		if (e.key === "Escape") {
			graphState.showTooltip = false;
			graphState.selectedNode = null;
			graphState.selectedEdge = null;
			showDeleteConfirm = false;
			showAddEntityModal = false;
			showAddRelationModal = false;
			scheduleRender();
		}
	}

	// ─── Lifecycle ─────────────────────────────────────────────────────────────
	let resizeObserver: ResizeObserver | null = null;

	onMount(() => {
		if (canvas) {
			const result = resizeCanvasFn(canvas);
			canvasWidth = result.width;
			canvasHeight = result.height;
			dpr = result.dpr;
			ctx = result.ctx;
		}

		if (repo) loadGraph();

		resizeObserver = new ResizeObserver(() => handleResize());
		if (canvas?.parentElement) {
			resizeObserver.observe(canvas.parentElement);
		}
	});

	onDestroy(() => {
		resizeObserver?.disconnect();
	});

	// Re-load when repo changes
	$: if (repo && canvas) {
		loadGraph();
	}
</script>

<svelte:window on:keydown={onKeyDown} />

<div class="kg-container">
	<!-- Toolbar -->
	<div class="kg-toolbar">
		<div class="kg-toolbar-left">
			<span class="section-label" style="font-size:0.68rem;">
				<Icon name="share-2" size={12} strokeWidth={1.75} />
				Knowledge Graph
			</span>
			<span class="kg-stats">
				{nodes.length} nodes · {edges.length} edges
			</span>
		</div>
		<div class="kg-toolbar-right">
			<button class="btn btn-ghost btn-sm" on:click={() => (showAddEntityModal = true)}>
				<Icon name="plus" size={12} strokeWidth={2} />
				Add Entity
			</button>
			<button class="btn btn-ghost btn-sm" on:click={() => (showAddRelationModal = true)}>
				<Icon name="link" size={12} strokeWidth={2} />
				Add Relation
			</button>
			<button class="btn btn-ghost btn-sm" on:click={loadGraph} disabled={isLoading}>
				<Icon name="refresh-cw" size={12} strokeWidth={2} className={isLoading ? "animate-spin" : ""} />
				Refresh
			</button>
		</div>
	</div>

	<!-- Error -->
	{#if errorMsg}
		<div class="kg-error">
			<Icon name="triangle-alert" size={14} strokeWidth={1.75} />
			{errorMsg}
		</div>
	{/if}

	<!-- Loading / Empty / Canvas -->
	{#if isLoading}
		<div class="kg-loading">
			<div
				class="animate-spin"
				style="width:24px;height:24px;border:3px solid var(--color-border);border-top-color:var(--color-primary);border-radius:50%;"
			></div>
			<span>Loading graph...</span>
		</div>
	{:else if layoutNodes.length === 0}
		<div class="kg-empty">
			<Icon name="share-2" size={32} strokeWidth={1.25} className="" />
			<div>No knowledge graph data found</div>
			<div class="text-xs" style="color:var(--color-text-muted);">Add entities and relations to build your graph.</div>
		</div>
	{:else}
		<div class="kg-canvas-wrap">
			<canvas
				bind:this={canvas}
				on:click={handleCanvasClick}
				on:dblclick={handleCanvasDblClick}
				on:contextmenu={handleCanvasRightClick}
				on:mousemove={handleCanvasMove}
				aria-label="Knowledge Graph visualization"
				tabindex="0"
			></canvas>
		</div>
	{/if}

	<!-- Modals -->
	<KGModal
		mode="addEntity"
		show={showAddEntityModal}
		on:addEntity={handleAddEntity}
		on:close={() => (showAddEntityModal = false)}
	/>

	<KGModal
		mode="addRelation"
		show={showAddRelationModal}
		entityNodes={layoutNodes}
		on:addRelation={handleAddRelation}
		on:close={() => (showAddRelationModal = false)}
	/>

	<KGModal
		mode="deleteConfirm"
		show={showDeleteConfirm}
		{deleteTarget}
		on:delete={handleDelete}
		on:close={cancelDelete}
	/>
</div>

<style>
	.kg-container {
		display: flex;
		flex-direction: column;
		height: calc(100vh - 180px);
		border-radius: 24px;
		overflow: hidden;
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		box-shadow: var(--glass-shadow);
		backdrop-filter: var(--glass-blur);
		-webkit-backdrop-filter: var(--glass-blur);
	}

	:global(.dark) .kg-container {
		background: var(--panel-dark);
		border-color: var(--panel-dark-border);
		box-shadow: var(--panel-dark-shadow);
	}

	.kg-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
		border-bottom: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.05);
		flex-shrink: 0;
	}

	:global(.dark) .kg-toolbar {
		border-color: rgba(148, 163, 184, 0.1);
	}

	.kg-toolbar-left {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.kg-toolbar-right {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.kg-stats {
		font-size: 0.72rem;
		color: var(--color-text-muted);
		font-weight: 600;
	}

	.kg-canvas-wrap {
		flex: 1;
		overflow: hidden;
		position: relative;
	}

	.kg-canvas-wrap canvas {
		display: block;
		width: 100%;
		height: 100%;
	}

	.kg-error {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 16px;
		background: rgba(239, 68, 68, 0.08);
		color: var(--color-danger);
		font-size: 0.8rem;
		font-weight: 600;
		border-bottom: 1px solid rgba(239, 68, 68, 0.15);
	}

	.kg-loading,
	.kg-empty {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		color: var(--color-text-muted);
		font-size: 0.85rem;
	}

	.kg-empty :global(svg) {
		opacity: 0.3;
	}
</style>
