import type { Task, TaskClaim, Handoff } from "../interfaces";
import type {
	ArenaScene,
	ArenaLayoutConfig,
	ZoneRect,
	AgentState,
	HandoffAnimData,
	HandoffVehicle,
	HelperVariant
} from "./arenaTypes";

export const STATUS_COLORS: Record<string, string> = {
	backlog: "#64748b",
	pending: "#0ea5e9",
	in_progress: "#a855f7",
	blocked: "#ef4444",
	completed: "#10b981",
	canceled: "#94a3b8"
};

// Maps task status → zone id
const STATUS_TO_ZONE: Record<string, string> = {
	backlog: "backlog",
	pending: "pending",
	in_progress: "in_progress",
	blocked: "blocked",
	completed: "completed",
	canceled: "canceled"
};

const AGENT_COLORS = [
	"#06b6d4",
	"#f59e0b",
	"#ec4899",
	"#10b981",
	"#3b82f6",
	"#f97316",
	"#14b8a6",
	"#e11d48",
	"#8b5cf6",
	"#84cc16"
];

const MAX_TASKS_PER_ZONE = 16;
const TASK_INNER_PAD = 22;
const TASK_TOP_PAD = 28; // below zone label
const ACTIVE_TASK_STATUSES = new Set(["in_progress", "pending"]);

// ── Handoff Animation Helpers ──────────────────────────────────────────────
const HELPER_VARIANTS: HelperVariant[] = ["male_nurse", "female_nurse", "staff1", "staff2"];

function pickVehicle(nameHash: number): HandoffVehicle {
	return nameHash % 2 === 0 ? "wheelchair" : "stretcher";
}

function pickHelper(nameHash: number): HelperVariant {
	return HELPER_VARIANTS[(nameHash >>> 4) % HELPER_VARIANTS.length];
}

function nameHash(name: string): number {
	let h = 5381;
	for (let i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) >>> 0;
	return h;
}

export function agentColor(name: string): string {
	let h = 5381;
	for (let i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) >>> 0;
	return AGENT_COLORS[h % AGENT_COLORS.length];
}

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
			id: "burnout",
			label: "Therapy Room",
			x: M + colW3 * 2 + G * 2,
			y: M + topH + G,
			w: iw - colW3 * 2 - G * 2,
			h: bottomH,
			color: "#14b8a6"
		}
	];
}

/** Spreads tasks as workstations within their zone. */
function placeTasksInZones(tasks: Task[], zones: ZoneRect[]): Map<string, { x: number; y: number }> {
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

export function buildArenaScene(
	tasks: Task[],
	claims: TaskClaim[],
	handoffs: Handoff[],
	existingScene: ArenaScene | null,
	layout: ArenaLayoutConfig
): ArenaScene {
	const zones = computeZones(layout.canvasWidth, layout.canvasHeight);
	const taskPositions = placeTasksInZones(tasks, zones);
	const idleZone = zones.find((z) => z.id === "in_progress") || zones[0];

	const scene: ArenaScene = { agents: new Map(), tasks: new Map(), handoffs: [] };

	// --- Tasks ---
	for (const task of tasks) {
		const pos = taskPositions.get(task.id);
		if (!pos) continue;
		// const prev = existingScene?.tasks.get(task.id);
		scene.tasks.set(task.id, {
			id: task.id,
			taskCode: task.task_code,
			title: task.title,
			repo: task.repo,
			status: task.status,
			priority: task.priority ?? 3,
			x: pos.x,
			y: pos.y,
			claimedByAgentId: task.coordination?.active_claim_agent ?? null,
			hasPendingHandoff: (task.coordination?.pending_handoff_count ?? 0) > 0
		});
	}

	// --- Agents (from claims + task coordination) ---
	const agentMap = new Map<string, { tasks: Set<string>; role: string; repos: Set<string> }>();

	for (const claim of claims) {
		if (!agentMap.has(claim.agent)) agentMap.set(claim.agent, { tasks: new Set(), role: claim.role, repos: new Set() });
		const e = agentMap.get(claim.agent)!;
		e.tasks.add(claim.task_id);
		e.repos.add(claim.repo);
	}
	for (const task of tasks) {
		const a = task.coordination?.active_claim_agent;
		if (!a) continue;
		if (!agentMap.has(a))
			agentMap.set(a, { tasks: new Set(), role: task.coordination?.active_claim_role ?? "agent", repos: new Set() });
		const e = agentMap.get(a)!;
		e.tasks.add(task.id);
		e.repos.add(task.repo);
	}

	const agentNames = Array.from(agentMap.keys());

	agentNames.forEach((name, idx) => {
		const { tasks: claimedIds, role, repos } = agentMap.get(name)!;
		const prev = existingScene?.agents.get(name);

		// Initial spawn in idle zone centre (spread out)
		const spawnX = idleZone.x + idleZone.w / 2 + ((idx % 3) - 1) * 30;
		const spawnY = idleZone.y + idleZone.h / 2 + (Math.floor(idx / 3) - 1) * 30;

		const firstVisibleTask = Array.from(claimedIds).find((id) => scene.tasks.has(id));
		const tgt = firstVisibleTask ? scene.tasks.get(firstVisibleTask)! : null;
		const visibleClaimedTasks = Array.from(claimedIds)
			.map((id) => scene.tasks.get(id))
			.filter((task): task is NonNullable<typeof task> => Boolean(task));
		const hasActiveClaimedTask = visibleClaimedTasks.some((task) => ACTIVE_TASK_STATUSES.has(task.status));

		// Target: 18px above+right of task (so agent is adjacent to desk)
		let targetX = tgt ? tgt.x + 20 : spawnX;
		let targetY = tgt ? tgt.y - 18 : spawnY;

		const claimedArr = Array.from(claimedIds).sort();
		const prevClaimed = prev?.claimedTaskIds.slice().sort() ?? [];
		const tasksChanged = !prev || claimedArr.join(",") !== prevClaimed.join(",");

		const now = Date.now();
		const lastUpdateTs = tasksChanged ? now : (prev?.lastUpdateTs ?? now);
		const isStale = !hasActiveClaimedTask && now - lastUpdateTs > 30000;

		let state: AgentState = claimedIds.size > 0 ? "processing" : "idle";
		if (tgt && tgt.status === "blocked") {
			state = "blocked";
		}

		// Detect burnout and start handoff animation
		let handoffAnim: HandoffAnimData | null = prev?.handoffAnim ?? null;
		if (isStale) {
			state = "burnout";
			const burnoutZone = zones.find((z) => z.id === "burnout") || idleZone;
			// Place them nicely in the burnout zone (spread out on therapy beds)
			targetX = burnoutZone.x + 40 + (idx % 3) * 60;
			targetY = burnoutZone.y + burnoutZone.h / 2 + Math.floor(idx / 3) * 40;

			// Start handoff animation if agent just transitioned to burnout
			const wasBurnout = prev?.state === "burnout";
			if (!wasBurnout && !handoffAnim) {
				const nh = nameHash(name);
				const currentX = prev?.x ?? spawnX;
				const currentY = prev?.y ?? spawnY;
				handoffAnim = {
					phase: "pickup",
					vehicle: pickVehicle(nh),
					helperVariant: pickHelper(nh),
					startX: currentX,
					startY: currentY,
					endX: targetX,
					endY: targetY,
					progress: 0,
					phaseStartTs: performance.now(),
					wheelAngle: 0,
					helperWalkPhase: 0,
					helperFacing: "down",
					stepBounce: 0
				};
			}
		} else {
			// Clear handoff animation when agent is no longer burnout
			handoffAnim = null;
		}

		scene.agents.set(name, {
			id: name,
			name,
			role,
			color: agentColor(name),
			x: prev?.x ?? spawnX,
			y: prev?.y ?? spawnY,
			targetX,
			targetY,
			vx: prev?.vx ?? 0,
			vy: prev?.vy ?? 0,
			walkPhase: prev?.walkPhase ?? 0,
			facing: prev?.facing ?? "down",
			state,
			claimedTaskIds: Array.from(claimedIds),
			repos: Array.from(repos),
			lastUpdateTs,
			handoffAnim
		});
	});

	// --- Handoffs ---
	for (const h of handoffs) {
		if (h.status !== "pending") continue;
		scene.handoffs.push({
			id: h.id,
			fromAgentId: h.from_agent,
			toAgentId: h.to_agent,
			taskId: h.task_id,
			summary: h.summary
		});
	}

	return scene;
}
