import type { Task } from "../interfaces";
import type { ZoneRect } from "./arenaTypes";
import { STATUS_TO_ZONE } from "./arenaTransform-utils";

// ── Layout constants ─────────────────────────────────────────────
const MAX_TASKS_PER_ZONE = 16;
const TASK_INNER_PAD = 22;
const TASK_TOP_PAD = 28; // below zone label
const THERAPY_SLOT_PAD_X = 34;
const THERAPY_SLOT_PAD_TOP = 54;
const THERAPY_SLOT_PAD_BOTTOM = 28;
const THERAPY_SLOT_MIN_GAP_X = 58;
const THERAPY_SLOT_MIN_GAP_Y = 42;

function clamp(n: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, n));
}

/**
 * Computes the position of a "therapy slot" (burnout recovery bed)
 * within a given zone for a given index.
 */
export function therapySlotPosition(zone: ZoneRect, idx: number): { x: number; y: number } {
	const availableW = Math.max(1, zone.w - THERAPY_SLOT_PAD_X * 2);
	const availableH = Math.max(1, zone.h - THERAPY_SLOT_PAD_TOP - THERAPY_SLOT_PAD_BOTTOM);
	const cols = clamp(Math.floor(availableW / THERAPY_SLOT_MIN_GAP_X) + 1, 1, 3);
	const rows = Math.max(1, Math.floor(availableH / THERAPY_SLOT_MIN_GAP_Y) + 1);
	const slot = idx % (cols * rows);
	const col = slot % cols;
	const row = Math.floor(slot / cols);
	const colGap = cols > 1 ? availableW / (cols - 1) : 0;
	const rowGap = rows > 1 ? availableH / (rows - 1) : 0;

	return {
		x: zone.x + THERAPY_SLOT_PAD_X + col * colGap,
		y: zone.y + THERAPY_SLOT_PAD_TOP + row * rowGap
	};
}

/**
 * Computes zone rectangles for the given canvas dimensions.
 * Zones: pending, in_progress, backlog, blocked, recovery.
 */
export function computeZones(cw: number, ch: number): ZoneRect[] {
	const M = 16;
	const G = 16;
	const iw = cw - M * 2;
	const ih = ch - M * 2;

	const topH = Math.floor((ih - G) / 2);
	const bottomH = ih - topH - G;

	const colW2 = Math.floor((iw - G) / 2);
	const colW3 = Math.floor((iw - G * 2) / 3);

	return [
		{ id: "pending", label: "Pending", x: M, y: M, w: colW2, h: topH, color: "#f59e0b" },
		{ id: "in_progress", label: "In Progress", x: M + colW2 + G, y: M, w: iw - colW2 - G, h: topH, color: "#3b82f6" },
		{ id: "backlog", label: "Backlog", x: M, y: M + topH + G, w: colW3, h: bottomH, color: "#8b5cf6" },
		{ id: "blocked", label: "Blocked", x: M + colW3 + G, y: M + topH + G, w: colW3, h: bottomH, color: "#ef4444" },
		{
			id: "recovery",
			label: "Recovery Center",
			x: M + colW3 * 2 + G * 2,
			y: M + topH + G,
			w: iw - colW3 * 2 - G * 2,
			h: bottomH,
			color: "#14b8a6"
		}
	];
}

/** Spreads tasks as workstations within their zone. */
export function placeTasksInZones(tasks: Task[], zones: ZoneRect[]): Map<string, { x: number; y: number }> {
	const zoneById = new Map(zones.map((z) => [z.id, z]));
	const byZone = new Map<string, Task[]>();
	zones.forEach((z) => byZone.set(z.id, []));

	for (const task of tasks) {
		const zid = STATUS_TO_ZONE[task.status] ?? "pending";
		if (!byZone.has(zid)) continue;
		const bucket = byZone.get(zid)!;
		if (bucket.length < MAX_TASKS_PER_ZONE) bucket.push(task);
	}

	const positions = new Map<string, { x: number; y: number }>();

	for (const [zid, zoneTasks] of byZone) {
		const zone = zoneById.get(zid);
		if (!zone || zoneTasks.length === 0) continue;

		const innerW = zone.w - TASK_INNER_PAD * 2;
		const innerH = zone.h - TASK_INNER_PAD - TASK_TOP_PAD;
		let cols = Math.max(1, Math.floor(innerW / 65));
		let rows = Math.ceil(zoneTasks.length / cols);

		while (innerH / rows < 55 && cols < zoneTasks.length) {
			cols++;
			rows = Math.ceil(zoneTasks.length / cols);
		}

		const cellW = innerW / cols;
		const cellH = Math.max(55, Math.min(75, innerH / rows));

		zoneTasks.forEach((t, i) => {
			const col = i % cols;
			const row = Math.floor(i / cols);
			positions.set(t.id, {
				x: zone.x + TASK_INNER_PAD + col * cellW + cellW / 2,
				y: zone.y + TASK_TOP_PAD + row * cellH + cellH / 2
			});
		});
	}

	return positions;
}
