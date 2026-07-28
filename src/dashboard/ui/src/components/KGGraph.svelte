<script lang="ts">
	import { untrack } from "svelte";
	import { onMount, onDestroy } from "svelte";
	import { api } from "$lib/api";
	import Icon from "$lib/Icon.svelte";
	import type { KGNode, KGEdge } from "$lib/interfaces";
	import { initializeSphereLayout, initializeZeroEdgeOverviewLayout } from "$lib/kg/KGForceLayout";
	import type { LayoutNode, LayoutEdge } from "$lib/kg/KGForceLayout";
	import { handleGraphKeyDown } from "$lib/kg/kgKeyboardShortcuts";
	import KGGraphHeader from "./KGGraphHeader.svelte";
	import KGGraphShell from "./KGGraphShell.svelte";
	import KGGraphCanvas from "./KGGraphCanvas.svelte";
	import KGModal from "./KGModal.svelte";
	import KGEntityDrawer from "./KGEntityDrawer.svelte";

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

	// Canvas dimensions (managed by KGGraphCanvas, used by initLayout)
	let canvasWidth = 800;
	let canvasHeight = 600;
	let canvasReady = false;

	// Interaction state (shared with KGGraphCanvas via reference)
	let graphState = {
		hoveredNode: null as LayoutNode | null,
		selectedNode: null as LayoutNode | null,
		selectedEdge: null as LayoutEdge | null,
		tooltipPos: { x: 0, y: 0 },
		showTooltip: false,
		hiddenNodeCount: 0
	};

	// Entity detail panel state (managed by KGEntityDrawer)
	let detailEntityName = "";

	// Tracked to sync zoom percent from canvas to header
	let zoomPercent = 100;

	// Modal state
	let showAddEntityModal = false;
	let showAddRelationModal = false;
	let showDeleteConfirm = false;
	type DeleteTarget = { type: "node"; name: string } | { type: "edge"; name: string; edge: LayoutEdge };
	let deleteTarget: DeleteTarget | null = null;

	// KGGraphCanvas component reference for exported functions
	let kgCanvasRef: KGGraphCanvas;

	// ─── Canvas callbacks ───────────────────────────────────────────────────────

	function handleCanvasReady() {
		canvasReady = true;
	}

	function handleCanvasResize(w: number, h: number) {
		canvasWidth = w;
		canvasHeight = h;
	}

	function handleDetailEntityChange(name: string) {
		detailEntityName = name;
	}

	function handleDeleteNodeRequest(name: string) {
		deleteTarget = { type: "node", name };
		showDeleteConfirm = true;
	}

	function handleDeleteEdgeRequest(source: string, target: string, relationType: string) {
		deleteTarget = {
			type: "edge",
			name: `${source} → ${target} (${relationType})`,
			edge: { source, target, relation_type: relationType }
		};
		showDeleteConfirm = true;
	}

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

	// ─── Load graph data ────────────────────────────────────────────────────────
	async function loadGraph(forceReload = false) {
		if (!repo) return;
		const requestedRepo = repo;
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
		detailEntityName = "";
	}

	function initLayout() {
		isZeroEdgeOverview = edges.length === 0 && nodes.length > 0;

		if (isZeroEdgeOverview) {
			const result = initializeZeroEdgeOverviewLayout(
				nodes.map((n) => ({
					id: n.id || n.name,
					name: n.name,
					type: n.type,
					description: n.description,
					memoryCount: n.memoryCount,
					x: 0,
					y: 0,
					z: 0,
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
			return;
		}

		// Select top nodes by edge connectivity (degree) to maximize edge coverage
		const degreeMap = new Map<string, number>();
		for (const e of edges) {
			degreeMap.set(e.source, (degreeMap.get(e.source) ?? 0) + 1);
			degreeMap.set(e.target, (degreeMap.get(e.target) ?? 0) + 1);
		}

		const sortedNodes = [...nodes].sort((a, b) => {
			const degA = degreeMap.get(a.name) ?? 0;
			const degB = degreeMap.get(b.name) ?? 0;
			if (degB !== degA) return degB - degA;
			return a.name.localeCompare(b.name);
		});

		const edgeNodeNames = new Set<string>();
		for (const e of edges) {
			edgeNodeNames.add(e.source);
			edgeNodeNames.add(e.target);
		}

		const selectedNames = new Set<string>();
		const selectedNodes: typeof nodes = [];
		for (const n of sortedNodes) {
			if (selectedNodes.length >= MAX_FORCE_NODES) break;
			if (!selectedNames.has(n.name)) {
				selectedNames.add(n.name);
				selectedNodes.push(n);
			}
		}
		for (const n of nodes) {
			if (selectedNodes.length >= MAX_FORCE_NODES) break;
			if (edgeNodeNames.has(n.name) && !selectedNames.has(n.name)) {
				selectedNames.add(n.name);
				selectedNodes.push(n);
			}
		}

		const cappedNodes = selectedNodes;
		const cappedNodeNames = selectedNames;

		layoutEdges = edges
			.filter((e) => cappedNodeNames.has(e.source) && cappedNodeNames.has(e.target))
			.map((e) => ({
				source: e.source,
				target: e.target,
				relation_type: e.relation_type
			}));

		layoutNodes = initializeSphereLayout(
			cappedNodes.map((n) => ({
				id: n.id || n.name,
				name: n.name,
				type: n.type,
				description: n.description,
				memoryCount: n.memoryCount,
				x: 0,
				y: 0,
				z: 0,
				vx: 0,
				vy: 0,
				pinned: false
			})),
			layoutEdges,
			canvasWidth,
			canvasHeight
		);

		hiddenZeroEdgeNodeCount = Math.max(0, nodes.length - cappedNodes.length);
		nodeLookup = buildNodeLookup(layoutNodes);
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

	function clearSelectionAndCloseAll() {
		graphState.showTooltip = false;
		graphState.selectedNode = null;
		graphState.selectedEdge = null;
		showDeleteConfirm = false;
		showAddEntityModal = false;
		showAddRelationModal = false;
		detailEntityName = "";
	}

	function onKeyDown(e: KeyboardEvent) {
		handleGraphKeyDown(e, { clearSelectionAndCloseAll });
	}

	// ─── Lifecycle ─────────────────────────────────────────────────────────────

	onMount(() => {
		// Canvas init is handled by KGGraphCanvas — it fires handleCanvasReady
	});

	onDestroy(() => {
		// Animation cleanup is handled by KGGraphCanvas
	});

	// Re-load when repo changes (guarded inside loadGraph against noop)
	$: if (repo && canvasReady && loadedRepo !== repo) {
		// eslint-disable-next-line svelte/infinite-reactive-loop -- loadGraph updates loadedRepo to satisfy this repo-change guard.
		untrack(() => loadGraph());
	}

	function handleNavigateToEntity(name: string) {
		const foundNode = layoutNodes.find((n) => n.name === name);
		if (foundNode) {
			graphState.selectedNode = foundNode;
			detailEntityName = name;
		}
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
		{zoomPercent}
		onAddEntity={() => (showAddEntityModal = true)}
		onAddRelation={() => (showAddRelationModal = true)}
		onRefresh={() => loadGraph(true)}
		onZoomIn={() => kgCanvasRef?.handleZoomIn()}
		onZoomOut={() => kgCanvasRef?.handleZoomOut()}
		onResetCamera={() => kgCanvasRef?.handleResetCamera()}
	/>

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
	{/if}
	<div class="kg-canvas-wrap" class:kg-hidden={isLoading || layoutNodes.length === 0}>
		<KGGraphCanvas
			{layoutNodes}
			{layoutEdges}
			{getNodeByKey}
			{graphState}
			{isZeroEdgeOverview}
			nodeCount={nodes.length}
			onDetailEntityChange={handleDetailEntityChange}
			onDeleteNodeRequest={handleDeleteNodeRequest}
			onDeleteEdgeRequest={handleDeleteEdgeRequest}
			onResize={handleCanvasResize}
			onZoomPercentChange={(pct) => (zoomPercent = pct)}
			bind:this={kgCanvasRef}
		/>
		<KGEntityDrawer
			entityName={detailEntityName}
			onclose={() => {
				detailEntityName = "";
				graphState.selectedNode = null;
			}}
			onnavigate={handleNavigateToEntity}
		/>
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
