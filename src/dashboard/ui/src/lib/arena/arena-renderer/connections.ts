import type { RenderCtx, LODLevel } from "./utils";
import { LOD_SIMPLIFIED } from "./utils";
import { STATUS_COLORS } from "../arenaTransform";
import type { ArenaScene } from "../arenaTypes";

// ── Claim links (dashed lines from agents to their claimed tasks) ─────────
export function drawClaimLinks(
	rc: RenderCtx,
	scene: ArenaScene,
	matchesAgentFilter: (id: string) => boolean,
	matchesTaskFilter: (id: string) => boolean,
	isFilterActive: () => boolean,
	lod: LODLevel
) {
	const { ctx } = rc;
	const hasFilter = isFilterActive();
	const cullBounds = lod < LOD_SIMPLIFIED ? getCullBounds(rc) : undefined;

	for (const a of scene.agents.values()) {
		if (hasFilter && !matchesAgentFilter(a.id)) continue;
		for (const tid of a.claimedTaskIds) {
			const t = scene.tasks.get(tid);
			if (!t) continue;
			if (hasFilter && !matchesTaskFilter(t.id)) continue;
			if (cullBounds && !isInViewport(rc, a.x, a.y, cullBounds) && !isInViewport(rc, t.x, t.y, cullBounds)) continue;
			const grd = ctx.createLinearGradient(a.x, a.y, t.x, t.y);
			grd.addColorStop(0, a.color + "cc");
			grd.addColorStop(1, (STATUS_COLORS[t.status] ?? "#64748b") + "44");
			ctx.strokeStyle = grd;
			ctx.lineWidth = 1.5;
			ctx.setLineDash([5, 5]);
			ctx.lineDashOffset = -(rc.ts * 0.022) % 10;
			ctx.beginPath();
			ctx.moveTo(a.x, a.y);
			ctx.lineTo(t.x, t.y);
			ctx.stroke();
		}
	}
	ctx.setLineDash([]);
	ctx.lineDashOffset = 0;
}

// ── Handoff beams (dashed amber lines with traveling dot) ────────────────
export function drawHandoffBeams(
	rc: RenderCtx,
	scene: ArenaScene,
	matchesAgentFilter: (id: string) => boolean,
	matchesTaskFilter: (id: string) => boolean,
	isFilterActive: () => boolean,
	lod: LODLevel
) {
	const { ctx, reducedTransparency, ts } = rc;
	const hasFilter = isFilterActive();
	const cullBounds = lod < LOD_SIMPLIFIED ? getCullBounds(rc) : undefined;

	for (const h of scene.handoffs) {
		const from = scene.agents.get(h.fromAgentId);
		if (!from) continue;
		if (hasFilter && !matchesAgentFilter(from.id)) continue;
		let toX: number, toY: number;
		if (h.toAgentId) {
			const to = scene.agents.get(h.toAgentId);
			if (!to) continue;
			if (hasFilter && !matchesAgentFilter(to.id)) continue;
			toX = to.x;
			toY = to.y;
		} else if (h.taskId) {
			const t = scene.tasks.get(h.taskId);
			if (!t) continue;
			if (hasFilter && !matchesTaskFilter(t.id)) continue;
			toX = t.x;
			toY = t.y;
		} else continue;

		if (cullBounds && !isInViewport(rc, from.x, from.y, cullBounds) && !isInViewport(rc, toX, toY, cullBounds))
			continue;

		ctx.strokeStyle = "#f59e0b88";
		ctx.lineWidth = 2.5;
		ctx.setLineDash([8, 5]);
		ctx.lineDashOffset = -(ts * 0.07) % 13;
		ctx.beginPath();
		ctx.moveTo(from.x, from.y);
		ctx.lineTo(toX, toY);
		ctx.stroke();
		ctx.setLineDash([]);
		ctx.lineDashOffset = 0;

		const t2 = (ts % 1600) / 1600;
		const px = from.x + (toX - from.x) * t2,
			py = from.y + (toY - from.y) * t2;
		ctx.fillStyle = "#f59e0b";
		if (!reducedTransparency) {
			ctx.shadowColor = "#f59e0b";
			ctx.shadowBlur = 8;
		}
		ctx.beginPath();
		ctx.arc(px, py, 4, 0, Math.PI * 2);
		ctx.fill();
		ctx.shadowBlur = 0;
	}
}

// ── Internal helpers ─────────────────────────────────────────────────────
function getCullBounds(rc: RenderCtx): { left: number; top: number; right: number; bottom: number } {
	const z = rc.zoom || 1;
	const margin = z < 0.5 ? 100 : 50;
	const left = -rc.panX / z;
	const top = -rc.panY / z;
	return {
		left: left - margin,
		top: top - margin,
		right: left + rc.canvasW / z + margin,
		bottom: top + rc.canvasH / z + margin
	};
}

function isInViewport(
	rc: RenderCtx,
	x: number,
	y: number,
	bounds: { left: number; top: number; right: number; bottom: number }
): boolean {
	return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
}
