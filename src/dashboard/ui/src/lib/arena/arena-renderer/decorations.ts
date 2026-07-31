/**
 * Canvas drawing functions for room decorations.
 *
 * Composite decor functions that dispatch to specialized drawing modules.
 */

import type { RenderCtx } from "./utils";
import type { ZoneRect } from "../arenaTypes";
import { therapySlotPosition } from "../arenaTransform";
import {
	drawSofa,
	drawCoffeeTable,
	drawPotPlant,
	drawHospitalBed,
	drawFilingCabinet,
	drawFlowerVase
} from "./furniture";
import {
	drawReceptionDesk,
	drawWhiteboard,
	drawCeilingLamp,
	drawPowerStrip,
	drawWaterDispenser
} from "./office";
import { drawHazardSign, drawMedicalCross } from "./props";

// ── Cooldown ring ─────────────────────────────────────────────────────────
export function drawCooldownRing(ctx: CanvasRenderingContext2D, x: number, y: number, progress: number, _ts: number) {
	const radius = 18;
	const strokeWidth = 3;
	const color = "#06B6D4";
	ctx.strokeStyle = `rgba(6,182,212,0.12)`;
	ctx.lineWidth = strokeWidth;
	ctx.lineCap = "round";
	ctx.beginPath();
	ctx.arc(x, y, radius, 0, Math.PI * 2);
	ctx.stroke();
	const clamped = Math.max(0, Math.min(1, progress));
	const startAngle = -Math.PI / 2;
	const endAngle = startAngle + clamped * Math.PI * 2;
	ctx.save();
	ctx.shadowColor = color;
	ctx.shadowBlur = 8;
	ctx.strokeStyle = color;
	ctx.lineWidth = strokeWidth;
	ctx.lineCap = "round";
	ctx.beginPath();
	ctx.arc(x, y, radius, startAngle, endAngle);
	ctx.stroke();
	ctx.restore();
	ctx.fillStyle = color;
	ctx.globalAlpha = 0.8;
	ctx.font = "bold 5px system-ui,monospace";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(`${Math.round(clamped * 100)}%`, x, y + 1);
	ctx.globalAlpha = 1;
}

// ── Lobby decor ───────────────────────────────────────────────────────────
function drawLobbyDecor(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	isDark: boolean,
	ts: number
) {
	const sx = x + w / 2 - 28,
		sy = y + h - 55;
	drawSofa(ctx, sx, sy, 56, isDark);
	drawCoffeeTable(ctx, x + w / 2 - 14, y + h - 32, isDark);
	drawPotPlant(ctx, x + 8, y + h - 18, isDark);
	drawPotPlant(ctx, x + w - 18, y + h - 18, isDark);
	drawPotPlant(ctx, x + 8, y + 28, isDark);
	const rw = Math.min(w - 20, 70);
	drawReceptionDesk(ctx, x + w / 2 - rw / 2, y + 24, rw, isDark);
	drawCeilingLamp(ctx, x + w / 2, y + 14, isDark, ts);
}

// ── Workspace decor ────────────────────────────────────────────────────────
function drawWorkspaceDecor(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	isDark: boolean
) {
	drawPowerStrip(ctx, x + 12, y + h - 16, Math.min(w - 24, 60), isDark);
	drawWhiteboard(ctx, x + w - 36, y + 18, isDark);
	drawWaterDispenser(ctx, x + 20, y + 12, isDark);
	drawFlowerVase(ctx, x + w / 2, y + 24, isDark);
}

// ── Issues decor ──────────────────────────────────────────────────────────
function drawIssuesDecor(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
	ctx.save();
	ctx.globalAlpha = 0.25;
	ctx.strokeStyle = "#f59e0b";
	ctx.lineWidth = 4;
	ctx.setLineDash([8, 8]);
	ctx.beginPath();
	ctx.moveTo(x, y + h - 8);
	ctx.lineTo(x + w, y + h - 8);
	ctx.stroke();
	ctx.setLineDash([]);
	ctx.restore();
	drawHazardSign(ctx, x + w / 2 - 10, y + 16);
}

// ── Archive decor ─────────────────────────────────────────────────────────
function drawArchiveDecor(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, isDark: boolean) {
	for (let fx = x + 10; fx < x + w - 22; fx += 26) {
		drawFilingCabinet(ctx, fx, y + 18, isDark);
	}
	drawPotPlant(ctx, x + w - 15, y + h - 20, isDark);
}

// ── Room decor dispatch ───────────────────────────────────────────────────
export function drawRoomDecor(rc: RenderCtx, zone: ZoneRect) {
	const { ctx, isDark, ts } = rc;
	const { x, y, w, h, id } = zone;
	switch (id) {
		case "in_progress":
			drawWorkspaceDecor(ctx, x, y, w, h, isDark);
			break;
		case "backlog":
			drawArchiveDecor(ctx, x, y, w, h, isDark);
			break;
		case "pending":
			drawLobbyDecor(ctx, x, y, w, h, isDark, ts);
			break;
		case "blocked":
			drawIssuesDecor(ctx, x, y, w, h);
			break;
		case "burnout":
		case "recovery":
			drawRecoveryDecor(rc, zone);
			break;
	}
}

// ── Recovery decor ────────────────────────────────────────────────────────
export function drawRecoveryDecor(rc: RenderCtx, zone: ZoneRect) {
	const { ctx, isDark, ts } = rc;
	const { x, y, w, h } = zone;
	const zone2: ZoneRect = { id: "recovery", label: "Recovery Center", x, y, w, h, color: "#14b8a6" };
	for (let idx = 0; idx < 6; idx++) {
		const bed = therapySlotPosition(zone2, idx);
		drawHospitalBed(ctx, bed.x, bed.y, isDark);
		drawCooldownRing(ctx, bed.x, bed.y - 2, 0.5 + 0.5 * Math.sin(ts * 0.001 + idx * 1.2), ts);
	}
	drawPotPlant(ctx, x + w - 20, y + 20, isDark);
	drawFlowerVase(ctx, x + 20, y + 20, isDark);
	drawMedicalCross(ctx, x + w / 2, y + 12, isDark);
}
