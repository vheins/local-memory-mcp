/**
 * 3D Neural Animation Renderer for the Knowledge Graph.
 *
 * Projects 2D force-layout positions into 3D with perspective projection,
 * orbiting rotation, depth sorting, and glowing neural aesthetics inspired
 * by the sentinel-agent login page animation.
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

const FOCAL_LENGTH = 300;
const MAX_Z_OFFSET = 100;
const MAX_ROTATION_DEG = 15;
const ROTATION_SPEED = 0.0003; // radians per ms
const HUB_DEGREE_THRESHOLD = 3;
const BASE_NODE_RADIUS = 18;
const HUB_NODE_RADIUS = 26;
const MAX_SIGNALS = 50;
const SIGNAL_SPEED = 0.0018; // progress per ms
const SIGNAL_SPAWN_INTERVAL = 600; // ms between hub signal spawns
const NODE_PULSE_SPEED = 0.002;
const HUB_FLASH_DURATION = 300; // ms

const TYPE_COLORS: Record<string, string> = {
	person: "#22c55e",
	place: "#3b82f6",
	organization: "#f97316",
	concept: "#a855f7",
	unknown: "#6b7280"
};

const TYPE_GLOWS: Record<string, string> = {
	person: "rgba(34,197,94,0.35)",
	place: "rgba(59,130,246,0.35)",
	organization: "rgba(249,115,22,0.35)",
	concept: "rgba(168,85,247,0.35)",
	unknown: "rgba(107,114,128,0.25)"
};

const BG_DARK = "#0a0e1a";
const BG_LIGHT = "#f0f4ff";

// ─── Color Helpers ───────────────────────────────────────────────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } {
	const s = hex.replace("#", "");
	const n = parseInt(s.length === 3 ? s[0] + s[0] + s[1] + s[1] + s[2] + s[2] : s, 16);
	return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function getNodeColor(type: string): string {
	return TYPE_COLORS[type] ?? TYPE_COLORS.unknown;
}

function getNodeRgb(type: string): { r: number; g: number; b: number } {
	return hexToRgb(getNodeColor(type));
}

function lighten(hex: string, amt: number): string {
	const { r, g, b } = hexToRgb(hex);
	return `rgb(${Math.min(255, r + amt)},${Math.min(255, g + amt)},${Math.min(255, b + amt)})`;
}

function isDarkMode(): boolean {
	return document.documentElement.classList.contains("dark");
}

// ─── Internal 3D Types ──────────────────────────────────────────────────────

interface Node3D {
	node: LayoutNode;
	z: number; // z-offset assigned at init
	phaseOffset: number; // per-node pulse phase
	isHub: boolean;
	degree: number;
	// Hub flash state
	firing: boolean;
	fireTimer: number;
	fireStartTime: number;
}

interface Signal {
	fromIdx: number;
	toIdx: number;
	progress: number;
	speed: number;
	createdAt: number;
}

interface ProjectedNode {
	sx: number;
	sy: number;
	z: number;
	scale: number;
	node3d: Node3D;
}

// ─── Module-Level Animation State ────────────────────────────────────────────

let animationId: number | null = null;
let currentCleanup: (() => void) | null = null;

// Mutable references to the current nodes/edges arrays.
// Updated externally via `updateAnimationData` without restarting the loop.
let animNodes: LayoutNode[] = [];
let animEdges: LayoutEdge[] = [];
let animDataDirty = false;

// ─── Module-Level Canvas Dimensions ───────────────────────────────────────
// Updated by `startNeuralAnimation` and the exported `updateNeuralDimensions`.
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
	const width = rect ? rect.width : 800;
	const height = rect ? rect.height : 600;
	const dpr = window.devicePixelRatio || 1;
	canvas.width = width * dpr;
	canvas.height = height * dpr;
	canvas.style.width = width + "px";
	canvas.style.height = height + "px";
	const ctx = canvas.getContext("2d")!;
	ctx.scale(dpr, dpr);
	return { width, height, dpr, ctx };
}

// ─── Drawing Primitives ─────────────────────────────────────────────────────

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

// ─── Perspective Projection ──────────────────────────────────────────────────

function project3D(
	x: number,
	y: number,
	z: number,
	cx: number,
	cy: number,
	rotAngle: number
): { sx: number; sy: number; scale: number; rz: number } {
	const cosA = Math.cos(rotAngle);
	const sinA = Math.sin(rotAngle);
	// Rotate around Y axis
	const rx = x * cosA + z * sinA;
	const ry = y;
	const rz = -x * sinA + z * cosA;

	const denom = FOCAL_LENGTH + rz;
	const scale = denom > 1 ? FOCAL_LENGTH / denom : FOCAL_LENGTH;
	return { sx: rx * scale + cx, sy: ry * scale + cy, scale, rz };
}

// ─── Background ──────────────────────────────────────────────────────────────

function drawBackground(ctx: CanvasRenderingContext2D, width: number, height: number) {
	const dark = isDarkMode();
	const cx = width / 2;
	const cy = height / 2;
	const maxR = Math.hypot(cx, cy);

	// Base fill
	ctx.fillStyle = dark ? BG_DARK : BG_LIGHT;
	ctx.fillRect(0, 0, width, height);

	// Subtle radial gradient overlay for depth
	const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
	if (dark) {
		grad.addColorStop(0, "rgba(15,23,42,0.0)");
		grad.addColorStop(0.7, "rgba(2,6,23,0.15)");
		grad.addColorStop(1, "rgba(2,6,23,0.4)");
	} else {
		grad.addColorStop(0, "rgba(200,220,255,0.0)");
		grad.addColorStop(0.7, "rgba(180,200,240,0.08)");
		grad.addColorStop(1, "rgba(160,180,220,0.15)");
	}
	ctx.fillStyle = grad;
	ctx.fillRect(0, 0, width, height);
}

// ─── Edge Drawing ────────────────────────────────────────────────────────────

function drawEdge3D(
	ctx: CanvasRenderingContext2D,
	from: { sx: number; sy: number; scale: number },
	to: { sx: number; sy: number; scale: number },
	edge: LayoutEdge,
	isSelectedEdge: boolean,
	isHubA: boolean,
	isHubB: boolean,
	avgDepthAlpha: number
) {
	const dark = isDarkMode();
	const lineWidth = isSelectedEdge ? 2.5 : isHubA || isHubB ? 1.8 : 1.0;

	let strokeColor: string;
	if (isSelectedEdge) {
		strokeColor = `rgba(245,158,11,${avgDepthAlpha * 0.8})`;
	} else {
		const baseAlpha = avgDepthAlpha * 0.35;
		strokeColor = dark ? `rgba(148,163,184,${baseAlpha})` : `rgba(100,116,139,${baseAlpha})`;
	}

	ctx.beginPath();
	ctx.moveTo(from.sx, from.sy);
	ctx.lineTo(to.sx, to.sy);
	ctx.strokeStyle = strokeColor;
	ctx.lineWidth = lineWidth;
	ctx.stroke();
}

// ─── Signal Drawing ──────────────────────────────────────────────────────────

function drawSignal(
	ctx: CanvasRenderingContext2D,
	sx: number,
	sy: number,
	scale: number,
	signalBrightness: number,
	color: { r: number; g: number; b: number }
) {
	const size = Math.max(0.5, (1.5 + signalBrightness * 1.2) * Math.min(scale, 1.5));

	// Outer glow
	ctx.beginPath();
	ctx.arc(sx, sy, size * 3, 0, Math.PI * 2);
	ctx.fillStyle = `rgba(${color.r},${color.g},${color.b},${signalBrightness * 0.1})`;
	ctx.fill();

	// Inner glow
	ctx.beginPath();
	ctx.arc(sx, sy, size * 1.5, 0, Math.PI * 2);
	ctx.fillStyle = `rgba(${color.r},${color.g},${color.b},${signalBrightness * 0.3})`;
	ctx.fill();

	// Core
	const bright = Math.min(255, color.r + 80);
	const bg = Math.min(255, color.g + 80);
	const bb = Math.min(255, color.b + 80);
	ctx.beginPath();
	ctx.arc(sx, sy, size, 0, Math.PI * 2);
	ctx.fillStyle = `rgba(${bright},${bg},${bb},${signalBrightness * 0.9})`;
	ctx.fill();
}

// ─── Node Drawing ────────────────────────────────────────────────────────────

function drawNode3D(
	ctx: CanvasRenderingContext2D,
	p: ProjectedNode,
	now: number,
	isHovered: boolean,
	isSelected: boolean
) {
	const dark = isDarkMode();
	const n3d = p.node3d;
	const node = n3d.node;
	const color = getNodeColor(node.type);
	const colorRgb = getNodeRgb(node.type);

	// Depth-based sizing
	const baselineScale = FOCAL_LENGTH / (FOCAL_LENGTH + MAX_Z_OFFSET);
	const normalizedScale = p.scale / baselineScale;
	const depthAlpha = Math.max(0.25, Math.min(1, (normalizedScale - 0.15) / 0.85));

	// Pulse animation
	const pulse = 1 + Math.sin(now * NODE_PULSE_SPEED + n3d.phaseOffset) * 0.15;
	const hubBoost = n3d.isHub ? 1.35 : 1.0;
	const hoverBoost = isHovered || isSelected ? 1.2 : 1.0;
	const radius =
		(n3d.isHub ? HUB_NODE_RADIUS : BASE_NODE_RADIUS) *
		pulse *
		hubBoost *
		hoverBoost *
		Math.min(normalizedScale, 1.3) *
		0.9;

	if (radius < 0.3 || p.scale < 0.05) return;

	const alpha = depthAlpha;

	// Hub outer glow
	if (n3d.isHub && alpha > 0.08) {
		const glowRadius = radius * 3;
		const glowGrad = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, glowRadius);
		glowGrad.addColorStop(0, `rgba(${colorRgb.r},${colorRgb.g},${colorRgb.b},${alpha * 0.25})`);
		glowGrad.addColorStop(0.4, `rgba(${colorRgb.r},${colorRgb.g},${colorRgb.b},${alpha * 0.06})`);
		glowGrad.addColorStop(1, `rgba(${colorRgb.r},${colorRgb.g},${colorRgb.b},0)`);
		ctx.fillStyle = glowGrad;
		ctx.beginPath();
		ctx.arc(p.sx, p.sy, glowRadius, 0, Math.PI * 2);
		ctx.fill();
	}

	// Hub firing flash
	if (n3d.firing) {
		const elapsed = now - n3d.fireStartTime;
		const flashProgress = Math.min(1, elapsed / HUB_FLASH_DURATION);
		const flashAlpha = (1 - flashProgress) * 0.4 * alpha;
		if (flashAlpha > 0.01) {
			const flashR = radius * 3;
			const flashGrad = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, flashR);
			const brightR = Math.min(255, colorRgb.r + 120);
			const brightG = Math.min(255, colorRgb.g + 120);
			const brightB = Math.min(255, colorRgb.b + 120);
			flashGrad.addColorStop(0, `rgba(${brightR},${brightG},${brightB},${flashAlpha})`);
			flashGrad.addColorStop(1, `rgba(${brightR},${brightG},${brightB},0)`);
			ctx.fillStyle = flashGrad;
			ctx.beginPath();
			ctx.arc(p.sx, p.sy, flashR, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	// Hover/select glow ring
	if (isHovered || isSelected) {
		const ringGrad = ctx.createRadialGradient(p.sx, p.sy, radius * 0.8, p.sx, p.sy, radius * 2.2);
		const glowColor = isSelected ? "#f59e0b" : (TYPE_GLOWS[node.type] ?? TYPE_GLOWS.unknown);
		const glowRgb = isSelected ? { r: 245, g: 158, b: 11 } : hexToRgb(glowColor.replace(/rgba?\([^)]+\)/, () => ""));
		// Use glow color directly
		ringGrad.addColorStop(0, `rgba(${glowRgb.r},${glowRgb.g},${glowRgb.b},0.25)`);
		ringGrad.addColorStop(1, `rgba(${glowRgb.r},${glowRgb.g},${glowRgb.b},0)`);
		ctx.fillStyle = ringGrad;
		ctx.beginPath();
		ctx.arc(p.sx, p.sy, radius * 2.2, 0, Math.PI * 2);
		ctx.fill();
	}

	// Main node body — radial gradient
	const grad = ctx.createRadialGradient(p.sx - radius * 0.2, p.sy - radius * 0.2, radius * 0.1, p.sx, p.sy, radius);
	grad.addColorStop(0, dark ? lighten(color, 50) : lighten(color, 70));
	grad.addColorStop(1, color);
	ctx.fillStyle = grad;
	ctx.globalAlpha = alpha;
	ctx.beginPath();
	ctx.arc(p.sx, p.sy, radius, 0, Math.PI * 2);
	ctx.fill();
	ctx.globalAlpha = 1;

	// Border
	ctx.strokeStyle = isSelected ? "#f59e0b" : dark ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.6)";
	ctx.lineWidth = isSelected ? 2.5 : 1.2;
	ctx.stroke();

	// Memory count badge
	if (node.memoryCount && node.memoryCount > 0) {
		const badgeX = p.sx + radius - 5;
		const badgeY = p.sy - radius + 5;
		const badgeR = 8 * Math.min(normalizedScale, 1.1);
		ctx.fillStyle = dark ? "#1e293b" : "#ffffff";
		ctx.globalAlpha = alpha;
		ctx.beginPath();
		ctx.arc(badgeX, badgeY, badgeR, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = color;
		ctx.font = `bold ${Math.max(7, 8 * Math.min(normalizedScale, 1.1))}px system-ui,sans-serif`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(String(node.memoryCount), badgeX, badgeY);
		ctx.globalAlpha = 1;
	}

	// Label — depth-faded
	if (normalizedScale > 0.3) {
		const labelAlpha = Math.max(0, (normalizedScale - 0.3) / 0.7) * alpha;
		if (labelAlpha > 0.05) {
			ctx.globalAlpha = labelAlpha;
			ctx.fillStyle = dark ? "#e2e8f0" : "#1e293b";
			ctx.font = `bold ${Math.max(9, 11 * Math.min(normalizedScale, 1.1))}px system-ui,sans-serif`;
			ctx.textAlign = "center";
			ctx.textBaseline = "top";
			ctx.fillText(node.name, p.sx, p.sy + radius + 4);

			// Description
			if (node.description) {
				ctx.fillStyle = dark ? "rgba(148,163,184,0.6)" : "rgba(100,116,139,0.6)";
				ctx.font = `${Math.max(7, 8 * Math.min(normalizedScale, 1.1))}px system-ui,sans-serif`;
				const desc = node.description.length > 18 ? node.description.slice(0, 18) + "..." : node.description;
				ctx.fillText(desc, p.sx, p.sy + radius + 16);
			}
			ctx.globalAlpha = 1;
		}
	}
}

// ─── Tooltip Drawing ─────────────────────────────────────────────────────────

function drawTooltip(
	ctx: CanvasRenderingContext2D,
	node: LayoutNode,
	pos: { x: number; y: number },
	canvasWidth: number,
	canvasHeight: number
) {
	const dark = isDarkMode();
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

	ctx.fillStyle = dark ? "rgba(2,6,23,0.92)" : "rgba(255,255,255,0.95)";
	ctx.shadowColor = "rgba(0,0,0,0.2)";
	ctx.shadowBlur = 12;
	roundRect(ctx, tx, ty, tw, th, 8);
	ctx.fill();
	ctx.shadowBlur = 0;
	ctx.strokeStyle = dark ? "rgba(148,163,184,0.2)" : "rgba(0,0,0,0.08)";
	ctx.lineWidth = 1;
	roundRect(ctx, tx, ty, tw, th, 8);
	ctx.stroke();

	ctx.textAlign = "left";
	ctx.textBaseline = "top";
	for (let i = 0; i < lines.length; i++) {
		const isTitle = i === 0;
		ctx.font = isTitle ? "bold 12px system-ui,sans-serif" : "10px system-ui,sans-serif";
		ctx.fillStyle = dark ? "#e2e8f0" : "#1e293b";
		ctx.fillText(lines[i], tx + pad, ty + pad + i * lh);
	}
}

// ─── Overflow Notice ─────────────────────────────────────────────────────────

function drawOverflowNotice(ctx: CanvasRenderingContext2D, width: number, hiddenNodeCount: number) {
	const dark = isDarkMode();
	const label = `+${hiddenNodeCount} hidden`;
	ctx.font = "bold 11px system-ui,sans-serif";
	ctx.textAlign = "right";
	ctx.textBaseline = "top";
	const padX = 10;
	const padY = 7;
	const noticeWidth = ctx.measureText(label).width + padX * 2;
	const noticeHeight = 26;
	const x = Math.max(8, width - noticeWidth - 12);
	const y = 12;

	ctx.fillStyle = dark ? "rgba(15,23,42,0.88)" : "rgba(255,255,255,0.9)";
	roundRect(ctx, x, y, noticeWidth, noticeHeight, 999);
	ctx.fill();
	ctx.strokeStyle = dark ? "rgba(148,163,184,0.28)" : "rgba(59,130,246,0.22)";
	ctx.lineWidth = 1;
	roundRect(ctx, x, y, noticeWidth, noticeHeight, 999);
	ctx.stroke();
	ctx.fillStyle = dark ? "#bfdbfe" : "#1d4ed8";
	ctx.fillText(label, x + noticeWidth - padX, y + padY);
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
	// Stop any previous animation
	stopNeuralAnimation();

	// Initialise module-level dimensions from caller-provided values
	width = initialWidth;
	height = initialHeight;
	cx = width / 2;
	cy = height / 2;

	// Store references in module-level variables for external updates
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
	let totalElapsed = 0; // ms
	let rotationAngle = 0;
	let lastSignalSpawn = 0;

	// ── Derived data (rebuilt when animNodes/animEdges change) ──
	let degreeMap = new Map<string, number>();
	let nodeById = new Map<string, LayoutNode>();
	let nodes3d: Node3D[] = [];
	let nodeIndexById = new Map<string, number>();

	function rebuildDerived() {
		degreeMap = new Map<string, number>();
		for (const e of animEdges) {
			degreeMap.set(e.source, (degreeMap.get(e.source) ?? 0) + 1);
			degreeMap.set(e.target, (degreeMap.get(e.target) ?? 0) + 1);
		}

		nodeById = new Map<string, LayoutNode>();
		for (const n of animNodes) {
			nodeById.set(n.id, n);
			nodeById.set(n.name, n);
		}

		nodes3d = animNodes.map((node) => ({
			node,
			z: (Math.random() - 0.5) * 2 * MAX_Z_OFFSET,
			phaseOffset: Math.random() * Math.PI * 2,
			isHub: (degreeMap.get(node.id) ?? 0) >= HUB_DEGREE_THRESHOLD,
			degree: degreeMap.get(node.id) ?? 0,
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

			// Randomly pick one edge to fire a signal along
			const edge = hubEdges[Math.floor(Math.random() * hubEdges.length)];
			const fromId = edge.source === n3d.node.id ? edge.source : edge.target;
			const toId = edge.source === n3d.node.id ? edge.target : edge.source;

			const fromIdx = nodeIndexById.get(fromId);
			const toIdx = nodeIndexById.get(toId);
			if (fromIdx === undefined || toIdx === undefined) continue;

			// Random 40% chance per spawn interval
			if (Math.random() > 0.4) continue;

			signals.push({
				fromIdx,
				toIdx,
				progress: 0,
				speed: SIGNAL_SPEED * (0.7 + Math.random() * 0.6),
				createdAt: now
			});
		}
	}

	// ── Hub flash updating ──
	function updateHubs(now: number) {
		for (const n3d of nodes3d) {
			if (!n3d.isHub) continue;
			if (n3d.firing) {
				if (now - n3d.fireStartTime >= HUB_FLASH_DURATION) {
					n3d.firing = false;
					n3d.fireTimer = 1500 + Math.random() * 2500;
				}
			} else {
				n3d.fireTimer -= 16; // approximate ms per frame
				if (n3d.fireTimer <= 0) {
					n3d.firing = true;
					n3d.fireStartTime = now;
				}
			}
		}
	}

	// ── Signal update ──
	function updateSignals() {
		for (let i = signals.length - 1; i >= 0; i--) {
			const sig = signals[i];
			sig.progress += sig.speed;
			if (sig.progress >= 1) {
				signals.splice(i, 1);
			}
		}
	}

	// ── Main render frame ──
	function render(now: number) {
		// Rebuild derived data if nodes/edges were updated externally
		if (animDataDirty) {
			animDataDirty = false;
			signals.length = 0; // clear stale signals
			rebuildDerived();
		}

		const dt = now - lastTimestamp;
		lastTimestamp = now;
		totalElapsed += dt;

		// Subtle Y-axis rotation oscillation
		rotationAngle = Math.sin(totalElapsed * ROTATION_SPEED) * ((MAX_ROTATION_DEG * Math.PI) / 180);

		// Update hubs and signals
		updateHubs(now);
		spawnSignals(now);
		updateSignals();

		// Clear and draw background
		ctx.clearRect(0, 0, width, height);
		drawBackground(ctx, width, height);

		// Project all nodes to 2D
		const projected: ProjectedNode[] = nodes3d.map((n3d) => {
			const { sx, sy, scale, rz } = project3D(n3d.node.x, n3d.node.y, n3d.z, cx, cy, rotationAngle);
			return { sx, sy, z: rz, scale, node3d: n3d };
		});

		// Depth sort: far to near (largest z first)
		projected.sort((a, b) => b.z - a.z);

		// Build projected lookup by original index
		const projByIndex = new Map<number, ProjectedNode>();
		projected.forEach((p) => {
			const idx = animNodes.indexOf(p.node3d.node);
			if (idx >= 0) projByIndex.set(idx, p);
		});

		// ── Draw edges (far to near) ──
		const drawnEdges = new Set<string>();
		for (const p of projected) {
			const nIdx = animNodes.indexOf(p.node3d.node);
			if (nIdx < 0) continue;

			for (const e of animEdges) {
				const srcIdx = nodeIndexById.get(e.source);
				const tgtIdx = nodeIndexById.get(e.target);
				if (srcIdx === undefined || tgtIdx === undefined) continue;

				// Only draw once per edge
				const key = srcIdx < tgtIdx ? `${srcIdx}-${tgtIdx}` : `${tgtIdx}-${srcIdx}`;
				if (drawnEdges.has(key)) continue;
				if (srcIdx !== nIdx && tgtIdx !== nIdx) continue;
				drawnEdges.add(key);

				const fromP = projByIndex.get(srcIdx);
				const toP = projByIndex.get(tgtIdx);
				if (!fromP || !toP) continue;
				if (fromP.scale < 0.05 || toP.scale < 0.05) continue;

				const avgZ = (fromP.z + toP.z) / 2;
				const maxZ = MAX_Z_OFFSET * 1.5;
				const depthAlpha = Math.max(0.1, Math.min(0.7, (avgZ + maxZ) / (maxZ * 2)));

				const srcNode = nodes3d[srcIdx];
				const tgtNode = nodes3d[tgtIdx];

				const isSelected = state.selectedEdge === e;

				drawEdge3D(ctx, fromP, toP, e, isSelected, srcNode?.isHub ?? false, tgtNode?.isHub ?? false, depthAlpha);
			}
		}

		// ── Draw signals ──
		const colorCache = new Map<string, { r: number; g: number; b: number }>();
		for (const sig of signals) {
			const fromN = animNodes[sig.fromIdx];
			const toN = animNodes[sig.toIdx];
			if (!fromN || !toN) continue;

			const fromN3d = nodes3d[sig.fromIdx];
			const toN3d = nodes3d[sig.toIdx];
			if (!fromN3d || !toN3d) continue;

			// Interpolate 3D position
			const ix = fromN.x + (toN.x - fromN.x) * sig.progress;
			const iy = fromN.y + (toN.y - fromN.y) * sig.progress;
			const iz = fromN3d.z + (toN3d.z - fromN3d.z) * sig.progress;

			const { sx, sy, scale } = project3D(ix, iy, iz, cx, cy, rotationAngle);

			const brightness = Math.sin(sig.progress * Math.PI);
			if (brightness <= 0 || scale < 0.05) continue;

			// Use source node's color for the signal
			const colorKey = fromN.type;
			let signalColor = colorCache.get(colorKey);
			if (!signalColor) {
				signalColor = getNodeRgb(fromN.type);
				colorCache.set(colorKey, signalColor);
			}

			drawSignal(ctx, sx, sy, scale, brightness, signalColor);
		}

		// ── Draw nodes (far to near — already sorted) ──
		for (const p of projected) {
			const isHovered = state.hoveredNode === p.node3d.node;
			const isSelected = state.selectedNode === p.node3d.node;
			drawNode3D(ctx, p, now, isHovered, isSelected);
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
		// Frame skipping on low-end devices
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

/**
 * Recalculate canvas dimensions and update the module-level state.
 * Call this from the parent component's ResizeObserver so that only one
 * ResizeObserver owns the canvas (avoids the duplicate-observer conflict).
 */
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
