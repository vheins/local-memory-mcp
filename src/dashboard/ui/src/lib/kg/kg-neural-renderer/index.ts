/**
 * Main animation orchestrator for the Knowledge Graph Neural Renderer.
 *
 * Manages module-level state, camera controls, and the animation loop.
 */

import type { LayoutNode, LayoutEdge } from "../KGForceLayout";
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

let animNodes: LayoutNode[] = [];
let animEdges: LayoutEdge[] = [];
let animDataDirty = false;

let width = 0;
let height = 0;
let cx = 0;
let cy = 0;

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

		// Clear and draw background
		ctx.clearRect(0, 0, width, height);
		drawBackground(ctx, width, height);

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
		const renderedEdges = animEdges
			.map((e) => {
				const srcIdx = nodeIndexById.get(e.source);
				const tgtIdx = nodeIndexById.get(e.target);
				if (srcIdx === undefined || tgtIdx === undefined) return null;
				const fromP = projByIndex.get(srcIdx);
				const toP = projByIndex.get(tgtIdx);
				if (!fromP || !toP) return null;
				if (fromP.scale < 0.02 || toP.scale < 0.02) return null;

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

				return { from: fromP, to: toP, edgeAlpha, isRelated, avgDepth: avgZ };
			})
			.filter(
				(x): x is { from: ProjectedNode; to: ProjectedNode; edgeAlpha: number; isRelated: boolean; avgDepth: number } =>
					x !== null
			);

		// Sort edges by depth (far to near)
		renderedEdges.sort((a, b) => b.avgDepth - a.avgDepth);

		for (const re of renderedEdges) {
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
					const dark = isDarkMode();
					ctx.save();
					ctx.globalAlpha = labelAlpha;

					// Background pill for readability
					const name = node.name;
					ctx.font = "bold 10px system-ui,sans-serif";
					const tw = ctx.measureText(name).width;
					const pillPad = 6;
					const pillH = 18;
					const pillY = p.sy + drawRadius + 6;

					ctx.fillStyle = dark ? "rgba(2,6,23,0.85)" : "rgba(255,255,255,0.9)";
					ctx.shadowColor = "rgba(0,0,0,0.3)";
					ctx.shadowBlur = 8;
					roundRect(ctx, p.sx - tw / 2 - pillPad, pillY, tw + pillPad * 2, pillH, 4);
					ctx.fill();
					ctx.shadowBlur = 0;

					// Name text
					ctx.textAlign = "center";
					ctx.textBaseline = "middle";
					ctx.fillStyle = dark ? "#e2e8f0" : "#1e293b";
					ctx.fillText(name, p.sx, pillY + pillH / 2);

					// Type subtitle below pill
					if (node.type) {
						ctx.font = "8px system-ui,sans-serif";
						ctx.fillStyle = dark ? "rgba(148,163,184,0.7)" : "rgba(100,116,139,0.7)";
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
	function animate(timestamp: number) {
		if (isLowEnd && frameCount++ % 2 !== 0) {
			animationId = requestAnimationFrame(animate);
			return;
		}

		render(timestamp);
		animationId = requestAnimationFrame(animate);
	}

	// ── Kick off ──
	startTime = performance.now();
	lastTimestamp = startTime;
	totalElapsed = 0;
	animationId = requestAnimationFrame(animate);

	// ── Cleanup function ──
	const cleanup = () => {
		if (animationId !== null) {
			cancelAnimationFrame(animationId);
			animationId = null;
		}
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
