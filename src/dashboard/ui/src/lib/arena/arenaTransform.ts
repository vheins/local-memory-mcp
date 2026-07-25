import type { Task, TaskClaim, Handoff } from "../interfaces";
import type {
	ArenaScene,
	ArenaLayoutConfig,
	ZoneRect,
	AgentState,
	HandoffAnimData,
	HandoffVehicle,
	HelperVariant,
	VisualAgent,
	VisualRepository
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

export const ROLE_COLORS: Record<string, string> = {
	backend: "#3B82F6",
	frontend: "#10B981",
	debugger: "#F59E0B",
	devops: "#8B5CF6",
	"data-engineer": "#14B8A6",
	explore: "#06B6D4",
	documentation: "#6B7280",
	general: "#F9FAFB"
};

const MAX_TASKS_PER_ZONE = 16;
const TASK_INNER_PAD = 22;
const TASK_TOP_PAD = 28; // below zone label
const ACTIVE_TASK_STATUSES = new Set(["in_progress", "pending"]);
const THERAPY_SLOT_PAD_X = 34;
const THERAPY_SLOT_PAD_TOP = 54;
const THERAPY_SLOT_PAD_BOTTOM = 28;
const THERAPY_SLOT_MIN_GAP_X = 58;
const THERAPY_SLOT_MIN_GAP_Y = 42;

function clamp(n: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, n));
}

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

export function agentColor(name: string, role?: string | null): string {
	if (role && ROLE_COLORS[role]) {
		return ROLE_COLORS[role];
	}
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

function priorityToLevel(p: number): "p0" | "p1" | "p2" | "p3" {
	if (p <= 1) return "p0";
	if (p === 2) return "p1";
	if (p === 3) return "p2";
	return "p3";
}

function inferTaskType(code: string): "feature" | "fix" | "refactor" | "chore" | "docs" | "test" {
	const prefix = code.split("-")[0]?.toUpperCase() ?? "";
	const typeMap: Record<string, "feature" | "fix" | "refactor" | "chore" | "docs" | "test"> = {
		FEAT: "feature",
		FIX: "fix",
		REFACTOR: "refactor",
		CHORE: "chore",
		DOCS: "docs",
		TEST: "test"
	};
	return typeMap[prefix] ?? "feature";
}

// ── Agent Telemetry Helpers ────────────────────────────────────────────────

function stateToAction(state: AgentState): VisualAgent["currentAction"] {
	const map: Record<AgentState, VisualAgent["currentAction"]> = {
		processing: "coding",
		idle: "idle",
		blocked: "waiting",
		burnout: "retrying",
		claiming: "thinking",
		handoff_out: "waiting",
		handoff_in: "waiting",
		recovering: "retrying",
		cooldown: "idle",
		retrying: "retrying",
		self_healing: "retrying"
	};
	return map[state] ?? "idle";
}

function stateToHealth(state: AgentState): VisualAgent["health"] {
	if (state === "burnout" || state === "blocked") return "degraded";
	return "healthy";
}

function healthToRing(health: VisualAgent["health"]): number {
	const map: Record<VisualAgent["health"], number> = {
		healthy: 100,
		degraded: 60,
		critical: 25,
		offline: 0
	};
	return map[health];
}

function stateToIcon(state: AgentState): string {
	const map: Record<AgentState, string> = {
		processing: "⚡",
		idle: "●",
		blocked: "⚠",
		burnout: "🔄",
		claiming: "●",
		handoff_out: "●",
		handoff_in: "●",
		recovering: "🔄",
		cooldown: "●",
		retrying: "🔄",
		self_healing: "🔄"
	};
	return map[state] ?? "";
}

function computeAgentProgress(tasks: Array<{ progress: number }>): number {
	if (tasks.length === 0) return 0;
	const sum = tasks.reduce((acc, t) => acc + t.progress, 0);
	return sum / tasks.length;
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

	const scene: ArenaScene = { agents: new Map(), tasks: new Map(), handoffs: [], repositories: new Map() };

	// --- Tasks ---
	const now = Date.now();

	for (const task of tasks) {
		const pos = taskPositions.get(task.id);
		if (!pos) continue;
		const prev = existingScene?.tasks.get(task.id);
		const createdAt = task.created_at ? new Date(task.created_at).getTime() : now;
		const startedAt = task.in_progress_at ? new Date(task.in_progress_at).getTime() : null;
		const waitTime = Math.max(0, (now - createdAt) / 1000);
		const estDuration = task.est_tokens ? task.est_tokens * 2 : 300;

		let progress: number;
		if (task.status === "completed") {
			progress = 1.0;
		} else if (task.status === "in_progress" && startedAt) {
			progress = Math.min(1.0, (now - startedAt) / (estDuration * 1000));
		} else {
			progress = prev?.progress ?? 0;
		}

		scene.tasks.set(task.id, {
			id: task.id,
			taskCode: task.task_code,
			title: task.title,
			repo: task.repo,
			status: task.status,
			priority: task.priority ?? 3,
			priorityLevel: priorityToLevel(task.priority ?? 3),
			claimedByAgentId: task.coordination?.active_claim_agent ?? null,
			ownerId: task.agent ?? "",
			repositoryId: task.repo,
			createdAt,
			startedAt,
			estimatedDuration: estDuration,
			actualDuration: null,
			waitTime,
			progress,
			retryCount: prev?.retryCount ?? 0,
			maxRetries: prev?.maxRetries ?? 3,
			failureReason: null,
			blockedReason: null,
			blockedById: null,
			tokenCost: 0,
			estimatedCost: 0,
			labels: [],
			tags: task.tags ?? [],
			taskType: inferTaskType(task.task_code),
			hasPendingHandoff: (task.coordination?.pending_handoff_count ?? 0) > 0,
			x: pos.x,
			y: pos.y,
			animationState: prev ? "idle" : "entering"
		});
	}

	// --- Agents (from claims + task coordination) ---
	const agentMap = new Map<string, { tasks: Set<string>; role: string; repos: Set<string>; model: string }>();

	for (const claim of claims) {
		if (!agentMap.has(claim.agent))
			agentMap.set(claim.agent, {
				tasks: new Set(),
				role: claim.role,
				repos: new Set(),
				model: (claim.metadata?.model as string) ?? ""
			});
		const e = agentMap.get(claim.agent)!;
		e.tasks.add(claim.task_id);
		e.repos.add(claim.repo);
	}
	for (const task of tasks) {
		const a = task.coordination?.active_claim_agent;
		if (!a) continue;
		if (!agentMap.has(a))
			agentMap.set(a, {
				tasks: new Set(),
				role: task.coordination?.active_claim_role ?? "agent",
				repos: new Set(),
				model: ""
			});
		const e = agentMap.get(a)!;
		e.tasks.add(task.id);
		e.repos.add(task.repo);
	}

	const agentNames = Array.from(agentMap.keys());

	agentNames.forEach((name, idx) => {
		const { tasks: claimedIds, role, repos, model } = agentMap.get(name)!;
		const prev = existingScene?.agents.get(name);

		const roleColor = ROLE_COLORS[role] ?? agentColor(name);

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
			const burnoutZone = zones.find((z) => z.id === "recovery") || idleZone;
			// Place them inside the therapy room, aligned with the rendered beds.
			const therapySlot = therapySlotPosition(burnoutZone, idx);
			targetX = therapySlot.x;
			targetY = therapySlot.y;

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

		// ── Compute telemetry & health based on state ──────────────────────
		const curAction = stateToAction(state);
		const curHealth = stateToHealth(state);
		const curHealthRing = healthToRing(curHealth);
		const curIcon = stateToIcon(state);
		const avgProgress = computeAgentProgress(visibleClaimedTasks);

		scene.agents.set(name, {
			id: name,
			name,
			role,
			color: roleColor,
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
			model,
			handoffAnim,

			// ── Health & Status (computed from state) ───────────────────────
			health: curHealth,
			currentAction: curAction,
			currentTool: prev?.currentTool ?? "",
			confidence: 1.0,
			progress: avgProgress,

			// ── Telemetry (carried forward; updated by animations) ──────────
			tokenUsage: prev?.tokenUsage ?? 0,
			tokenBurnRate: prev?.tokenBurnRate ?? 0,
			cost: prev?.cost ?? 0,
			latency: prev?.latency ?? 0,
			contextUsage: prev?.contextUsage ?? 0,
			queueLength: prev?.queueLength ?? claimedIds.size,
			memoryOps: prev?.memoryOps ?? 0,
			toolCalls: prev?.toolCalls ?? 0,

			// ── Visual Enhancements (computed from state) ──────────────────
			statusIcon: curIcon,
			speechBubble: null,
			speechBubbleTs: 0,
			activityAnimation: prev?.activityAnimation ?? "",
			healthRing: curHealthRing,
			coloredOutline: roleColor
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

	// --- Repositories ---
	const repoIds = new Set<string>();
	if (existingScene?.repositories) {
		for (const id of existingScene.repositories.keys()) {
			repoIds.add(id);
		}
	}
	for (const task of tasks) {
		if (task.repo) {
			repoIds.add(task.repo);
		}
	}
	for (const claim of claims) {
		if (claim.repo) {
			repoIds.add(claim.repo);
		}
	}

	for (const repoId of repoIds) {
		const prev = existingScene?.repositories?.get(repoId);
		const fullName = repoId;
		const name = repoId.split("/").pop() || repoId;

		let tasksInProgress = 0;
		let tasksPending = 0;
		let tasksBlocked = 0;
		for (const task of scene.tasks.values()) {
			if (task.repo === repoId) {
				if (task.status === "in_progress") {
					tasksInProgress++;
				} else if (task.status === "pending") {
					tasksPending++;
				} else if (task.status === "blocked") {
					tasksBlocked++;
				}
			}
		}

		let activeAgents = 0;
		for (const agent of scene.agents.values()) {
			if (agent.repos.includes(repoId)) {
				activeAgents++;
			}
		}

		let health: "healthy" | "degraded" | "critical" = prev?.health ?? "healthy";
		if (!prev?.health) {
			if (tasksBlocked > 0) {
				health = "degraded";
			}
			for (const agent of scene.agents.values()) {
				if (agent.repos.includes(repoId)) {
					if (agent.state === "blocked" || agent.state === "burnout") {
						health = "degraded";
					}
				}
			}
		}

		scene.repositories.set(repoId, {
			id: repoId,
			name,
			fullName,
			health,
			activeBranches: prev?.activeBranches ?? 1,
			lockedFiles: prev?.lockedFiles ?? [],
			mergeQueueLength: prev?.mergeQueueLength ?? 0,
			activePRs: prev?.activePRs ?? 0,
			runningWorkflows: prev?.runningWorkflows ?? (tasksInProgress > 0 ? 1 : 0),
			activeAgents,
			tasksInProgress,
			tasksPending,
			tasksBlocked,
			utilizationPercent: prev?.utilizationPercent ?? (activeAgents > 0 ? 100 : 0),
			avgTaskDuration: prev?.avgTaskDuration ?? 0,
			recentFailures: prev?.recentFailures ?? 0
		});
	}

	return scene;
}
