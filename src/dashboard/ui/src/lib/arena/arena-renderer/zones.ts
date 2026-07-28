import type { RenderCtx } from "./utils";
import { rr, rgba } from "./utils";
import type { ZoneRect } from "../arenaTypes";
import { drawPlazaFloor, drawDirtFloor, drawCleanTileFloor, drawGrassFloor, drawWoodPlankFloor } from "./floors";
import { drawRoomDecor } from "./decorations";

// ── Wall (top of room) ─────────────────────────────────────────────────────
export function drawWall(rc: RenderCtx, x: number, y: number, w: number, color: string) {
	const { ctx, isDark } = rc;
	const wH = 11;
	ctx.fillStyle = isDark ? "#1c2130" : "#c4cad6";
	rr(ctx, x, y, w, wH, 0);
	ctx.fill();
	ctx.strokeStyle = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)";
	ctx.lineWidth = 0.75;
	for (let px = x + 24; px < x + w; px += 24) {
		ctx.beginPath();
		ctx.moveTo(px, y);
		ctx.lineTo(px, y + wH);
		ctx.stroke();
	}
	ctx.fillStyle = rgba(color, 0.4);
	ctx.fillRect(x, y, w, 2.5);
	const sGrd = ctx.createLinearGradient(x, y + wH, x, y + wH + 8);
	sGrd.addColorStop(0, "rgba(0,0,0,0.28)");
	sGrd.addColorStop(1, "rgba(0,0,0,0)");
	ctx.fillStyle = sGrd;
	ctx.fillRect(x, y + wH, w, 8);
	ctx.fillStyle = isDark ? "#253040" : "#b8bfc9";
	ctx.fillRect(x, y, 6, wH);
	ctx.fillRect(x + w - 6, y, 6, wH);
}

// ── Zone label sign ───────────────────────────────────────────────────────
export function drawZoneLabel(rc: RenderCtx, zone: ZoneRect) {
	const { ctx } = rc;
	const { x, y, w, color, label } = zone;
	const bw = Math.min(w - 16, 92),
		bh = 16,
		bx = x + 9,
		by = y + 3;
	ctx.fillStyle = rgba(color, rc.isDark ? 0.25 : 0.18);
	rr(ctx, bx, by, bw, bh, 5);
	ctx.fill();
	ctx.strokeStyle = rgba(color, 0.6);
	ctx.lineWidth = 0.75;
	rr(ctx, bx, by, bw, bh, 5);
	ctx.stroke();
	ctx.fillStyle = color;
	ctx.font = "bold 8px system-ui,sans-serif";
	ctx.textAlign = "left";
	ctx.textBaseline = "middle";
	ctx.fillText(label.toUpperCase(), bx + 6, by + bh / 2);
}

// ── Room ────────────────────────────────────────────────────────────────────
export function drawRoom(rc: RenderCtx, zone: ZoneRect) {
	const { ctx, isDark } = rc;
	const { x, y, w, h, color, id } = zone;

	ctx.save();
	rr(ctx, x, y, w, h, 10);
	ctx.clip();

	switch (id) {
		case "in_progress":
			drawPlazaFloor(rc, x, y, w, h);
			break;
		case "backlog":
			drawDirtFloor(rc, x, y, w, h, "#5b3a6e");
			break;
		case "pending":
			drawDirtFloor(rc, x, y, w, h, "#a68246");
			break;
		case "blocked":
			drawDirtFloor(rc, x, y, w, h, "#8b2a2a");
			break;
		case "burnout":
		case "recovery":
			drawCleanTileFloor(rc, x, y, w, h);
			break;
		case "completed":
			drawGrassFloor(rc, x, y, w, h);
			break;
		default:
			drawWoodPlankFloor(rc, x, y, w, h);
			break;
	}

	const lx = x + w / 2,
		ly = y + h * 0.35;
	const grd = ctx.createRadialGradient(lx, ly, 0, lx, ly, Math.max(w, h) * 0.85);
	grd.addColorStop(0, rgba(color, isDark ? 0.12 : 0.08));
	grd.addColorStop(1, "rgba(0,0,0,0)");
	ctx.fillStyle = grd;
	ctx.fillRect(x, y, w, h);
	ctx.restore();

	drawWall(rc, x, y, w, color);

	ctx.strokeStyle = rgba(color, isDark ? 0.45 : 0.35);
	ctx.lineWidth = 1.5;
	rr(ctx, x, y, w, h, 10);
	ctx.stroke();

	drawRoomDecor(rc, zone);

	if (rc.lod !== 2 && rc.lod !== 3) {
		drawZoneLabel(rc, zone);
	}
}
