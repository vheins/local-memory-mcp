/**
 * 3D Holographic Particle Renderer for the Knowledge Graph.
 *
 * Cinematic JARVIS / Ultron-inspired neural interface visualization.
 * True 3D spherical layout with dual-axis rotation, volumetric fog,
 * tiny star-like particles, and signal propagation along edges.
 *
 * Self-contained — all animation state lives in module-level variables.
 */

import type { LayoutNode, LayoutEdge } from "./KGForceLayout";

// ─── Public Types ────────────────────────────────────────────────────────────

export interface NeuralRenderState {
	hoveredNode: LayoutNode | null;
	selectedNode: LayoutNode | null;
	selectedEdge: LayoutEdge | null;
	showTooltip: boolean;
	tooltipPos: { x: number; y: number };
	hiddenNodeCount?: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

// Particle sizes (tiny!)
const PARTICLE_BASE_RADIUS = 1.5;
const PARTICLE_IMPORTANT_RADIUS = 5;
const PARTICLE_SUBTLE_MIN = 0.8;

// Edges — very thin
const EDGE_BASE_WIDTH = 0.35;

// Camera
const CAMERA_DISTANCE = 500;
const CAMERA_ROTATION_SPEED = 0.00008;
const CAMERA_TILT_AMOUNT = 0.08;
const FOCAL_LENGTH = 300;

// Depth / Fog
const FOG_NEAR = 150;
const FOG_FAR = 700;

// Breathing
const BREATHE_SPEED = 0.0002;
const BREATHE_AMOUNT = 0.015;

// Twinkle
const TWINKLE_SPEED = 0.001;
const TWINKLE_AMOUNT = 0.3;

// Signals
const MAX_SIGNALS = 30;
const SIGNAL_SPEED = 0.0008;
const SIGNAL_SPAWN_INTERVAL = 800;

// ─── Colors — Cyberpunk / Holographic ────────────────────────────────────────

const PALETTE = [
	{ r: 0, g: 212, b: 255 }, // electric cyan
	{ r: 139, g: 92, b: 246 }, // violet
	{ r: 79, g: 70, b: 229 }, // indigo
	{ r: 236, g: 72, b: 153 }, // soft magenta
	{ r: 100, g: 180, b: 255 } // light blue
];

const TYPE_COLOR_INDEX: Record<string, number> = {
	person: 1,
	place: 2,
	organization: 3,
	concept: 0,
	unknown: 4
};

const BG_DARK = "#050a1a";

// ─── Internal 3D Types ──────────────────────────────────────────────────────

interface Node3D {
	node: LayoutNode;
	x: number;
	y: number;
	z: number;
	phaseOffset: number;
	isHub: boolean;
	degree: number;
	color: { r: number; g: number; b: number };
	firing: boolean;
	fireTimer: number;
	fireStartTime: number;
}

interface Signal {
	fromIdx: number;
	toIdx: number;
	progress: number;
	createdAt: number;
	color: { r: number; g: number; b: number };
}

interface ProjectedNode {
	sx: number;
	sy: number;
	z: number;
	scale: number;
	depth: number;
	node3d: Node3D;
}

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

// ─── Canvas Sizing ───────────────────────────────────────────────────────────

export function resizeNeuralCanvas(canvas: HTMLCanvasElement): {
	width: number;
	height: number;
	dpr: number;
	ctx: CanvasRenderingContext2D;
} {
	const rect = canvas.parentElement?.getBoundingClientRect();
	const w = rect ? rect.width : 800;
	const h = rect ? rect.height : 600;
	const dpr = window.devicePixelRatio || 1;
	canvas.width = w * dpr;
	canvas.height = h * dpr;
	canvas.style.width = w + "px";
	canvas.style.height = h + "px";
	const ctx = canvas.getContext("2d")!;
	ctx.scale(dpr, dpr);
	return { width: w, height: h, dpr, ctx };
}

// ─── Color Helpers ───────────────────────────────────────────────────────────

function getNodeColor(type: string): { r: number; g: number; b: number } {
	const idx = TYPE_COLOR_INDEX[type] ?? 4;
	return PALETTE[idx];
}

// ─── 3D Projection — Dual-Axis Rotation ──────────────────────────────────────

function project3D(
	x: number,
	y: number,
	z: number,
	width: number,
	height: number,
	rotY: number,
	rotX: number,
	focalLength: number
): { sx: number; sy: number; z: number; scale: number; depth: number } {
	// Rotate around Y axis
	const cosY = Math.cos(rotY);
	const sinY = Math.sin(rotY);
	const rx = x * cosY + z * sinY;
	const rz = -x * sinY + z * cosY;

	// Rotate around X axis
	const cosX = Math.cos(rotX);
	const sinX = Math.sin(rotX);
	const ry = y * cosX - rz * sinX;
	const finalZ = y * sinX + rz * cosX;

	// Perspective projection
	const denom = focalLength + finalZ;
	const scale = denom > 1 ? focalLength / denom : 1;

	const halfW = width / 2;
	const halfH = height / 2;

	return {
		sx: rx * scale + halfW,
		sy: ry * scale + halfH,
		z: finalZ,
		scale,
		depth: finalZ
	};
}

// ─── Background ──────────────────────────────────────────────────────────────

function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number) {
	const centerX = w / 2;
	const centerY = h / 2;
	const maxR = Math.hypot(centerX, centerY);

	// Dark navy
	ctx.fillStyle = BG_DARK;
	ctx.fillRect(0, 0, w, h);

	// Vignette overlay
	const grad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, maxR);
	grad.addColorStop(0, "rgba(10,14,42,0)");
	grad.addColorStop(0.6, "rgba(10,14,42,0.1)");
	grad.addColorStop(1, "rgba(2,4,12,0.6)");
	ctx.fillStyle = grad;
	ctx.fillRect(0, 0, w, h);
}

// ─── Fog Calculation ─────────────────────────────────────────────────────────

function fogFactor(z: number): number {
	const depth = (z + FOG_FAR) / (FOG_FAR * 2);
	return Math.max(0.05, Math.min(1, 1 - depth));
}

// ─── Edge Drawing — Very Thin, Semi-Transparent ──────────────────────────────

function drawEdge3D(
	ctx: CanvasRenderingContext2D,
	from: { sx: number; sy: number; depth: number },
	to: { sx: number; sy: number; depth: number },
	edgeAlpha: number
) {
	const avgDepth = (from.depth + to.depth) / 2;
	const fog = fogFactor(avgDepth);
	const alpha = edgeAlpha * fog * 0.15;

	if (alpha < 0.005) return;

	ctx.save();
	ctx.globalAlpha = alpha;
	ctx.strokeStyle = `rgba(120, 200, 255, ${alpha})`;
	ctx.lineWidth = EDGE_BASE_WIDTH;
	ctx.beginPath();
	ctx.moveTo(from.sx, from.sy);
	ctx.lineTo(to.sx, to.sy);
	ctx.stroke();
	ctx.restore();
}

// ─── Particle Drawing — Tiny Star with Soft Bloom ────────────────────────────

function drawParticle(
	ctx: CanvasRenderingContext2D,
	sx: number,
	sy: number,
	depth: number,
	color: { r: number; g: number; b: number },
	radius: number,
	baseAlpha: number,
	twinkle: number
) {
	const fog = fogFactor(depth);
	const finalAlpha = baseAlpha * fog * twinkle;

	if (finalAlpha < 0.01) return;

	ctx.save();

	// Soft bloom glow (additive)
	ctx.globalCompositeOperation = "lighter";
	const glowR = radius * 5;
	const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, glowR);
	grad.addColorStop(0, `rgba(${color.r},${color.g},${color.b},${finalAlpha * 0.2})`);
	grad.addColorStop(0.5, `rgba(${color.r},${color.g},${color.b},${finalAlpha * 0.05})`);
	grad.addColorStop(1, `rgba(${color.r},${color.g},${color.b},0)`);
	ctx.fillStyle = grad;
	ctx.beginPath();
	ctx.arc(sx, sy, glowR, 0, Math.PI * 2);
	ctx.fill();

	// Core particle (tiny bright dot)
	const br = Math.min(255, color.r + 60);
	const bg = Math.min(255, color.g + 60);
	const bb = Math.min(255, color.b + 60);
	ctx.beginPath();
	ctx.arc(sx, sy, Math.max(0.5, radius), 0, Math.PI * 2);
	ctx.fillStyle = `rgba(${br},${bg},${bb},${finalAlpha * 0.9})`;
	ctx.fill();

	ctx.restore();
}

// ─── Tooltip Drawing ─────────────────────────────────────────────────────────

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
	r = Math.min(r, w / 2, h / 2);
	c.beginPath();
	c.moveTo(x + r, y);
	c.lineTo(x + w - r, y);
	c.arcTo(x + w, y, x + w, y + r, r);
	c.lineTo(x + w, y + h - r);
	c.arcTo(x + w, y + h, x + w - r, y + h, r);
	c.lineTo(x + r, y + h);
	c.arcTo(x, y + h, x, y + h - r, r);
	c.lineTo(x, y + r);
	c.arcTo(x, y, x + r, y, r);
	c.closePath();
}

function drawTooltip(
	ctx: CanvasRenderingContext2D,
	node: LayoutNode,
	pos: { x: number; y: number },
	canvasWidth: number,
	canvasHeight: number
) {
	ctx.save();
	const lines = [
		node.name,
		`Type: ${node.type}`,
		node.description ?? "",
		node.memoryCount != null ? `Memories: ${node.memoryCount}` : ""
	].filter(Boolean);

	ctx.font = "11px system-ui,sans-serif";
	const maxW = Math.max(...lines.map((l) => ctx.measureText(l).width));
	const pad = 10;
	const lh = 16;
	const tw = maxW + pad * 2;
	const th = lines.length * lh + pad * 2;

	let tx = pos.x + 12;
	let ty = pos.y - 12;
	if (tx + tw > canvasWidth) tx = pos.x - tw - 12;
	if (ty + th > canvasHeight) ty = canvasHeight - th - 4;
	if (ty < 4) ty = 4;

	ctx.fillStyle = "rgba(2,6,23,0.92)";
	ctx.shadowColor = "rgba(0,0,0,0.2)";
	ctx.shadowBlur = 12;
	roundRect(ctx, tx, ty, tw, th, 8);
	ctx.fill();
	ctx.shadowBlur = 0;
	ctx.strokeStyle = "rgba(148,163,184,0.2)";
	ctx.lineWidth = 1;
	roundRect(ctx, tx, ty, tw, th, 8);
	ctx.stroke();

	ctx.textAlign = "left";
	ctx.textBaseline = "top";
	for (let i = 0; i < lines.length; i++) {
		const isTitle = i === 0;
		ctx.font = isTitle ? "bold 12px system-ui,sans-serif" : "10px system-ui,sans-serif";
		ctx.fillStyle = "#e2e8f0";
		ctx.fillText(lines[i], tx + pad, ty + pad + i * lh);
	}
	ctx.restore();
}

// ─── Overflow Notice ─────────────────────────────────────────────────────────

function drawOverflowNotice(ctx: CanvasRenderingContext2D, w: number, hiddenNodeCount: number) {
	ctx.save();
	const label = `+${hiddenNodeCount} hidden`;
	ctx.font = "bold 11px system-ui,sans-serif";
	ctx.textAlign = "right";
	ctx.textBaseline = "top";
	const padX = 10;
	const padY = 7;
	const noticeWidth = ctx.measureText(label).width + padX * 2;
	const noticeHeight = 26;
	const x = Math.max(8, w - noticeWidth - 12);
	const y = 12;

	ctx.fillStyle = "rgba(15,23,42,0.88)";
	roundRect(ctx, x, y, noticeWidth, noticeHeight, 999);
	ctx.fill();
	ctx.strokeStyle = "rgba(148,163,184,0.28)";
	ctx.lineWidth = 1;
	roundRect(ctx, x, y, noticeWidth, noticeHeight, 999);
	ctx.stroke();
	ctx.fillStyle = "#bfdbfe";
	ctx.fillText(label, x + noticeWidth - padX, y + padY);
	ctx.restore();
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
			z: (node as any).z ?? 0, // use actual 3D position from sphere layout
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
			nodeIndexById.set(n.id, i);
			nodeIndexById.set(n.name, i);
		});
	}

	rebuildDerived();

	// Signals array
	const signals: Signal[] = [];
	let lastSignalSpawn = 0;

	// ── Hub signal spawning ──
	function spawnSignals(now: number) {
		if (now - lastSignalSpawn < SIGNAL_SPAWN_INTERVAL) return;
		if (signals.length >= MAX_SIGNALS) return;
		lastSignalSpawn = now;

		for (const n3d of nodes3d) {
			if (!n3d.isHub) continue;
			if (signals.length >= MAX_SIGNALS) break;

			// Find edges connected to this hub
			const hubEdges = animEdges.filter((e) => e.source === n3d.node.id || e.target === n3d.node.id);
			if (hubEdges.length === 0) continue;

			const edge = hubEdges[Math.floor(Math.random() * hubEdges.length)];
			const fromId = edge.source === n3d.node.id ? edge.source : edge.target;
			const toId = edge.source === n3d.node.id ? edge.target : edge.source;

			const fromIdx = nodeIndexById.get(fromId);
			const toIdx = nodeIndexById.get(toId);
			if (fromIdx === undefined || toIdx === undefined) continue;

			if (Math.random() > 0.4) continue;

			signals.push({
				fromIdx,
				toIdx,
				progress: 0,
				createdAt: now,
				color: n3d.color
			});
		}
	}

	// ── Signal update ──
	function updateSignals() {
		for (let i = signals.length - 1; i >= 0; i--) {
			signals[i].progress += SIGNAL_SPEED;
			if (signals[i].progress >= 1) {
				signals.splice(i, 1);
			}
		}
	}

	// ── Main render frame ──
	function render(now: number) {
		// Rebuild derived data if nodes/edges were updated externally
		if (animDataDirty) {
			animDataDirty = false;
			signals.length = 0;
			rebuildDerived();
		}

		const dt = now - lastTimestamp;
		lastTimestamp = now;
		totalElapsed += dt;

		// Camera rotation
		const isZeroEdge = animEdges.length === 0;
		const rotY = isZeroEdge ? 0 : totalElapsed * CAMERA_ROTATION_SPEED;
		const rotX = isZeroEdge ? 0 : Math.sin(totalElapsed * 0.00004) * CAMERA_TILT_AMOUNT;

		// Breathing
		const breathe = isZeroEdge ? 1 : 1 + Math.sin(totalElapsed * BREATHE_SPEED) * BREATHE_AMOUNT;

		// Clear and draw background
		ctx.clearRect(0, 0, width, height);
		drawBackground(ctx, width, height);

		// Update signals
		spawnSignals(now);
		updateSignals();

		// Project all nodes (3D → 2D) with sphere breathing
		const projected: ProjectedNode[] = nodes3d.map((n3d) => {
			const bx = (n3d.x - cx) * breathe + cx;
			const by = (n3d.y - cy) * breathe + cy;
			const bz = n3d.z * breathe;
			const proj = project3D(bx - cx, by - cy, bz, width, height, rotY, rotX, FOCAL_LENGTH);
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
			const idx = nodeIndexById.get(p.node3d.node.id) ?? nodeIndexById.get(p.node3d.node.name);
			if (idx !== undefined && idx >= 0) projByIndex.set(idx, p);
		});

		// ── Draw edges (far to near) ──
		const renderedEdges = animEdges
			.map((e) => {
				const srcIdx = nodeIndexById.get(e.source);
				const tgtIdx = nodeIndexById.get(e.target);
				if (srcIdx === undefined || tgtIdx === undefined) return null;
				const fromP = projByIndex.get(srcIdx);
				const toP = projByIndex.get(tgtIdx);
				if (!fromP || !toP) return null;
				if (fromP.scale < 0.05 || toP.scale < 0.05) return null;

				const avgZ = (fromP.depth + toP.depth) / 2;
				const maxZ = FOG_FAR * 1.5;
				const edgeAlpha = Math.max(0.1, Math.min(0.7, (avgZ + maxZ) / (maxZ * 2)));

				return { from: fromP, to: toP, edgeAlpha, avgDepth: avgZ };
			})
			.filter((x): x is { from: ProjectedNode; to: ProjectedNode; edgeAlpha: number; avgDepth: number } => x !== null);

		// Sort edges by depth (far to near)
		renderedEdges.sort((a, b) => b.avgDepth - a.avgDepth);

		for (const re of renderedEdges) {
			drawEdge3D(ctx, re.from, re.to, re.edgeAlpha);
		}

		// ── Draw signals ──
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

			const proj = project3D(ix - cx, iy - cy, iz, width, height, rotY, rotX, FOCAL_LENGTH);

			const brightness = Math.sin(sig.progress * Math.PI);
			if (brightness <= 0 || proj.scale < 0.05) continue;

			// Draw signal as a tiny bright particle
			const sigFog = fogFactor(proj.depth);
			const sigAlpha = brightness * sigFog;
			const size = Math.max(0.5, (1.5 + brightness * 1.2) * Math.min(proj.scale, 1.5));

			ctx.save();
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
			const baselineScale = FOCAL_LENGTH / (FOCAL_LENGTH + FOG_FAR);
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
					ctx.save();
					ctx.globalAlpha = labelAlpha;

					// Background pill for readability
					const name = node.name;
					ctx.font = "bold 10px system-ui,sans-serif";
					const tw = ctx.measureText(name).width;
					const pillPad = 6;
					const pillH = 18;
					const pillY = p.sy + drawRadius + 6;

					ctx.fillStyle = "rgba(2,6,23,0.85)";
					ctx.shadowColor = "rgba(0,0,0,0.3)";
					ctx.shadowBlur = 8;
					roundRect(ctx, p.sx - tw / 2 - pillPad, pillY, tw + pillPad * 2, pillH, 4);
					ctx.fill();
					ctx.shadowBlur = 0;

					// Name text
					ctx.textAlign = "center";
					ctx.textBaseline = "middle";
					ctx.fillStyle = "#e2e8f0";
					ctx.fillText(name, p.sx, pillY + pillH / 2);

					// Type subtitle below pill
					if (node.type) {
						ctx.font = "8px system-ui,sans-serif";
						ctx.fillStyle = "rgba(148,163,184,0.7)";
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

// ─── External Dimension Update ─────────────────────────────────────────────

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
