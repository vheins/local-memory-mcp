/**
 * Edge and signal rendering for the Knowledge Graph Neural Renderer.
 */

import { fogFactor } from "./layout";

// ─── Internal Types ──────────────────────────────────────────────────────────

export interface Signal {
	fromIdx: number;
	toIdx: number;
	progress: number;
	createdAt: number;
	color: { r: number; g: number; b: number };
}

// ─── Edge Drawing — Very Thin, Semi-Transparent ──────────────────────────────

export function drawEdge3D(
	ctx: CanvasRenderingContext2D,
	from: { sx: number; sy: number; depth: number },
	to: { sx: number; sy: number; depth: number },
	edgeAlpha: number,
	isActive: boolean,
	time: number,
	dark: boolean
) {
	const avgDepth = (from.depth + to.depth) / 2;
	const fog = fogFactor(avgDepth);
	const alpha = dark ? Math.min(0.8, edgeAlpha * fog) : Math.min(0.9, Math.max(0.08, edgeAlpha * fog));

	if (alpha < 0.01) return;

	const edgeWidth = dark ? 1.5 : 1.8;
	// Dark mode: cyan glow; Light mode: deeper indigo for contrast
	const r = dark ? 0 : 55;
	const g = dark ? 212 : 48;
	const b = dark ? 255 : 163;

	ctx.save();
	ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
	ctx.lineWidth = isActive ? edgeWidth * 1.6 : edgeWidth;
	ctx.lineCap = "round";

	if (isActive) {
		ctx.setLineDash([6, 6]);
		ctx.lineDashOffset = -time * 0.04;
		ctx.shadowColor = `rgba(${r},${g},${b},0.6)`;
		ctx.shadowBlur = 6;
	}

	ctx.beginPath();
	ctx.moveTo(from.sx, from.sy);
	ctx.lineTo(to.sx, to.sy);
	ctx.stroke();
	ctx.restore();
}
