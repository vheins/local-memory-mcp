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

// ─── Radial Gradient Cache ───────────────────────────────────────────────────
// The per-particle glow gradient is identical for every particle of the same
// color and theme (the color stops are fixed *fractions* of the outer radius).
// The gradient is built once, centered at the origin with a reference outer
// radius, then drawn inside a per-particle translate/scale (see below). Because
// the stops are relative to GLOW_REF_RADIUS, scaling reproduces the exact same
// gradient shape at any position/radius — no allocation per frame per particle.
// Alpha is applied via ctx.globalAlpha so the cached gradient object can be
// shared regardless of each particle's blend/twinkle alpha.
const GLOW_REF_RADIUS = 100;
const glowGradientCache = new Map<string, CanvasGradient>();
let glowGradientCacheDark: boolean | null = null;

function darkenColor(color: { r: number; g: number; b: number }): { r: number; g: number; b: number } {
	return {
		r: Math.round(color.r * 0.65),
		g: Math.round(color.g * 0.65),
		b: Math.round(color.b * 0.65)
	};
}

function getGlowGradient(
	ctx: CanvasRenderingContext2D,
	dark: boolean,
	color: { r: number; g: number; b: number }
): CanvasGradient {
	// Invalidate cache on theme change (gradient stops differ per theme)
	if (glowGradientCacheDark !== dark) {
		glowGradientCache.clear();
		glowGradientCacheDark = dark;
	}

	const key = `${color.r},${color.g},${color.b}`;
	let grad = glowGradientCache.get(key);
	if (grad) return grad;

	grad = ctx.createRadialGradient(0, 0, 0, 0, 0, GLOW_REF_RADIUS);
	if (dark) {
		// Dark mode: additive glow (original cinematic look)
		grad.addColorStop(0, `rgba(${color.r},${color.g},${color.b},0.2)`);
		grad.addColorStop(0.5, `rgba(${color.r},${color.g},${color.b},0.05)`);
		grad.addColorStop(1, `rgba(${color.r},${color.g},${color.b},0)`);
	} else {
		// Light mode: darken colors for contrast against light background
		const c = darkenColor(color);
		grad.addColorStop(0, `rgba(${c.r},${c.g},${c.b},0.18)`);
		grad.addColorStop(0.4, `rgba(${c.r},${c.g},${c.b},0.07)`);
		grad.addColorStop(1, `rgba(${c.r},${c.g},${c.b},0)`);
	}
	glowGradientCache.set(key, grad);
	return grad;
}

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

	// Apply per-particle alpha once for the whole particle (glow + cores).
	// The cached gradient + core fill colors bake fixed multipliers and rely
	// on globalAlpha to scale their opacity — visually identical to the original
	// alpha-in-string approach while letting the gradient be reused.
	ctx.globalAlpha = finalAlpha;

	if (dark) {
		ctx.globalCompositeOperation = "lighter";

		// Glow — drawn in a transformed space so the shared origin-centered
		// gradient can be reused for any particle position/radius.
		ctx.save();
		ctx.translate(sx, sy);
		ctx.scale((radius * 5) / GLOW_REF_RADIUS, (radius * 5) / GLOW_REF_RADIUS);
		ctx.fillStyle = getGlowGradient(ctx, dark, color);
		ctx.beginPath();
		ctx.arc(0, 0, GLOW_REF_RADIUS, 0, Math.PI * 2);
		ctx.fill();
		ctx.restore();

		// Core particle
		const br = Math.min(255, color.r + 60);
		const bg = Math.min(255, color.g + 60);
		const bb = Math.min(255, color.b + 60);
		ctx.beginPath();
		ctx.arc(sx, sy, Math.max(0.5, radius), 0, Math.PI * 2);
		ctx.fillStyle = `rgba(${br},${bg},${bb},0.9)`;
		ctx.fill();
	} else {
		const c = darkenColor(color);

		// Glow — see dark mode comment above
		ctx.save();
		ctx.translate(sx, sy);
		ctx.scale((radius * 4) / GLOW_REF_RADIUS, (radius * 4) / GLOW_REF_RADIUS);
		ctx.fillStyle = getGlowGradient(ctx, dark, color);
		ctx.beginPath();
		ctx.arc(0, 0, GLOW_REF_RADIUS, 0, Math.PI * 2);
		ctx.fill();
		ctx.restore();

		// Core particle — full color, solid
		ctx.beginPath();
		ctx.arc(sx, sy, Math.max(1.0, radius), 0, Math.PI * 2);
		ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},1)`;
		ctx.fill();

		// Inner bright core
		const ir = Math.max(0.5, radius * 0.45);
		const br = Math.min(255, c.r + 80);
		const bg = Math.min(255, c.g + 80);
		const bb = Math.min(255, c.b + 80);
		ctx.beginPath();
		ctx.arc(sx, sy, ir, 0, Math.PI * 2);
		ctx.fillStyle = `rgba(${br},${bg},${bb},1)`;
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
