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
	FOG_FAR,
	BREATHE_SPEED,
	BREATHE_AMOUNT,
	TWINKLE_SPEED,
	PARTICLE_BASE_RADIUS,
	PARTICLE_IMPORTANT_RADIUS,
	PARTICLE_SUBTLE_MIN
} from "./layout";
import { drawParticle, drawTooltip, drawOverflowNotice, type NeuralRenderState } from "./nodes";
import { drawEdge3D } from "./edges";
import type { Node3D, ProjectedNode } from "./layout";
import {
	updateCamera,
	zoomCamera,
	startDragCamera,
	dragCamera,
	endDragCamera,
	resetCamera,
	getZoomPercent,
	isCameraDragging
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

// ─── Performance Optimization State ─────────────────────────────────────────
const MAX_RENDERED_EDGES = 2000;
let cachedBackgroundGradient: CanvasGradient | null = null;
let cachedBackgroundWidth = 0;
let cachedBackgroundHeight = 0;
let cachedBackgroundDark = false;

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

function rebuildSpatialGrid(): void {
	const grid = new Map<number, LayoutNode[]>();
	for (const n of animNodes) {
		const cx = Math.floor(n.x / HIT_GRID_CELL_SIZE);
		const cy = Math.floor(n.y / HIT_GRID_CELL_SIZE);
		const key = (cx + HIT_GRID_KEY_OFFSET) * HIT_GRID_KEY_MULT + (cy + HIT_GRID_KEY_OFFSET);
		let bucket = grid.get(key);
		if (!bucket) {
			bucket = [];
			grid.set(key, bucket);
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

	animNodes = nodes;
	animEdges = edges;
	animDataDirty = false;

	const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
	if (!ctx) return () => {};

	// Resume loop control state for this animation instance
	running = true;
	isTabHidden = typeof document !== "undefined" && document.hidden;

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

		// Update signals
		spawnSignals(now, nodes3d, animEdges, nodeIndexById);
		updateSignals();

		// Project all nodes (3D → 2D) with sphere breathing
		const projected: ProjectedNode[] = nodes3d.map((n3d) => {
			const bx = (n3d.x - cx) * breathe + cx;
			const by = (n3d.y - cy) * breathe + cy;
			const bz = n3d.z * breathe;
			const proj = project3D(bx - cx, by - cy, bz, width, height, cam.rotY, cam.rotX, cam.effectiveFocalLength);
			return {
				...proj,
				node3d: n3d
			};
		});

		// Write projected screen coordinates back to the original LayoutNode objects
		for (const p of projected) {
			p.node3d.node.x = p.sx;
			p.node3d.node.y = p.sy;
		}

		// Rebuild spatial grid for hit-testing (positions/camera changed this frame)
		rebuildSpatialGrid();

		// Depth sort (far to near)
		projected.sort((a, b) => b.depth - a.depth);

		// Build projected lookup by original index
		const projByIndex = new Map<number, ProjectedNode>();
		projected.forEach((p) => {
			const idx =
				(p.node3d.node.id ? nodeIndexById.get(p.node3d.node.id) : undefined) ?? nodeIndexById.get(p.node3d.node.name);
			if (idx !== undefined && idx >= 0) projByIndex.set(idx, p);
		});

		const hasFocus = !!(state.hoveredNode || state.selectedNode);

		// ── Draw edges (far to near) ──
		// Viewport frustum with margin for edges just outside
		const viewMargin = 100;
		const viewLeft = -viewMargin;
		const viewRight = width + viewMargin;
		const viewTop = -viewMargin;
		const viewBottom = height + viewMargin;

		// Pre-filter: only edges with both endpoints in viewport (with margin)
		const visibleEdges: {
			from: ProjectedNode;
			to: ProjectedNode;
			edgeAlpha: number;
			isRelated: boolean;
			avgDepth: number;
		}[] = [];

		for (const e of animEdges) {
			if (visibleEdges.length >= MAX_RENDERED_EDGES) break;

			const srcIdx = nodeIndexById.get(e.source);
			const tgtIdx = nodeIndexById.get(e.target);
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
			const edgeAlpha = baseAlpha * alphaMultiplier;

			visibleEdges.push({ from: fromP, to: toP, edgeAlpha, isRelated, avgDepth: avgZ });
		}

		// Sort edges by depth (far to near)
		visibleEdges.sort((a, b) => b.avgDepth - a.avgDepth);

		// Batch non-active edges: draw all inactive edges in a single path for fewer ctx state changes
		const activeEdges: typeof visibleEdges = [];
		const inactiveEdges: typeof visibleEdges = [];
		for (const re of visibleEdges) {
			if (re.isRelated) {
				activeEdges.push(re);
			} else {
				inactiveEdges.push(re);
			}
		}

		if (inactiveEdges.length > 0) {
			const edgeColor = dark ? "0,212,255" : "55,48,163";
			const defaultAlpha = inactiveEdges[0]?.edgeAlpha ?? 0.2;
			const fog = fogFactor(inactiveEdges[0]?.avgDepth ?? 0);
			const alpha = dark ? Math.min(0.8, defaultAlpha * fog) : Math.min(0.9, Math.max(0.08, defaultAlpha * fog));

			if (alpha >= 0.01) {
				ctx.save();
				ctx.strokeStyle = `rgba(${edgeColor},${alpha})`;
				ctx.lineWidth = dark ? 1.5 : 1.8;
				ctx.lineCap = "round";
				ctx.beginPath();
				for (const re of inactiveEdges) {
					ctx.moveTo(re.from.sx, re.from.sy);
					ctx.lineTo(re.to.sx, re.to.sy);
				}
				ctx.stroke();
				ctx.restore();
			}
		}

		// Draw active (hovered/selected) edges individually for effects
		for (const re of activeEdges) {
			drawEdge3D(ctx, re.from, re.to, re.edgeAlpha, re.isRelated, totalElapsed);
		}

		// ── Draw signals ──
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

			const proj = project3D(ix - cx, iy - cy, iz, width, height, cam.rotY, cam.rotX, cam.effectiveFocalLength);

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

				// Normal blending with soft halo
				const outerR = size * 2.5;
				const grad = ctx.createRadialGradient(proj.sx, proj.sy, 0, proj.sx, proj.sy, outerR);
				grad.addColorStop(0, `rgba(${sr},${sg},${sb},${sigAlpha * 0.25})`);
				grad.addColorStop(1, `rgba(${sr},${sg},${sb},0)`);
				ctx.fillStyle = grad;
				ctx.beginPath();
				ctx.arc(proj.sx, proj.sy, outerR, 0, Math.PI * 2);
				ctx.fill();

				// Core
				ctx.beginPath();
				ctx.arc(proj.sx, proj.sy, Math.max(1.2, size), 0, Math.PI * 2);
				ctx.fillStyle = `rgba(${sr},${sg},${sb},${sigAlpha})`;
				ctx.fill();
			}

			ctx.restore();
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

			drawParticle(ctx, p.sx, p.sy, p.depth, n3d.color, drawRadius, depthAlpha, twinkle);

			// Hover/select label
			if ((isHovered || isSelected) && normalizedScale > 0.15) {
				const labelAlpha = Math.max(0, (normalizedScale - 0.15) / 0.85) * depthAlpha;
				if (labelAlpha > 0.05) {
					const darkLabel = isDarkMode();
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
	}

	// ── Animation loop ──
	// Frames are only scheduled while `running && !isTabHidden`. When paused
	// (hidden tab or manual pause), no further frame is scheduled, so the loop
	// performs zero work until resumed.
	function animate(timestamp: number) {
		animationId = null;
		if (!running || isTabHidden) return; // paused — do not reschedule

		if (isLowEnd && frameCount++ % 2 !== 0) {
			animationId = requestAnimationFrame(animate);
			return;
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

// ─── External Dimension Update ──────────────────────────────────────────────

export function updateNeuralDimensions(canvas: HTMLCanvasElement): void {
	const { width: w, height: h } = resizeNeuralCanvas(canvas);
	width = w;
	height = h;
	cx = width / 2;
	cy = height / 2;
}

// ─── Live Data Update ───────────────────────────────────────────────────────

export function updateAnimationData(nodes: LayoutNode[], edges: LayoutEdge[]): void {
	animNodes = nodes;
	animEdges = edges;
	animDataDirty = true;
}
