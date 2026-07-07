<script lang="ts">
	import { untrack } from "svelte";
	import { onMount, onDestroy } from "svelte";
	import { api } from "$lib/api";
	import Icon from "$lib/Icon.svelte";
	import type { KGNode, KGEdge } from "$lib/interfaces";
	import { initializeLayout, initializeZeroEdgeOverviewLayout, runForceLayout } from "$lib/kg/KGForceLayout";
	import type { LayoutNode, LayoutEdge } from "$lib/kg/KGForceLayout";
	import { NODE_RADIUS, resizeCanvas as resizeCanvasFn, renderGraph } from "$lib/kg/KGCanvasRenderer";
	import type { RenderState } from "$lib/kg/KGCanvasRenderer";
	import KGGraphHeader from "./KGGraphHeader.svelte";
	import KGGraphShell from "./KGGraphShell.svelte";
	import KGModal from "./KGModal.svelte";

	export let repo: string;

	// ─── State ─────────────────────────────────────────────────────────────────
	let nodes: KGNode[] = [];
	let edges: KGEdge[] = [];
	let isLoading = true;
	let errorMsg = "";
	let loadedRepo = "";
	let isZeroEdgeOverview = false;
	let hiddenZeroEdgeNodeCount = 0;

	// Limit nodes for force layout to prevent browser freeze
	const MAX_FORCE_NODES = 300;

	// Layout state
	let layoutNodes: LayoutNode[] = [];
	let layoutEdges: LayoutEdge[] = [];

	// O(1) node lookup map (rebuilt after layout init)
	let nodeLookup = new Map<string, LayoutNode>();

	function getNodeByKey(key: string): LayoutNode | undefined {
		return nodeLookup.get(key);
	}

	// Canvas refs
	let canvas: HTMLCanvasElement;
	let ctx: CanvasRenderingContext2D;
	let canvasWidth = 800;
	let canvasHeight = 600;

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
	type DeleteTarget = { type: "node"; name: string } | { type: "edge"; name: string; edge: LayoutEdge };
	let deleteTarget: DeleteTarget | null = null;

	// ─── Helpers ────────────────────────────────────────────────────────────────

	const EMPTY_NODE_LOOKUP = new Map<string, LayoutNode>();

	function buildNodeLookup(layoutNodes: LayoutNode[]): Map<string, LayoutNode> {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Lookup is built once and treated as immutable.
		const lookup = new Map<string, LayoutNode>();
		for (const n of layoutNodes) {
			lookup.set(n.id, n);
			lookup.set(n.name, n);
		}
		return lookup;
	}

	function scheduleRender() {
		if (ctx) {
			renderGraph(ctx, canvasWidth, canvasHeight, layoutNodes, layoutEdges, {
				...graphState,
				hiddenNodeCount: hiddenZeroEdgeNodeCount
			});
		}
	}

	// ─── Load graph data ────────────────────────────────────────────────────────
	async function loadGraph(forceReload = false) {
		if (!repo) return;
		const requestedRepo = repo;
		// Guard: skip if already loaded for this repo (unless force reload)
		if (!forceReload && loadedRepo === requestedRepo && layoutNodes.length > 0) return;
		isLoading = true;
		errorMsg = "";
		clearGraph();
		try {
			const data = await api.kgGraph(requestedRepo);
			if (repo !== requestedRepo) return;
			nodes = data.nodes || [];
			edges = data.edges || [];
			// eslint-disable-next-line svelte/infinite-reactive-loop -- load result is guarded by requestedRepo snapshot.
			loadedRepo = requestedRepo;
			initLayout();
		} catch (e: unknown) {
			if (repo !== requestedRepo) return;
			// eslint-disable-next-line svelte/infinite-reactive-loop -- failed load clears guard to allow retry for the same repo.
			loadedRepo = "";
			errorMsg = e instanceof Error ? e.message : "Failed to load graph";
		} finally {
			if (repo === requestedRepo) {
				isLoading = false;
			}
		}
	}

	function clearGraph() {
		nodes = [];
		edges = [];
		layoutNodes = [];
		layoutEdges = [];
		nodeLookup = EMPTY_NODE_LOOKUP;
		isZeroEdgeOverview = false;
		hiddenZeroEdgeNodeCount = 0;
		graphState.selectedNode = null;
		graphState.selectedEdge = null;
		graphState.hoveredNode = null;
		graphState.showTooltip = false;
		scheduleRender();
	}

	function initLayout() {
		if (!ctx) return;

		isZeroEdgeOverview = edges.length === 0 && nodes.length > 0;

		if (isZeroEdgeOverview) {
			const result = initializeZeroEdgeOverviewLayout(
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
			layoutNodes = result;
			hiddenZeroEdgeNodeCount = Math.max(0, nodes.length - result.length);
			layoutEdges = [];
			nodeLookup = buildNodeLookup(layoutNodes);
			scheduleRender();
			return;
		}

		const cappedNodes = nodes.slice(0, MAX_FORCE_NODES);
		const cappedNodeNames = new Set(cappedNodes.map((n) => n.name));

		layoutNodes = initializeLayout(
			cappedNodes.map((n) => ({
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

		layoutEdges = edges
			.filter((e) => cappedNodeNames.has(e.source) && cappedNodeNames.has(e.target))
			.map((e) => ({
				source: e.source,
				target: e.target,
				relation_type: e.relation_type
			}));
		hiddenZeroEdgeNodeCount = Math.max(0, nodes.length - cappedNodes.length);

		nodeLookup = buildNodeLookup(layoutNodes);
		runForceLayout(layoutNodes, layoutEdges, canvasWidth, canvasHeight);
		scheduleRender();
	}

	// ─── Canvas lifecycle ──────────────────────────────────────────────────────

	function handleResize() {
		if (!canvas) return;
		const result = resizeCanvasFn(canvas);
		canvasWidth = result.width;
		canvasHeight = result.height;
		ctx = result.ctx;
		if (layoutNodes.length > 0) {
			if (isZeroEdgeOverview) {
				initLayout();
				return;
			}
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
			const a = getNodeByKey(e.source);
			const b = getNodeByKey(e.target);
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
			const a = getNodeByKey(e.source);
			const b = getNodeByKey(e.target);
			if (!a || !b) continue;
			const dist = distToSegment(mx, my, a.x, a.y, b.x, b.y);
			if (dist < 10) {
				deleteTarget = { type: "edge", name: `${e.source} → ${e.target} (${e.relation_type})`, edge: e };
				graphState.selectedEdge = e;
				graphState.selectedNode = null;
				showDeleteConfirm = true;
				scheduleRender();
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
			await loadGraph(true);
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
			await loadGraph(true);
		} catch (e: unknown) {
			errorMsg = e instanceof Error ? e.message : "Failed to create relation";
		}
	}

	async function handleDelete() {
		if (!deleteTarget) return;
		try {
			if (deleteTarget.type === "node") {
				await api.kgDeleteEntity(deleteTarget.name);
			} else if (deleteTarget.type === "edge") {
				const e = deleteTarget.edge;
				await api.kgDeleteRelation({
					from_entity: e.source,
					to_entity: e.target,
					relation_type: e.relation_type
				});
			}
			showDeleteConfirm = false;
			deleteTarget = null;
			graphState.selectedEdge = null;
			graphState.selectedNode = null;
			graphState.showTooltip = false;
			await loadGraph(true);
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

	// Re-load when repo changes (guarded inside loadGraph against noop)
	$: if (repo && canvas && loadedRepo !== repo) {
		// eslint-disable-next-line svelte/infinite-reactive-loop -- loadGraph updates loadedRepo to satisfy this repo-change guard.
		untrack(() => loadGraph());
	}
</script>

<svelte:window on:keydown={onKeyDown} />

<KGGraphShell>
	<KGGraphHeader
		nodeCount={nodes.length}
		edgeCount={edges.length}
		{isLoading}
		{errorMsg}
		{isZeroEdgeOverview}
		visibleNodeCount={layoutNodes.length}
		hiddenNodeCount={hiddenZeroEdgeNodeCount}
		onAddEntity={() => (showAddEntityModal = true)}
		onAddRelation={() => (showAddRelationModal = true)}
		onRefresh={() => loadGraph(true)}
	/>

	<!-- Loading / Empty / Canvas (canvas always in DOM for context) -->
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
	{/if}
	<div class="kg-canvas-wrap" class:kg-hidden={isLoading || layoutNodes.length === 0}>
		<canvas
			bind:this={canvas}
			on:click={handleCanvasClick}
			on:dblclick={handleCanvasDblClick}
			on:contextmenu={handleCanvasRightClick}
			on:mousemove={handleCanvasMove}
			aria-label={isZeroEdgeOverview
				? `Knowledge Graph zero-relation overview showing ${layoutNodes.length} of ${nodes.length} entities`
				: "Knowledge Graph visualization"}
			tabindex="0"
		></canvas>
	</div>

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
</KGGraphShell>
