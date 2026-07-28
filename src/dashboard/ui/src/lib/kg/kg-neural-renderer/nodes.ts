/**
 * Node rendering for the Knowledge Graph Neural Renderer.
 */

import type { LayoutNode, LayoutEdge } from "../KGForceLayout";
import { isDarkMode, fogFactor, roundRect } from "./layout";

// ─── Public Types ────────────────────────────────────────────────────────────

export interface NeuralRenderState {
	hoveredNode: LayoutNode | null;
	selectedNode: LayoutNode | null;
	selectedEdge: LayoutEdge | null;
	showTooltip: boolean;
	tooltipPos: { x: number; y: number };
	hiddenNodeCount?: number;
}

// ─── Particle Drawing — Tiny Star with Soft Bloom ────────────────────────────

export function drawParticle(
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

	const dark = isDarkMode();

	ctx.save();

	if (dark) {
		// Dark mode: additive glow (original cinematic look)
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

		// Core particle
		const br = Math.min(255, color.r + 60);
		const bg = Math.min(255, color.g + 60);
		const bb = Math.min(255, color.b + 60);
		ctx.beginPath();
		ctx.arc(sx, sy, Math.max(0.5, radius), 0, Math.PI * 2);
		ctx.fillStyle = `rgba(${br},${bg},${bb},${finalAlpha * 0.9})`;
		ctx.fill();
	} else {
		// Light mode: darken colors for contrast against light background
		const darken = (v: number) => Math.round(v * 0.65);
		const cr = darken(color.r);
		const cg = darken(color.g);
		const cb = darken(color.b);

		// Light mode: normal blending with soft shadow + solid core
		const glowR = radius * 4;
		const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, glowR);
		grad.addColorStop(0, `rgba(${cr},${cg},${cb},${finalAlpha * 0.18})`);
		grad.addColorStop(0.4, `rgba(${cr},${cg},${cb},${finalAlpha * 0.07})`);
		grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
		ctx.fillStyle = grad;
		ctx.beginPath();
		ctx.arc(sx, sy, glowR, 0, Math.PI * 2);
		ctx.fill();

		// Core particle — full color, solid
		ctx.beginPath();
		ctx.arc(sx, sy, Math.max(1.0, radius), 0, Math.PI * 2);
		ctx.fillStyle = `rgba(${cr},${cg},${cb},${finalAlpha})`;
		ctx.fill();

		// Inner bright core
		const ir = Math.max(0.5, radius * 0.45);
		const br = Math.min(255, cr + 80);
		const bg = Math.min(255, cg + 80);
		const bb = Math.min(255, cb + 80);
		ctx.beginPath();
		ctx.arc(sx, sy, ir, 0, Math.PI * 2);
		ctx.fillStyle = `rgba(${br},${bg},${bb},${finalAlpha})`;
		ctx.fill();
	}

	ctx.restore();
}

// ─── Tooltip Drawing ─────────────────────────────────────────────────────────

export function drawTooltip(
	ctx: CanvasRenderingContext2D,
	node: LayoutNode,
	pos: { x: number; y: number },
	canvasWidth: number,
	canvasHeight: number
) {
	const dark = isDarkMode();
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
	ctx.restore();
}

// ─── Overflow Notice ─────────────────────────────────────────────────────────

export function drawOverflowNotice(ctx: CanvasRenderingContext2D, w: number, hiddenNodeCount: number) {
	const dark = isDarkMode();
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

	ctx.fillStyle = dark ? "rgba(15,23,42,0.88)" : "rgba(255,255,255,0.9)";
	roundRect(ctx, x, y, noticeWidth, noticeHeight, 999);
	ctx.fill();
	ctx.strokeStyle = dark ? "rgba(148,163,184,0.28)" : "rgba(59,130,246,0.22)";
	ctx.lineWidth = 1;
	roundRect(ctx, x, y, noticeWidth, noticeHeight, 999);
	ctx.stroke();
	ctx.fillStyle = dark ? "#bfdbfe" : "#1d4ed8";
	ctx.fillText(label, x + noticeWidth - padX, y + padY);
	ctx.restore();
}
