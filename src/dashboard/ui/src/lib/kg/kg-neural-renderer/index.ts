/**
 * Main animation orchestrator for the Knowledge Graph Neural Renderer.
 *
 * Manages module-level state, camera controls, and the animation loop.
 */

import type { LayoutNode, LayoutEdge } from "../KGForceLayout";
import { NODE_RADIUS } from "../KGForceLayout";
import {
	project3D,
	drawBackground,
	fogFactor,
	resizeNeuralCanvas,
	isDarkMode,
	getNodeColor,
	roundRect,
	computeRotationTrig,
	FOG_FAR,
	BREATHE_SPEED,
	BREATHE_AMOUNT,
	TWINKLE_SPEED,
	PARTICLE_BASE_RADIUS,
	PARTICLE_IMPORTANT_RADIUS,
	PARTICLE_SUBTLE_MIN
} from "./layout";
import {
	drawParticle,
	drawTooltip,
	drawOverflowNotice,
	getSignalHaloGradient,
	SIGNAL_HALO_REF_RADIUS,
	type NeuralRenderState
} from "./nodes";
import { drawEdge3D, drawEdgeLabel3D } from "./edges";
import {
	EDGE_ALPHA_MULTIPLIERS,
	EDGE_BUCKET_COLORS,
	formatEdgeConfidenceLabel,
	getEdgeConfidenceBucket,
	type EdgeConfidenceBucket,
	type EdgeConfidenceColor
} from "../edgeConfidence";
import type { Node3D, ProjectedNode } from "./layout";
import {
	updateCamera,
	zoomCamera,
	startDragCamera,
	dragCamera,
	endDragCamera,
	resetCamera,
	getZoomPercent,
	isCameraDragging,
	isZoomAnimating,
	resetAutoRotationClock
} from "./camera";
import { spawnSignals, updateSignals, getSignals, clearSignals } from "./signals";

// Re-export public type for consumers
export type { NeuralRenderState };

// Re-export camera API for consumers
export { zoomCamera, startDragCamera, dragCamera, endDragCamera, resetCamera, getZoomPercent, isCameraDragging };

// ─── Module-Level Animation State ────────────────────────────────────────────

let animationId: number | null = null;
let currentCleanup: (() => void) | null = null;

// Pause/resume control (TASK-189). `running` is the manual control used by
// consumers (e.g. KGGraph stops the loop when the KG tab unmounts);
// `isTabHidden` snapshots document.visibilitychange so the RAF loop also
// pauses when the browser tab is hidden. Both must be true for the loop to
// schedule frames — no rendering work happens while either is false.
let running = false;
let isTabHidden = false;

// Hook into the active animation instance so the module-level resume()
// control can re-anchor the frame clock (avoids a large dt jump after a
// pause/hidden period) and restart scheduling. Only the single active
// animation sets this; cleared on cleanup.
let currentResumeHook: (() => void) | null = null;

let animNodes: LayoutNode[] = [];
let animEdges: LayoutEdge[] = [];
let animDataDirty = false;

let width = 0;
let height = 0;
let cx = 0;
let cy = 0;
// Effective backing-store DPR for the active canvas (set on start/resize).
// Used to restore the backing resolution after a drag (see render()).
let backingDpr = 1;

// ─── Settle / Freeze Control (TASK-277, audit F3 round 2) ───────────────────
// Root cause of the round-1 jank: the RAF loop rendered the FULL scene every
// frame forever — continuous camera auto-rotation + signal spawning + node
// projection + grid rebuild + edge/node raster — even when the graph was
// fully settled (audit measured idle 6.7fps / 3.7fps settled and up to 393ms
// long tasks, while the static control tab ran 40.8fps with 0 long tasks;
// i.e. a static render is cheap — the CONTINUOUS loop is the cost).
//
// Fix: settle detection + freeze. After SETTLE_FREEZE_FRAMES consecutive
// "quiet" frames (no drag, no zoom lerp, no pending data mutation, no
// hover/selection/tooltip change) the graph enters frozen mode: the RAF
// slot keeps firing but each frozen frame only performs a cheap O(1) wake
// check — NO render, NO signals, NO projection, NO draw. Any of the wake
// conditions (drag / hover change / zoom / resize / data mutation /
// selection change) instantly unfreezes and renders a short animation burst
// — including camera auto-rotation — before settling again.
//
// While frozen, hit-testing keeps working: the retained spatial grid matches
// the (now static) node positions exactly, so queryNodeCandidates() is still
// accurate without any per-frame rebuild.
const SETTLE_FREEZE_FRAMES = 20;
// Time-based freeze guard: freeze after SETTLE_FREEZE_MS of quiet time even if
// fewer than SETTLE_FREEZE_FRAMES have rendered. Expensive frames (e.g. the
// full-resolution settle burst right after a drag) would otherwise stretch the
// frame-count freeze delay linearly with frame cost (20 × ~100ms = 2s of
// post-release jank).
const SETTLE_FREEZE_MS = 600;
let quietFrames = 0;
let frozen = false;
let lastActivityTimestamp = 0;
// Set when the loop transitions out of a frozen stretch; the next rendered
// frame re-anchors the frame clock + auto-rotation clock so a long frozen
// gap doesn't teleport breathing/rotation.
let freezeGapPending = false;

// Last rendered render-state (reference-compared each frozen frame to detect
// hover/selection/tooltip changes without any per-frame DOM work).
let lastHoveredNode: LayoutNode | null = null;
let lastSelectedNode: LayoutNode | null = null;
let lastSelectedEdge: LayoutEdge | null = null;
let lastShowTooltip = false;
let lastTooltipX = 0;
let lastTooltipY = 0;
let lastHiddenNodeCount = 0;

// ─── Performance Optimization State ─────────────────────────────────────────
const MAX_RENDERED_EDGES = 2000;
// TASK-277: while dragging, cap the rendered edge budget lower than the
// full-cap so the interaction stays responsive (the audit thresholds are
// <30ms per task / ≥20fps drag). The graph shows the full edge set the
// moment the drag ends (the frame renders with MAX_RENDERED_EDGES again).
const DRAG_MAX_RENDERED_EDGES = 1200;
let cachedBackgroundGradient: CanvasGradient | null = null;
let cachedBackgroundWidth = 0;
let cachedBackgroundHeight = 0;
let cachedBackgroundDark = false;

// ─── Per-Frame Buffer Pools (TASK-271 / audit F3) ──────────────────────────
// The 300-node / 4000-edge graph previously allocated hundreds of objects per
// frame (projected records, a projByIndex Map, per-edge draw records, active/
// inactive edge arrays, and a fresh spatial grid). Those allocations turned
// into 50-85 ms GC-heavy long tasks. These pools are filled by index and
// re-sliced each frame, so steady-state rendering allocates ZERO objects per
// frame (only the small pooled slices' views remain).
interface EdgeDrawRecord {
	from: ProjectedNode;
	to: ProjectedNode;
	edgeAlpha: number;
	isRelated: boolean;
	avgDepth: number;
	/** Confidence bucket index (0=high, 1=medium, 2=low) — static per data update. */
	bucketIdx: number;
	/** Midpoint label for hovered/selected edges; "" for batched edges. */
	label: string;
}
const projectedPool: ProjectedNode[] = [];
const edgeRecordPool: EdgeDrawRecord[] = [];
const projectedWorking: ProjectedNode[] = [];
const edgeWorking: EdgeDrawRecord[] = [];
const projByIndex = new Map<number, ProjectedNode>();

// ─── Edge Confidence Buckets (TASK-330, KGCONF-2) ────────────────────────────
// The confidence value is static per data update, so bucket index, opacity
// multiplier and label are precomputed ONCE per animEdges change (in
// rebuildEdgeIndices) and only READ per frame — the frame loop stays
// zero-allocation. Bucket 0 (high) uses the renderer's default edge color
// (BUCKET_COLORS[0] === null); 1=amber, 2=red.
const BUCKET_COLORS: (EdgeConfidenceColor | null)[] = [
	EDGE_BUCKET_COLORS.high,
	EDGE_BUCKET_COLORS.medium,
	EDGE_BUCKET_COLORS.low
];
const BUCKET_ALPHA: number[] = [EDGE_ALPHA_MULTIPLIERS.high, EDGE_ALPHA_MULTIPLIERS.medium, EDGE_ALPHA_MULTIPLIERS.low];
const BUCKET_IDX: Record<EdgeConfidenceBucket, number> = { high: 0, medium: 1, low: 2 };
let edgeConfBucket: Uint8Array = new Uint8Array(0);
let edgeConfAlpha: Float32Array = new Float32Array(0);
let edgeLabels: string[] = [];

// ─── Spatial Grid for Hit Testing ────────────────────────────────────────────
// Coarse uniform grid over projected node positions, rebuilt every frame right
// after projection (node screen positions mutate each frame via camera
// auto-rotation/breathing, so the grid must match the last rendered frame).
// The UI hit-test handlers query candidates from the grid instead of linearly
// scanning every node on each mousemove/click.
const HIT_GRID_CELL_SIZE = Math.ceil((NODE_RADIUS + 4) * 2); // ~2x max hit radius
const HIT_GRID_KEY_OFFSET = 32768;
const HIT_GRID_KEY_MULT = 65536;
let spatialGrid = new Map<number, LayoutNode[]>();
let spatialGridBuilt = false;

// Pooled grid buckets — the Map and bucket arrays are reused across frames so
// the per-frame hit-test rebuild allocates zero objects (TASK-271).
const gridBucketPool: LayoutNode[][] = [];
let gridBucketCount = 0;

function rebuildSpatialGrid(): void {
	const grid = spatialGrid;
	grid.clear();
	gridBucketCount = 0;
	for (const n of animNodes) {
		const cx = Math.floor(n.x / HIT_GRID_CELL_SIZE);
		const cy = Math.floor(n.y / HIT_GRID_CELL_SIZE);
		const key = (cx + HIT_GRID_KEY_OFFSET) * HIT_GRID_KEY_MULT + (cy + HIT_GRID_KEY_OFFSET);
		let bucket = grid.get(key);
		if (!bucket) {
			bucket = gridBucketPool[gridBucketCount];
			if (!bucket) {
				bucket = [];
				gridBucketPool[gridBucketCount] = bucket;
			}
			bucket.length = 0;
			grid.set(key, bucket);
			gridBucketCount++;
		}
		bucket.push(n);
	}
	spatialGrid = grid;
	spatialGridBuilt = true;
}

/**
 * Returns every node whose grid cell could contain it within `radius` of (x, y).
 * Callers must still perform the exact distance check (this is a candidate
 * pre-selection, not a hit test).
 */
export function queryNodeCandidates(x: number, y: number, radius: number): LayoutNode[] {
	const minCX = Math.floor((x - radius) / HIT_GRID_CELL_SIZE);
	const maxCX = Math.floor((x + radius) / HIT_GRID_CELL_SIZE);
	const minCY = Math.floor((y - radius) / HIT_GRID_CELL_SIZE);
	const maxCY = Math.floor((y + radius) / HIT_GRID_CELL_SIZE);
	const out: LayoutNode[] = [];
	for (let cy = minCY; cy <= maxCY; cy++) {
		for (let cx = minCX; cx <= maxCX; cx++) {
			const key = (cx + HIT_GRID_KEY_OFFSET) * HIT_GRID_KEY_MULT + (cy + HIT_GRID_KEY_OFFSET);
			const bucket = spatialGrid.get(key);
			if (bucket) {
				for (const n of bucket) out.push(n);
			}
		}
	}
	return out;
}

/** True once the spatial grid has been built at least once (animation running). */
export function isSpatialGridReady(): boolean {
	return spatialGridBuilt;
}

// ─── Main Animation Entry Point ──────────────────────────────────────────────

export function startNeuralAnimation(
	canvas: HTMLCanvasElement,
	initialWidth: number,
	initialHeight: number,
	nodes: LayoutNode[],
	edges: LayoutEdge[],
	state: NeuralRenderState
): () => void {
	stopNeuralAnimation();

	width = initialWidth;
	height = initialHeight;
	cx = width / 2;
	cy = height / 2;
	backingDpr = initialWidth > 0 ? canvas.width / initialWidth : 1;

	animNodes = nodes;
	animEdges = edges;
	animDataDirty = false;

	const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
	if (!ctx) return () => {};

	// Resume loop control state for this animation instance
	running = true;
	isTabHidden = typeof document !== "undefined" && document.hidden;

	// Reset settle/freeze state (TASK-277) so a fresh animation starts with an
	// intro burst and freezes only after the first quiet period.
	quietFrames = 0;
	frozen = false;
	freezeGapPending = false;
	lastActivityTimestamp = 0;
	lastHoveredNode = null;
	lastSelectedNode = null;
	lastSelectedEdge = null;
	lastShowTooltip = false;
	lastTooltipX = 0;
	lastTooltipY = 0;
	lastHiddenNodeCount = 0;

	// Device detection for frame skipping
	const isLowEnd = navigator.hardwareConcurrency !== undefined && navigator.hardwareConcurrency < 4;
	let frameCount = 0;

	// Animation time tracking
	let startTime = performance.now();
	let lastTimestamp = startTime;
	let totalElapsed = 0;

	// ── Derived data (rebuilt when animNodes/animEdges change) ──
	let degreeMap = new Map<string, number>();
	let nodes3d: Node3D[] = [];
	let nodeIndexById = new Map<string, number>();

	// Precomputed edge endpoint indices — animEdges only change when data
	// updates, so the 8000 Map.get(...) calls/frame become two array reads
	// per edge (TASK-271).
	let edgeSrcIdx: (number | undefined)[] = [];
	let edgeTgtIdx: (number | undefined)[] = [];

	function rebuildEdgeIndices(): void {
		edgeSrcIdx = new Array(animEdges.length);
		edgeTgtIdx = new Array(animEdges.length);
		// Confidence bucket arrays + labels — static per data update, so
		// precompute here (once) and only read in the frame loop (TASK-330).
		edgeConfBucket = new Uint8Array(animEdges.length);
		edgeConfAlpha = new Float32Array(animEdges.length);
		edgeLabels = new Array(animEdges.length);
		for (let i = 0; i < animEdges.length; i++) {
			const e = animEdges[i];
			edgeSrcIdx[i] = nodeIndexById.get(e.source);
			edgeTgtIdx[i] = nodeIndexById.get(e.target);
			const bucketIdx = BUCKET_IDX[getEdgeConfidenceBucket(e.confidence)];
			edgeConfBucket[i] = bucketIdx;
			edgeConfAlpha[i] = BUCKET_ALPHA[bucketIdx];
			edgeLabels[i] = formatEdgeConfidenceLabel(e.relation_type, e.confidence);
		}
	}

	function rebuildDerived() {
		degreeMap = new Map<string, number>();
		for (const e of animEdges) {
			degreeMap.set(e.source, (degreeMap.get(e.source) ?? 0) + 1);
			degreeMap.set(e.target, (degreeMap.get(e.target) ?? 0) + 1);
		}

		nodes3d = animNodes.map((node) => ({
			node,
			x: node.x,
			y: node.y,
			z: node.z, // use actual 3D position from sphere layout
			phaseOffset: Math.random() * Math.PI * 2,
			isHub: (degreeMap.get(node.id) ?? 0) >= 5,
			degree: degreeMap.get(node.id) ?? 0,
			color: getNodeColor(node.type),
			firing: false,
			fireTimer: Math.random() * 2000 + 500,
			fireStartTime: 0
		}));

		nodeIndexById = new Map<string, number>();
		animNodes.forEach((n, i) => {
			if (n.id) nodeIndexById.set(n.id, i);
			if (n.name) nodeIndexById.set(n.name, i);
		});

		rebuildEdgeIndices();
	}

	rebuildDerived();

	// ── Main render frame ──
	function render(now: number) {
		// Rebuild derived data if nodes/edges were updated externally
		if (animDataDirty) {
			animDataDirty = false;
			clearSignals();
			rebuildDerived();
		}

		const dark = isDarkMode();
		const dt = now - lastTimestamp;
		lastTimestamp = now;
		totalElapsed += dt;

		// Camera update (zoom lerp + auto-rotation)
		const isZeroEdge = animEdges.length === 0;
		const cam = updateCamera(now, isZeroEdge, totalElapsed);

		// rotY/rotX are frame constants — compute the 4 trig values ONCE per
		// frame and share them with every node/signal projection (~1200
		// trig calls/frame → 4).
		const frameTrig = computeRotationTrig(cam.rotY, cam.rotX);

		// Breathing
		const breathe = isZeroEdge ? 1 : 1 + Math.sin(totalElapsed * BREATHE_SPEED) * BREATHE_AMOUNT;

		// Clear and draw background (cached gradient)
		ctx.clearRect(0, 0, width, height);
		if (
			cachedBackgroundGradient &&
			cachedBackgroundWidth === width &&
			cachedBackgroundHeight === height &&
			cachedBackgroundDark === dark
		) {
			ctx.fillStyle = cachedBackgroundGradient;
			ctx.fillRect(0, 0, width, height);
		} else {
			drawBackground(ctx, width, height);
			// Cache the gradient for next frame
			const centerX = width / 2;
			const centerY = height / 2;
			const maxR = Math.hypot(centerX, centerY);
			const grad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, maxR);
			if (dark) {
				grad.addColorStop(0, "rgba(10,14,42,0)");
				grad.addColorStop(0.6, "rgba(10,14,42,0.1)");
				grad.addColorStop(1, "rgba(2,4,12,0.6)");
			} else {
				grad.addColorStop(0, "rgba(226,232,240,0)");
				grad.addColorStop(0.5, "rgba(203,213,225,0.15)");
				grad.addColorStop(1, "rgba(148,163,184,0.3)");
			}
			cachedBackgroundGradient = grad;
			cachedBackgroundWidth = width;
			cachedBackgroundHeight = height;
			cachedBackgroundDark = dark;
		}

		// Project all nodes (3D → 2D) with sphere breathing.
		// Records are reused from the module-level pool — zero allocations
		// per frame (TASK-271).
		const dragging = isCameraDragging();
		const doSignals = !dragging;
		// TASK-277: during drag, particles lose their decorative bloom layer
		// (signals are also skipped) — the interaction stays responsive by
		// cutting the per-particle raster roughly in half.
		const simplifiedParticles = dragging;

		// TASK-277: while dragging, draw into a 1x backing store and restore
		// the effective DPR when the drag ends. Raster work scales with the
		// backing pixel count, so dropping 1.5x → 1x cuts the fill cost
		// ~2.25x during the most expensive interaction (target: <30ms tasks
		// while dragging). Resizing the backing store resets the context
		// transform, so re-apply the scale explicitly. CSS size is untouched
		// — no layout shift, and the full-resolution frame returns the moment
		// the drag ends (or on the next resize).
		if (dragging) {
			if (canvas.width !== width) {
				canvas.width = width;
				canvas.height = height;
				ctx.setTransform(1, 0, 0, 1, 0, 0);
			}
		} else {
			const fullW = Math.round(width * backingDpr);
			if (canvas.width !== fullW) {
				canvas.width = fullW;
				canvas.height = Math.round(height * backingDpr);
				ctx.setTransform(backingDpr, 0, 0, backingDpr, 0, 0);
			}
		}

		// Update signals (skipped while dragging — decorative only, keeps the
		// pointer hot path lean; ~30 gradient draws/frame saved during pan).
		if (doSignals) {
			spawnSignals(now, nodes3d, animEdges, nodeIndexById);
			updateSignals();
		}

		for (let i = 0; i < nodes3d.length; i++) {
			const n3d = nodes3d[i];
			let rec = projectedPool[i];
			if (!rec) {
				rec = {} as ProjectedNode;
				projectedPool[i] = rec;
			}
			const bx = (n3d.x - cx) * breathe + cx;
			const by = (n3d.y - cy) * breathe + cy;
			const bz = n3d.z * breathe;
			const proj = project3D(
				bx - cx,
				by - cy,
				bz,
				width,
				height,
				cam.rotY,
				cam.rotX,
				cam.effectiveFocalLength,
				frameTrig
			);
			rec.sx = proj.sx;
			rec.sy = proj.sy;
			rec.z = proj.z;
			rec.scale = proj.scale;
			rec.depth = proj.depth;
			rec.node3d = n3d;
		}

		// View over the pool (no allocation).
		projectedWorking.length = nodes3d.length;
		for (let i = 0; i < nodes3d.length; i++) projectedWorking[i] = projectedPool[i];
		const projected: ProjectedNode[] = projectedWorking;

		// Write projected screen coordinates back to the original LayoutNode objects
		for (const p of projected) {
			p.node3d.node.x = p.sx;
			p.node3d.node.y = p.sy;
		}

		// Rebuild spatial grid for hit-testing (positions/camera changed this frame)
		rebuildSpatialGrid();

		// Depth sort (far to near) — in place over the pooled view.
		projected.sort((a, b) => b.depth - a.depth);

		// Build projected lookup by original index — Map is REUSED across
		// frames (clear+set) instead of allocating a new Map every frame
		// (TASK-271).
		projByIndex.clear();
		for (const p of projected) {
			const idx =
				(p.node3d.node.id ? nodeIndexById.get(p.node3d.node.id) : undefined) ?? nodeIndexById.get(p.node3d.node.name);
			if (idx !== undefined && idx >= 0) projByIndex.set(idx, p);
		}

		const hasFocus = !!(state.hoveredNode || state.selectedNode);

		// ── Draw edges (far to near) ──
		// Viewport frustum with margin for edges just outside
		const viewMargin = 100;
		const viewLeft = -viewMargin;
		const viewRight = width + viewMargin;
		const viewTop = -viewMargin;
		const viewBottom = height + viewMargin;

		// Pre-filter: only edges with both endpoints in viewport (with margin).
		// Records are drawn from the pooled edgeRecordPool — zero allocations
		// per frame (TASK-271). Endpoint indices are precomputed per data
		// update, so the frame loop is two array reads + Map lookups instead
		// of 8000+ Map.get(...) calls.
		let edgeCount = 0;
		const maxEdges = dragging ? DRAG_MAX_RENDERED_EDGES : MAX_RENDERED_EDGES;
		for (let ei = 0; ei < animEdges.length && edgeCount < maxEdges; ei++) {
			const e = animEdges[ei];
			const srcIdx = edgeSrcIdx[ei];
			const tgtIdx = edgeTgtIdx[ei];
			if (srcIdx === undefined || tgtIdx === undefined) continue;
			const fromP = projByIndex.get(srcIdx);
			const toP = projByIndex.get(tgtIdx);
			if (!fromP || !toP) continue;
			if (fromP.scale < 0.02 || toP.scale < 0.02) continue;

			// Viewport frustum culling — skip edges entirely outside viewport
			if (
				(fromP.sx < viewLeft && toP.sx < viewLeft) ||
				(fromP.sx > viewRight && toP.sx > viewRight) ||
				(fromP.sy < viewTop && toP.sy < viewTop) ||
				(fromP.sy > viewBottom && toP.sy > viewBottom)
			) {
				continue;
			}

			const isHovered =
				state.hoveredNode &&
				(e.source === state.hoveredNode.id ||
					e.source === state.hoveredNode.name ||
					e.target === state.hoveredNode.id ||
					e.target === state.hoveredNode.name);
			const isSelected =
				state.selectedNode &&
				(e.source === state.selectedNode.id ||
					e.source === state.selectedNode.name ||
					e.target === state.selectedNode.id ||
					e.target === state.selectedNode.name);
			const isRelated = !!(isHovered || isSelected);

			let alphaMultiplier: number;
			if (hasFocus) {
				alphaMultiplier = isRelated ? 1.0 : 0.05;
			} else {
				alphaMultiplier = 0.2; // lower default opacity when no hover to avoid cluttered look
			}

			const avgZ = (fromP.depth + toP.depth) / 2;
			const maxZ = FOG_FAR * 1.5;
			const baseAlpha = Math.max(0.1, Math.min(0.7, (avgZ + maxZ) / (maxZ * 2)));
			// Confidence opacity bucket folds into the alpha (TASK-330): high
			// keeps the full value, medium/low dim the stroke. bucketIdx/label
			// are precomputed per data update — only read here.
			const bucketIdx = edgeConfBucket[ei];
			const edgeAlpha = baseAlpha * alphaMultiplier * edgeConfAlpha[ei];
			const edgeIsSelected = state.selectedEdge === e;

			let rec = edgeRecordPool[edgeCount];
			if (!rec) {
				rec = { from: null!, to: null!, edgeAlpha: 0, isRelated: false, avgDepth: 0, bucketIdx: 0, label: "" };
				edgeRecordPool[edgeCount] = rec;
			}
			rec.from = fromP;
			rec.to = toP;
			rec.edgeAlpha = edgeAlpha;
			rec.isRelated = isRelated;
			rec.avgDepth = avgZ;
			rec.bucketIdx = bucketIdx;
			// Midpoint label only for the active set (hovered/selected) — the
			// overview stays uncluttered and fillText cost stays bounded.
			rec.label = isRelated || edgeIsSelected ? edgeLabels[ei] : "";
			edgeCount++;
		}

		// Sort edges by depth (far to near) — in place on the pooled view; the
		// records are re-filled by index next frame, so mutated order is fine.
		edgeWorking.length = edgeCount;
		for (let i = 0; i < edgeCount; i++) edgeWorking[i] = edgeRecordPool[i];
		if (edgeCount > 1) edgeWorking.sort((a, b) => b.avgDepth - a.avgDepth);

		// Draw: inactive edges are batched into per-confidence-bucket paths
		// (≤3 save/stroke/restore — no per-edge object arrays), active edges
		// draw individually with the animated dash/shadow effects. Alpha for
		// each bucket batch uses its FIRST (far-to-near) edge, matching the
		// pre-TASK-330 single-batch behavior. Bucket colors (TASK-330):
		// 0=high → default edge color, 1=medium amber, 2=low red.
		const edgeColor = dark ? "0,212,255" : "55,48,163";
		let batchBucket: number | null = null;
		for (let i2 = 0; i2 < edgeCount; i2++) {
			const re = edgeWorking[i2];
			if (re.isRelated) {
				if (batchBucket !== null) {
					ctx.stroke();
					ctx.restore();
					batchBucket = null;
				}
				const bucketColor = BUCKET_COLORS[re.bucketIdx];
				drawEdge3D(ctx, re.from, re.to, re.edgeAlpha, true, totalElapsed, dark, bucketColor);
				continue;
			}
			if (batchBucket !== re.bucketIdx) {
				if (batchBucket !== null) {
					ctx.stroke();
					ctx.restore();
				}
				batchBucket = re.bucketIdx;
				const fog = fogFactor(re.avgDepth);
				const alpha = dark ? Math.min(0.8, re.edgeAlpha * fog) : Math.min(0.9, Math.max(0.08, re.edgeAlpha * fog));
				if (alpha < 0.01) {
					batchBucket = null;
					continue;
				}
				ctx.save();
				const bucketColor = BUCKET_COLORS[re.bucketIdx];
				ctx.strokeStyle = bucketColor
					? `rgba(${bucketColor.r},${bucketColor.g},${bucketColor.b},${alpha})`
					: `rgba(${edgeColor},${alpha})`;
				ctx.lineWidth = dark ? 1.5 : 1.8;
				ctx.lineCap = "round";
				ctx.beginPath();
			}
			ctx.moveTo(re.from.sx, re.from.sy);
			ctx.lineTo(re.to.sx, re.to.sy);
		}
		if (batchBucket !== null) {
			ctx.stroke();
			ctx.restore();
		}

		// Edge confidence labels (TASK-330): midpoint pill for the active set
		// only (hovered/selected). Drawn in a post-pass so labels always
		// overlay the strokes; the loop is bounded by edgeCount (array reads
		// only) and fillText runs only for the few labeled edges.
		for (let i3 = 0; i3 < edgeCount; i3++) {
			const re = edgeWorking[i3];
			if (!re.label) continue;
			drawEdgeLabel3D(ctx, re.from, re.to, re.label, dark, BUCKET_COLORS[re.bucketIdx]);
		}

		// ── Draw signals (skipped while dragging — decorative, TASK-271) ──
		if (doSignals) {
			const signals = getSignals();
			for (const sig of signals) {
				const fromN = animNodes[sig.fromIdx];
				const toN = animNodes[sig.toIdx];
				if (!fromN || !toN) continue;

				const fromN3d = nodes3d[sig.fromIdx];
				const toN3d = nodes3d[sig.toIdx];
				if (!fromN3d || !toN3d) continue;

				// Interpolate 3D position
				const ix = (fromN.x + (toN.x - fromN.x) * sig.progress - cx) * breathe + cx;
				const iy = (fromN.y + (toN.y - fromN.y) * sig.progress - cy) * breathe + cy;
				const iz = (fromN3d.z + (toN3d.z - fromN3d.z) * sig.progress) * breathe;

				const proj = project3D(
					ix - cx,
					iy - cy,
					iz,
					width,
					height,
					cam.rotY,
					cam.rotX,
					cam.effectiveFocalLength,
					frameTrig
				);

				const brightness = Math.sin(sig.progress * Math.PI);
				if (brightness <= 0 || proj.scale < 0.05) continue;

				// Draw signal as a tiny bright particle
				const sigFog = fogFactor(proj.depth);
				const sigAlpha = brightness * sigFog;
				const size = Math.max(0.5, (1.5 + brightness * 1.2) * Math.min(proj.scale, 1.5));

				ctx.save();

				if (dark) {
					ctx.globalCompositeOperation = "lighter";

					// Outer glow
					ctx.beginPath();
					ctx.arc(proj.sx, proj.sy, size * 3, 0, Math.PI * 2);
					ctx.fillStyle = `rgba(${sig.color.r},${sig.color.g},${sig.color.b},${sigAlpha * 0.15})`;
					ctx.fill();

					// Core
					const br = Math.min(255, sig.color.r + 80);
					const bg = Math.min(255, sig.color.g + 80);
					const bb = Math.min(255, sig.color.b + 80);
					ctx.beginPath();
					ctx.arc(proj.sx, proj.sy, size, 0, Math.PI * 2);
					ctx.fillStyle = `rgba(${br},${bg},${bb},${sigAlpha * 0.9})`;
					ctx.fill();
				} else {
					// Light mode: darken signal colors for contrast
					const darken = (v: number) => Math.round(v * 0.65);
					const sr = darken(sig.color.r);
					const sg = darken(sig.color.g);
					const sb = darken(sig.color.b);

					// Normal blending with soft halo. The halo gradient is built
					// once per color (cached, origin-centered) and drawn in a
					// per-signal translate/scale — the inner stop bakes a fixed
					// 0.25 multiplier and ctx.globalAlpha applies the per-signal
					// alpha (alpha-in-string was `sigAlpha * 0.25`, identical).
					const outerR = size * 2.5;
					ctx.save();
					ctx.translate(proj.sx, proj.sy);
					ctx.scale(outerR / SIGNAL_HALO_REF_RADIUS, outerR / SIGNAL_HALO_REF_RADIUS);
					ctx.globalAlpha = sigAlpha;
					ctx.fillStyle = getSignalHaloGradient(ctx, { r: sr, g: sg, b: sb });
					ctx.beginPath();
					ctx.arc(0, 0, SIGNAL_HALO_REF_RADIUS, 0, Math.PI * 2);
					ctx.fill();
					ctx.restore();

					// Core
					ctx.beginPath();
					ctx.arc(proj.sx, proj.sy, Math.max(1.2, size), 0, Math.PI * 2);
					ctx.fillStyle = `rgba(${sr},${sg},${sb},${sigAlpha})`;
					ctx.fill();
				}

				ctx.restore();
			}
		}

		// ── Draw nodes (far to near — already sorted) ──
		for (const p of projected) {
			const n3d = p.node3d;
			const node = n3d.node;
			const isHovered = state.hoveredNode === node;
			const isSelected = state.selectedNode === node;

			// Viewport frustum culling — skip nodes entirely outside viewport
			if (p.sx < viewLeft || p.sx > viewRight || p.sy < viewTop || p.sy > viewBottom) {
				continue;
			}

			// Twinkle
			const twinkle = 0.7 + 0.3 * Math.sin(now * TWINKLE_SPEED + n3d.phaseOffset);

			// Radius: important nodes (degree >= 5 or memoryCount > 0) get larger
			const isImportant = n3d.isHub || (node.memoryCount != null && node.memoryCount > 0);
			const baseR = isImportant ? PARTICLE_IMPORTANT_RADIUS : PARTICLE_BASE_RADIUS;
			const radius = baseR * Math.min(p.scale, 1.3);

			if (radius < 0.3 || p.scale < 0.05) continue;

			// Base alpha from depth
			const baselineScale = cam.effectiveFocalLength / (cam.effectiveFocalLength + FOG_FAR);
			const normalizedScale = p.scale / baselineScale;
			const depthAlpha = Math.max(0.25, Math.min(1, (normalizedScale - 0.15) / 0.85));

			// Hover/select boost
			const hoverBoost = isHovered || isSelected ? 1.5 : 1.0;
			const finalRadius = radius * hoverBoost;

			// Subtle minimum for deep particles
			const drawRadius = Math.max(PARTICLE_SUBTLE_MIN, finalRadius);

			drawParticle(ctx, p.sx, p.sy, p.depth, n3d.color, drawRadius, depthAlpha, twinkle, dark, simplifiedParticles);

			// Hover/select label. Hover labels are skipped while dragging
			// (TASK-277): the pointer is travelling across the scene, the hover
			// target lags behind, and re-measuring/re-batching the pill every
			// frame during the most expensive interaction is wasted raster.
			// Selected labels are kept so the active entity stays readable.
			if (((isHovered && !dragging) || isSelected) && normalizedScale > 0.15) {
				const labelAlpha = Math.max(0, (normalizedScale - 0.15) / 0.85) * depthAlpha;
				if (labelAlpha > 0.05) {
					const darkLabel = dark;
					ctx.save();
					ctx.globalAlpha = labelAlpha;

					// Background pill for readability
					const name = node.name;
					ctx.font = "bold 10px system-ui,sans-serif";
					const tw = ctx.measureText(name).width;
					const pillPad = 6;
					const pillH = 18;
					const pillY = p.sy + drawRadius + 6;

					ctx.fillStyle = darkLabel ? "rgba(2,6,23,0.85)" : "rgba(255,255,255,0.9)";
					ctx.shadowColor = "rgba(0,0,0,0.3)";
					ctx.shadowBlur = 8;
					roundRect(ctx, p.sx - tw / 2 - pillPad, pillY, tw + pillPad * 2, pillH, 4);
					ctx.fill();
					ctx.shadowBlur = 0;

					// Name text
					ctx.textAlign = "center";
					ctx.textBaseline = "middle";
					ctx.fillStyle = darkLabel ? "#e2e8f0" : "#1e293b";
					ctx.fillText(name, p.sx, pillY + pillH / 2);

					// Type subtitle below pill
					if (node.type) {
						ctx.font = "8px system-ui,sans-serif";
						ctx.fillStyle = darkLabel ? "rgba(148,163,184,0.7)" : "rgba(100,116,139,0.7)";
						ctx.textBaseline = "top";
						ctx.fillText(node.type, p.sx, pillY + pillH + 2);
					}

					ctx.restore();
				}
			}
		}

		// ── Tooltip ──
		if (state.showTooltip && state.selectedNode) {
			drawTooltip(ctx, state.selectedNode, state.tooltipPos, width, height);
		}

		// ── Overflow notice ──
		if (state.hiddenNodeCount && state.hiddenNodeCount > 0) {
			drawOverflowNotice(ctx, width, state.hiddenNodeCount);
		}

		// ── Sync rendered-state snapshot (TASK-277) ──
		// Frozen frames reference-compare against these to detect host-driven
		// state changes (hover/selection/tooltip) without any DOM work.
		lastHoveredNode = state.hoveredNode;
		lastSelectedNode = state.selectedNode;
		lastSelectedEdge = state.selectedEdge;
		lastShowTooltip = state.showTooltip;
		lastTooltipX = state.tooltipPos.x;
		lastTooltipY = state.tooltipPos.y;
		lastHiddenNodeCount = state.hiddenNodeCount ?? 0;
	}

	/**
	 * True when anything invalidates the last rendered frame: an interaction
	 * (drag / zoom lerp), a pending data mutation, or a change to the shared
	 * render state (hover/selection/tooltip). This is the frozen-frame wake
	 * check — O(1), zero allocation, no DOM reads.
	 */
	function renderStateChanged(): boolean {
		return (
			state.hoveredNode !== lastHoveredNode ||
			state.selectedNode !== lastSelectedNode ||
			state.selectedEdge !== lastSelectedEdge ||
			state.showTooltip !== lastShowTooltip ||
			state.tooltipPos.x !== lastTooltipX ||
			state.tooltipPos.y !== lastTooltipY ||
			(state.hiddenNodeCount ?? 0) !== lastHiddenNodeCount
		);
	}

	function hasRenderWork(): boolean {
		return isCameraDragging() || isZoomAnimating() || animDataDirty || renderStateChanged();
	}

	// ── Animation loop ──
	// Frames are only scheduled while `running && !isTabHidden`. When paused
	// (hidden tab or manual pause), no further frame is scheduled, so the loop
	// performs zero work until resumed.
	function animate(timestamp: number) {
		animationId = null;
		if (!running || isTabHidden) return; // paused — do not reschedule

		// TASK-271 / audit F3: while dragging (or on low-end devices) render
		// every OTHER frame. Pointer updates only need ~30 fps visually; this
		// halves the per-frame raster/sim cost during the most expensive
		// interaction (the audit measured 12.5 fps during drag).
		const dragging = isCameraDragging();
		if ((isLowEnd || dragging) && frameCount++ % 2 !== 0) {
			animationId = requestAnimationFrame(animate);
			return;
		}

		// ── Settle detection + freeze (TASK-277) ──
		// Frozen frames perform NO rendering — just the O(1) wake check above.
		// This is what turns "idle" into ~0 main-thread work: the expensive
		// render (signals, projection, grid rebuild, edge/node raster) simply
		// stops running once the graph is at rest.
		if (frozen) {
			if (!hasRenderWork()) {
				// At rest — retain the last frame; the spatial grid still
				// matches the static node positions so hit-testing works.
				animationId = requestAnimationFrame(animate);
				return;
			}
			frozen = false;
			quietFrames = 0;
			lastActivityTimestamp = timestamp;
		} else {
			const hasActivity = dragging || isZoomAnimating() || animDataDirty || renderStateChanged();
			if (hasActivity) {
				quietFrames = 0;
				lastActivityTimestamp = timestamp;
			} else {
				quietFrames++;
				// Freeze after 20 quiet frames OR ~SETTLE_FREEZE_MS of quiet
				// time — whichever comes first (see SETTLE_FREEZE_MS).
				if (quietFrames >= SETTLE_FREEZE_FRAMES || timestamp - lastActivityTimestamp >= SETTLE_FREEZE_MS) {
					frozen = true;
					freezeGapPending = true;
				}
			}
		}

		if (freezeGapPending) {
			// First frame after a freeze gap: re-anchor the frame + auto-
			// rotation clocks so the gap doesn't teleport breathing/rotation.
			freezeGapPending = false;
			lastTimestamp = timestamp;
			resetAutoRotationClock();
		}

		render(timestamp);
		animationId = requestAnimationFrame(animate);
	}

	// Re-anchor the frame clock and restart scheduling. Called on visibility
	// resume and by the exported resumeNeuralAnimation() control.
	currentResumeHook = () => {
		// Reset `lastTimestamp` so the first frame after a pause/hidden period
		// does not produce a huge dt that teleports camera auto-rotation.
		lastTimestamp = performance.now();
		if (animationId === null && running && !isTabHidden) {
			animationId = requestAnimationFrame(animate);
		}
	};

	// Pause the RAF loop while the browser tab is hidden; resume when visible.
	// (Browsers already throttle rAF for hidden tabs, but this makes the
	// pause explicit and re-anchors the clock so auto-rotation doesn't jump.)
	const handleVisibilityChange = () => {
		isTabHidden = document.hidden;
		if (!isTabHidden) {
			currentResumeHook?.();
		}
	};
	document.addEventListener("visibilitychange", handleVisibilityChange);

	// ── Kick off ──
	startTime = performance.now();
	lastTimestamp = startTime;
	totalElapsed = 0;
	lastActivityTimestamp = startTime;
	if (!isTabHidden) {
		animationId = requestAnimationFrame(animate);
	}

	// ── Cleanup function ──
	const cleanup = () => {
		if (animationId !== null) {
			cancelAnimationFrame(animationId);
			animationId = null;
		}
		document.removeEventListener("visibilitychange", handleVisibilityChange);
		currentResumeHook = null;
	};

	currentCleanup = cleanup;
	return cleanup;
}

// ─── Force Stop ──────────────────────────────────────────────────────────────

export function stopNeuralAnimation(): void {
	if (animationId !== null) {
		cancelAnimationFrame(animationId);
		animationId = null;
	}
	if (currentCleanup) {
		currentCleanup();
		currentCleanup = null;
	}
}

// ─── Pause / Resume Control (TASK-189) ───────────────────────────────────────

/**
 * Pauses the active animation loop. No frames are scheduled while paused.
 * The current frame is cancelled immediately; rendering resumes from the
 * same state via `resumeNeuralAnimation()`. Safe to call when no animation
 * is running.
 */
export function pauseNeuralAnimation(): void {
	running = false;
	if (animationId !== null) {
		cancelAnimationFrame(animationId);
		animationId = null;
	}
}

/**
 * Resumes the animation loop after `pauseNeuralAnimation()` (or after the
 * browser tab becomes visible again). Does nothing if the loop is already
 * running, or while the tab is still hidden (visibilitychange resumes it).
 */
export function resumeNeuralAnimation(): void {
	if (running) return;
	running = true;
	isTabHidden = typeof document !== "undefined" && document.hidden;
	if (isTabHidden) return; // resumes via visibilitychange when visible
	currentResumeHook?.();
}

/**
 * Reports whether the animation loop is currently active (running and the
 * tab is visible). Useful for consumers to decide whether to call
 * `pauseNeuralAnimation()` / `resumeNeuralAnimation()`.
 */
export function isNeuralAnimationRunning(): boolean {
	return running && !isTabHidden;
}

// ─── Wake Control (TASK-277) ─────────────────────────────────────────────────

/**
 * Instantly unfreezes a settled graph and (re)starts rendering. The renderer
 * freezes after ~20 quiet frames to eliminate idle CPU burn; consumers that
 * mutate the scene outside the regular interaction path (e.g. a camera reset)
 * call this to force an immediate redraw. A resize / data update wakes the
 * loop automatically via the frozen-frame check.
 */
export function wakeNeuralAnimation(): void {
	frozen = false;
	quietFrames = 0;
	freezeGapPending = true;
	lastActivityTimestamp = performance.now();
	if (animationId === null) currentResumeHook?.();
}

// ─── External Dimension Update ──────────────────────────────────────────────

export function updateNeuralDimensions(canvas: HTMLCanvasElement): void {
	const { width: w, height: h, dpr } = resizeNeuralCanvas(canvas);
	width = w;
	height = h;
	cx = width / 2;
	cy = height / 2;
	backingDpr = dpr;
	// Resize invalidates the retained frame (backing store + viewport
	// changed) — wake so the next frame re-renders at the new dimensions.
	wakeNeuralAnimation();
}

// ─── Live Data Update ───────────────────────────────────────────────────────

export function updateAnimationData(nodes: LayoutNode[], edges: LayoutEdge[]): void {
	animNodes = nodes;
	animEdges = edges;
	animDataDirty = true;
}
