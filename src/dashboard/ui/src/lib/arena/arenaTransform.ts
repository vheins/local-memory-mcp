import type { Task, TaskClaim, Handoff } from '../interfaces';
import type { VisualAgent, VisualTask, VisualHandoff, ArenaScene, ArenaLayoutConfig } from './arenaTypes';

export const STATUS_COLORS: Record<string, string> = {
	backlog: '#64748b',
	pending: '#0ea5e9',
	in_progress: '#a855f7',
	blocked: '#ef4444',
	completed: '#10b981',
	canceled: '#94a3b8'
};

export const STATUS_ORDER = ['backlog', 'pending', 'in_progress', 'blocked', 'completed', 'canceled'];

const AGENT_COLORS = [
	'#06b6d4',
	'#8b5cf6',
	'#f59e0b',
	'#ec4899',
	'#10b981',
	'#3b82f6',
	'#f97316',
	'#a855f7',
	'#14b8a6',
	'#e11d48'
];

const MAX_TASKS_PER_STATUS = 7;
const MARGIN_X = 56;
const MARGIN_TOP = 46;
const TASK_SPACING_Y = 52;

export function agentColor(name: string): string {
	let hash = 5381;
	for (let i = 0; i < name.length; i++) {
		hash = ((hash << 5) + hash + name.charCodeAt(i)) >>> 0;
	}
	return AGENT_COLORS[hash % AGENT_COLORS.length];
}

function columnX(statusIndex: number, canvasWidth: number): number {
	const colCount = STATUS_ORDER.length;
	const colWidth = (canvasWidth - MARGIN_X * 2) / colCount;
	return MARGIN_X + statusIndex * colWidth + colWidth / 2;
}

export function buildArenaScene(
	tasks: Task[],
	claims: TaskClaim[],
	handoffs: Handoff[],
	existingScene: ArenaScene | null,
	layout: ArenaLayoutConfig
): ArenaScene {
	const { canvasWidth, canvasHeight } = layout;

	const newScene: ArenaScene = {
		agents: new Map(),
		tasks: new Map(),
		handoffs: []
	};

	// Group tasks by status, limit per column
	const tasksByStatus: Record<string, Task[]> = {};
	STATUS_ORDER.forEach((s) => (tasksByStatus[s] = []));

	for (const task of tasks) {
		const status = task.status in tasksByStatus ? task.status : 'backlog';
		if (tasksByStatus[status].length < MAX_TASKS_PER_STATUS) {
			tasksByStatus[status].push(task);
		}
	}

	// Position task nodes
	STATUS_ORDER.forEach((status, colIdx) => {
		const cx = columnX(colIdx, canvasWidth);
		const colTasks = tasksByStatus[status];
		const totalHeight = (colTasks.length - 1) * TASK_SPACING_Y;
		const startY = MARGIN_TOP + 20 + (canvasHeight - MARGIN_TOP - 20 - totalHeight) / 2;

		colTasks.forEach((task, i) => {
			const tx = cx;
			const ty = startY + i * TASK_SPACING_Y;
			const existing = existingScene?.tasks.get(task.id);

			newScene.tasks.set(task.id, {
				id: task.id,
				taskCode: task.task_code,
				title: task.title,
				repo: task.repo,
				status: task.status,
				priority: task.priority ?? 3,
				x: existing?.x ?? tx,
				y: existing?.y ?? ty,
				claimedByAgentId: task.coordination?.active_claim_agent ?? null,
				hasPendingHandoff: (task.coordination?.pending_handoff_count ?? 0) > 0
			});
		});
	});

	// Build agent map from claims + task coordination
	const agentMap: Map<string, { tasks: Set<string>; role: string; repos: Set<string> }> = new Map();

	for (const claim of claims) {
		if (!agentMap.has(claim.agent)) {
			agentMap.set(claim.agent, { tasks: new Set(), role: claim.role, repos: new Set() });
		}
		const entry = agentMap.get(claim.agent)!;
		entry.tasks.add(claim.task_id);
		entry.repos.add(claim.repo);
	}

	// Also pick up agents from task coordination (may have been filtered out of claims)
	for (const task of tasks) {
		const agentName = task.coordination?.active_claim_agent;
		if (!agentName) continue;
		if (!agentMap.has(agentName)) {
			agentMap.set(agentName, { tasks: new Set(), role: task.coordination?.active_claim_role ?? 'agent', repos: new Set() });
		}
		const entry = agentMap.get(agentName)!;
		entry.tasks.add(task.id);
		entry.repos.add(task.repo);
	}

	const agentNames = Array.from(agentMap.keys());
	const idleY = canvasHeight - 40;

	agentNames.forEach((agentName, idx) => {
		const { tasks: claimedTaskIds, role, repos } = agentMap.get(agentName)!;
		const existing = existingScene?.agents.get(agentName);

		// Resolve first visible claimed task for target position
		let targetX: number;
		let targetY: number;

		const firstVisibleTaskId = Array.from(claimedTaskIds).find((tid) => newScene.tasks.has(tid));
		const firstTask = firstVisibleTaskId ? newScene.tasks.get(firstVisibleTaskId) : null;

		if (firstTask) {
			// Slightly offset from the task node
			targetX = firstTask.x + 22;
			targetY = firstTask.y - 22;
		} else {
			// Idle: distribute across bottom strip
			targetX = (canvasWidth * (idx + 1)) / (agentNames.length + 1);
			targetY = idleY;
		}

		const state = claimedTaskIds.size > 0 ? 'processing' : 'idle';

		newScene.agents.set(agentName, {
			id: agentName,
			name: agentName,
			role,
			color: agentColor(agentName),
			x: existing?.x ?? targetX,
			y: existing?.y ?? targetY,
			targetX,
			targetY,
			state,
			claimedTaskIds: Array.from(claimedTaskIds),
			repos: Array.from(repos)
		});
	});

	// Build handoff list
	for (const h of handoffs) {
		if (h.status !== 'pending') continue;
		newScene.handoffs.push({
			id: h.id,
			fromAgentId: h.from_agent,
			toAgentId: h.to_agent,
			taskId: h.task_id,
			summary: h.summary
		});
	}

	return newScene;
}
