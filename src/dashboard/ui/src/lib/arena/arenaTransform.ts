import type { Task, TaskClaim, Handoff } from '../interfaces';
import type { VisualAgent, VisualTask, VisualHandoff, ArenaScene, ArenaLayoutConfig, ZoneRect } from './arenaTypes';

export const STATUS_COLORS: Record<string, string> = {
	backlog: '#64748b',
	pending: '#0ea5e9',
	in_progress: '#a855f7',
	blocked: '#ef4444',
	completed: '#10b981',
	canceled: '#94a3b8'
};

// Maps task status → zone id
const STATUS_TO_ZONE: Record<string, string> = {
	backlog: 'pending',       // backlog lives in inbox too
	pending: 'pending',
	in_progress: 'in_progress',
	blocked: 'blocked',
	completed: 'completed',
	canceled: 'canceled'
};

const AGENT_COLORS = [
	'#06b6d4', '#f59e0b', '#ec4899', '#10b981',
	'#3b82f6', '#f97316', '#14b8a6', '#e11d48',
	'#8b5cf6', '#84cc16'
];

const MAX_TASKS_PER_ZONE = 7;
const TASK_INNER_PAD = 22;
const TASK_TOP_PAD = 28; // below zone label

export function agentColor(name: string): string {
	let h = 5381;
	for (let i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) >>> 0;
	return AGENT_COLORS[h % AGENT_COLORS.length];
}

/** Computes zone rectangles for the given canvas size. */
export function computeZones(cw: number, ch: number): ZoneRect[] {
	const M = 10;
	const G = 8;
	const lobbyW = Math.min(148, Math.floor(cw * 0.155));
	const mainX = M + lobbyW + G;
	const mainW = cw - mainX - M;
	const innerH = ch - M * 2;
	const topH = Math.floor((innerH - G) * 0.48);
	const botH = innerH - topH - G;

	const t1 = Math.floor(mainW * 0.29);
	const t2 = Math.floor(mainW * 0.38);
	const t3 = mainW - t1 - t2 - G * 2;

	const b1 = Math.floor(mainW * 0.46);
	const b2 = mainW - b1 - G;

	return [
		{ id: 'idle',        label: 'Lobby',     x: M,                          y: M,           w: lobbyW, h: innerH, color: '#8b5cf6' },
		{ id: 'pending',     label: 'Inbox',     x: mainX,                      y: M,           w: t1,     h: topH,   color: '#0ea5e9' },
		{ id: 'in_progress', label: 'Workspace', x: mainX + t1 + G,             y: M,           w: t2,     h: topH,   color: '#a855f7' },
		{ id: 'blocked',     label: 'Issues',    x: mainX + t1 + G + t2 + G,    y: M,           w: t3,     h: topH,   color: '#ef4444' },
		{ id: 'completed',   label: 'Done',      x: mainX,                      y: M + topH + G, w: b1,    h: botH,   color: '#10b981' },
		{ id: 'canceled',    label: 'Archive',   x: mainX + b1 + G,             y: M + topH + G, w: b2,    h: botH,   color: '#94a3b8' },
	];
}

/** Spreads tasks as workstations within their zone. */
function placeTasksInZones(tasks: Task[], zones: ZoneRect[]): Map<string, { x: number; y: number }> {
	const zoneById = new Map(zones.map((z) => [z.id, z]));
	const byZone = new Map<string, Task[]>();
	zones.forEach((z) => byZone.set(z.id, []));

	for (const task of tasks) {
		const zid = STATUS_TO_ZONE[task.status] ?? 'pending';
		const bucket = byZone.get(zid)!;
		if (bucket.length < MAX_TASKS_PER_ZONE) bucket.push(task);
	}

	const positions = new Map<string, { x: number; y: number }>();

	for (const [zid, zoneTasks] of byZone) {
		const zone = zoneById.get(zid);
		if (!zone || zoneTasks.length === 0) continue;

		const innerW = zone.w - TASK_INNER_PAD * 2;
		const innerH = zone.h - TASK_INNER_PAD - TASK_TOP_PAD;
		const cols = Math.max(1, Math.floor(innerW / 58));
		const rows = Math.ceil(zoneTasks.length / cols);
		const cellW = innerW / cols;
		const cellH = Math.min(70, innerH / rows);

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
	const idleZone = zones.find((z) => z.id === 'idle')!;

	const scene: ArenaScene = { agents: new Map(), tasks: new Map(), handoffs: [] };

	// --- Tasks ---
	for (const task of tasks) {
		const pos = taskPositions.get(task.id);
		if (!pos) continue;
		const prev = existingScene?.tasks.get(task.id);
		scene.tasks.set(task.id, {
			id: task.id,
			taskCode: task.task_code,
			title: task.title,
			repo: task.repo,
			status: task.status,
			priority: task.priority ?? 3,
			x: prev?.x ?? pos.x,
			y: prev?.y ?? pos.y,
			claimedByAgentId: task.coordination?.active_claim_agent ?? null,
			hasPendingHandoff: (task.coordination?.pending_handoff_count ?? 0) > 0
		});
	}

	// --- Agents (from claims + task coordination) ---
	const agentMap = new Map<string, { tasks: Set<string>; role: string; repos: Set<string> }>();

	for (const claim of claims) {
		if (!agentMap.has(claim.agent))
			agentMap.set(claim.agent, { tasks: new Set(), role: claim.role, repos: new Set() });
		const e = agentMap.get(claim.agent)!;
		e.tasks.add(claim.task_id);
		e.repos.add(claim.repo);
	}
	for (const task of tasks) {
		const a = task.coordination?.active_claim_agent;
		if (!a) continue;
		if (!agentMap.has(a))
			agentMap.set(a, { tasks: new Set(), role: task.coordination?.active_claim_role ?? 'agent', repos: new Set() });
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

		// Target: 18px above+right of task (so agent is adjacent to desk)
		const targetX = tgt ? tgt.x + 20 : spawnX;
		const targetY = tgt ? tgt.y - 18 : spawnY;

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
			facing: prev?.facing ?? 'down',
			state: claimedIds.size > 0 ? 'processing' : 'idle',
			claimedTaskIds: Array.from(claimedIds),
			repos: Array.from(repos)
		});
	});

	// --- Handoffs ---
	for (const h of handoffs) {
		if (h.status !== 'pending') continue;
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
