<script lang="ts">
	import { onMount, onDestroy, createEventDispatcher } from "svelte";
	import { NODE_RADIUS } from "$lib/kg/KGForceLayout";
	import type { LayoutNode, LayoutEdge } from "$lib/kg/KGForceLayout";
	import {
		startNeuralAnimation,
		stopNeuralAnimation,
		updateAnimationData,
		updateNeuralDimensions,
		zoomCamera,
		startDragCamera,
		dragCamera,
		endDragCamera,
		resetCamera,
		getZoomPercent,
		isCameraDragging
	} from "$lib/kg/KGNeuralRenderer";
	import type { NeuralRenderState } from "$lib/kg/KGNeuralRenderer";

	// ─── Props ─────────────────────────────────────────────────────────────────
	export let layoutNodes: LayoutNode[] = [];
	export let layoutEdges: LayoutEdge[] = [];
	export let getNodeByKey: (key: string) => LayoutNode | undefined = () => undefined;
	export let graphState: NeuralRenderState;
	export let isZeroEdgeOverview = false;
	export let nodeCount = 0;

	// Interaction callbacks (parent handles modal/drawer state)
	export let onDetailEntityChange: (name: string) => void = () => {};
	export let onDeleteNodeRequest: (name: string) => void = () => {};
	export let onDeleteEdgeRequest: (source: string, target: string, relationType: string) => void = () => {};
	export let onResize: (width: number, height: number) => void = () => {};
	export let onZoomPercentChange: (pct: number) => void = () => {};

	// Canvas state
	let canvas: HTMLCanvasElement;
	const dispatch = createEventDispatcher();
	let ctx: CanvasRenderingContext2D | null = null;
	let canvasWidth = 800;
	let canvasHeight = 600;

	// Interaction tracking
	let dragStartPos: { x: number; y: number } | null = null;
	let didDrag = false;
	let zoomPercent = 100;
	let lastPinchDist = 0;

	// Animation
	let animationCleanup: (() => void) | null = null;
	let canvasReady = false;

	// ─── Lifecycle ─────────────────────────────────────────────────────────────
	let resizeObserver: ResizeObserver | null = null;

	onMount(() => {
		if (!canvas) return;
		updateNeuralDimensions(canvas);
		const dpr = window.devicePixelRatio || 1;
		canvasWidth = canvas.width / dpr;
		canvasHeight = canvas.height / dpr;
		ctx = canvas.getContext("2d");
		canvasReady = true;
		dispatch("ready");

		resizeObserver = new ResizeObserver(() => handleResize());
		if (canvas.parentElement) {
			resizeObserver.observe(canvas.parentElement);
		}
	});

	onDestroy(() => {
		resizeObserver?.disconnect();
		resizeObserver = null;
		stopNeuralAnimation();
		animationCleanup = null;
	});

	function handleResize() {
		if (!canvas) return;
		updateNeuralDimensions(canvas);
		const dpr = window.devicePixelRatio || 1;
		canvasWidth = canvas.width / dpr;
		canvasHeight = canvas.height / dpr;
		ctx = canvas.getContext("2d")!;
		onResize(canvasWidth, canvasHeight);
	}

	// ─── React to layout data changes ──────────────────────────────────────────

	function ensureAnimation() {
		if (animationCleanup) {
			updateAnimationData(layoutNodes, layoutEdges);
		} else if (ctx) {
			animationCleanup = startNeuralAnimation(canvas, canvasWidth, canvasHeight, layoutNodes, layoutEdges, graphState);
		}
	}

	$: if (layoutNodes.length > 0 && ctx && canvasReady) {
		ensureAnimation();
	}

	// ─── Interaction handlers ───────────────────────────────────────────────────

	function handleCanvasClick(e: MouseEvent) {
		if (didDrag) return;

		const rect = canvas.getBoundingClientRect();
		const mx = e.clientX - rect.left;
		const my = e.clientY - rect.top;

		for (const n of layoutNodes) {
			const r = NODE_RADIUS + 4;
			const dx = mx - n.x;
			const dy = my - n.y;
			if (dx * dx + dy * dy <= r * r) {
				graphState.selectedNode = n;
				graphState.selectedEdge = null;
				graphState.showTooltip = false;
				onDetailEntityChange(n.name);
				return;
			}
		}

		for (const e of layoutEdges) {
			const a = getNodeByKey(e.source);
			const b = getNodeByKey(e.target);
			if (!a || !b) continue;
			const dist = distToSegment(mx, my, a.x, a.y, b.x, b.y);
			if (dist < 10) {
				graphState.selectedEdge = e;
				graphState.selectedNode = null;
				graphState.showTooltip = false;
				onDetailEntityChange("");
				return;
			}
		}

		graphState.selectedNode = null;
		graphState.selectedEdge = null;
		graphState.showTooltip = false;
		onDetailEntityChange("");
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
				graphState.selectedNode = n;
				onDetailEntityChange("");
				onDeleteNodeRequest(n.name);
				return;
			}
		}
	}

	function handleCanvasRightClick(e: MouseEvent) {
		e.preventDefault();
		const rect = canvas.getBoundingClientRect();
		const mx = e.clientX - rect.left;
		const my = e.clientY - rect.top;

		for (const e of layoutEdges) {
			const a = getNodeByKey(e.source);
			const b = getNodeByKey(e.target);
			if (!a || !b) continue;
			const dist = distToSegment(mx, my, a.x, a.y, b.x, b.y);
			if (dist < 10) {
				graphState.selectedEdge = e;
				graphState.selectedNode = null;
				onDeleteEdgeRequest(e.source, e.target, e.relation_type);
				return;
			}
		}
	}

	function handleCanvasMove(e: MouseEvent) {
		const rect = canvas.getBoundingClientRect();
		const mx = e.clientX - rect.left;
		const my = e.clientY - rect.top;

		if (isCameraDragging()) return;

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
		}
	}

	// ─── Zoom & Drag handlers ───────────────────────────────────────────────

	function handleWheel(e: WheelEvent) {
		e.preventDefault();
		zoomCamera(e.deltaY);
		zoomPercent = getZoomPercent();
		onZoomPercentChange(zoomPercent);
	}

	function handleMouseDown(e: MouseEvent) {
		if (e.button !== 0) return;
		dragStartPos = { x: e.clientX, y: e.clientY };
		didDrag = false;
		startDragCamera(e.clientX, e.clientY);
	}

	function handleMouseMoveForDrag(e: MouseEvent) {
		if (!dragStartPos) return;
		const dx = e.clientX - dragStartPos.x;
		const dy = e.clientY - dragStartPos.y;
		if (!didDrag && Math.hypot(dx, dy) > 3) {
			didDrag = true;
		}
		if (didDrag) {
			dragCamera(e.clientX, e.clientY);
			canvas.style.cursor = "grabbing";
		}
	}

	function handleMouseUp(_e: MouseEvent) {
		if (dragStartPos) {
			endDragCamera();
			dragStartPos = null;
			didDrag = false;
			canvas.style.cursor = "default";
		}
	}

	function handleMouseLeave(_e: MouseEvent) {
		if (dragStartPos) {
			endDragCamera();
			dragStartPos = null;
			didDrag = false;
			canvas.style.cursor = "default";
		}
	}

	// ─── Touch pinch zoom ───────────────────────────────────────────────────

	function getPinchDist(t1: Touch, t2: Touch): number {
		return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
	}

	function handleTouchStart(e: TouchEvent) {
		if (e.touches.length === 2) {
			e.preventDefault();
			lastPinchDist = getPinchDist(e.touches[0], e.touches[1]);
		} else if (e.touches.length === 1) {
			const t = e.touches[0];
			startDragCamera(t.clientX, t.clientY);
			dragStartPos = { x: t.clientX, y: t.clientY };
			didDrag = false;
		}
	}

	function handleTouchMove(e: TouchEvent) {
		if (e.touches.length === 2) {
			e.preventDefault();
			const dist = getPinchDist(e.touches[0], e.touches[1]);
			if (lastPinchDist > 0) {
				const delta = lastPinchDist - dist;
				zoomCamera(delta * 0.5);
				zoomPercent = getZoomPercent();
				onZoomPercentChange(zoomPercent);
			}
			lastPinchDist = dist;
		} else if (e.touches.length === 1 && dragStartPos) {
			const t = e.touches[0];
			const dx = t.clientX - dragStartPos.x;
			const dy = t.clientY - dragStartPos.y;
			if (!didDrag && Math.hypot(dx, dy) > 3) {
				didDrag = true;
			}
			if (didDrag) {
				dragCamera(t.clientX, t.clientY);
			}
		}
	}

	function handleTouchEnd(e: TouchEvent) {
		if (e.touches.length < 2) {
			lastPinchDist = 0;
		}
		if (e.touches.length === 0) {
			endDragCamera();
			dragStartPos = null;
			didDrag = false;
		}
	}

	// ─── Zoom control exports (used by parent via bind:this) ────────────────

	export function handleZoomIn() {
		zoomCamera(-10);
		zoomPercent = getZoomPercent();
		onZoomPercentChange(zoomPercent);
	}

	export function handleZoomOut() {
		zoomCamera(10);
		zoomPercent = getZoomPercent();
		onZoomPercentChange(zoomPercent);
	}

	export function handleResetCamera() {
		resetCamera();
		zoomPercent = getZoomPercent();
		onZoomPercentChange(zoomPercent);
	}

	// ─── Geometry helper ────────────────────────────────────────────────────

	function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
		const dx = x2 - x1;
		const dy = y2 - y1;
		const len2 = dx * dx + dy * dy;
		if (len2 === 0) return Math.hypot(px - x1, py - y1);
		let t = ((px - x1) * dx + (py - y1) * dy) / len2;
		t = Math.max(0, Math.min(1, t));
		return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
	}
</script>

<canvas
	bind:this={canvas}
	on:click={handleCanvasClick}
	on:dblclick={handleCanvasDblClick}
	on:contextmenu={handleCanvasRightClick}
	on:mousemove={handleCanvasMove}
	on:mousemove={handleMouseMoveForDrag}
	on:mousedown={handleMouseDown}
	on:mouseup={handleMouseUp}
	on:mouseleave={handleMouseLeave}
	on:wheel={handleWheel}
	on:touchstart={handleTouchStart}
	on:touchmove={handleTouchMove}
	on:touchend={handleTouchEnd}
	aria-label={isZeroEdgeOverview
		? `Knowledge Graph zero-relation overview showing ${layoutNodes.length} of ${nodeCount} entities`
		: "Knowledge Graph visualization"}
	tabindex="0"
></canvas>
