/**
 * Edge and signal rendering for the Knowledge Graph Neural Renderer.
 */

import { fogFactor } from "./layout";
import type { EdgeConfidenceColor } from "../edgeConfidence";

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
	dark: boolean,
	bucketColor: EdgeConfidenceColor | null = null
) {
	const avgDepth = (from.depth + to.depth) / 2;
	const fog = fogFactor(avgDepth);
	const alpha = dark ? Math.min(0.8, edgeAlpha * fog) : Math.min(0.9, Math.max(0.08, edgeAlpha * fog));

	if (alpha < 0.01) return;

	const edgeWidth = dark ? 1.5 : 1.8;
	// Dark mode: cyan glow; Light mode: deeper indigo for contrast. A
	// confidence bucket color (amber/red, TASK-330) overrides the tint while
	// keeping the glow/shadow driven by the same rgb — so the active-edge
	// highlight also communicates the confidence visual language.
	const r = bucketColor ? bucketColor.r : dark ? 0 : 55;
	const g = bucketColor ? bucketColor.g : dark ? 212 : 48;
	const b = bucketColor ? bucketColor.b : dark ? 255 : 163;

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

// ─── Edge Label — Midpoint Pill (TASK-330) ───────────────────────────────────
// Rendered only for hovered/selected edges (the active set), so the
// zero-allocation batched path and the uncluttered overview stay untouched.

export function drawEdgeLabel3D(
	ctx: CanvasRenderingContext2D,
	from: { sx: number; sy: number; depth: number },
	to: { sx: number; sy: number; depth: number },
	label: string,
	dark: boolean,
	bucketColor: EdgeConfidenceColor | null
) {
	const mx = (from.sx + to.sx) / 2;
	const my = (from.sy + to.sy) / 2;

	ctx.font = "9px system-ui,sans-serif";
	ctx.textAlign = "center";
	ctx.textBaseline = "bottom";
	const tw = ctx.measureText(label).width;
	const pillW = tw + 6;
	const pillH = 14;
	ctx.fillStyle = dark ? "rgba(10,14,26,0.85)" : "rgba(240,244,255,0.9)";
	ctx.fillRect(mx - pillW / 2, my - pillH + 2, pillW, pillH);
	// Confidence bucket color tints the label text (medium=amber, low=red);
	// high keeps the neutral slate.
	ctx.fillStyle = bucketColor
		? `rgba(${bucketColor.r},${bucketColor.g},${bucketColor.b},0.95)`
		: dark
			? "rgba(148,163,184,0.9)"
			: "rgba(71,85,105,0.9)";
	ctx.fillText(label, mx, my);
}
