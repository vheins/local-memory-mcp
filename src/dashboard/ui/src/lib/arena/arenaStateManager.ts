import { writable, type Writable } from "svelte/store";
import type { VisualAgent, VisualTask, VisualRepository, ArenaScene } from "./arenaTypes";
import type {
	DomainEvent,
	ArenaState,
	ArenaPatch,
	ZoneAggregate,
	ArenaMetrics,
	FilterState,
	EventLogEntry
} from "./arenaEvents";

// ─── Zoom constraints ──────────────────────────────────────────────────────
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 3.0;

export class ArenaStateManager {
	private state: ArenaState;
	private subscribers: Set<(patch: ArenaPatch) => void> = new Set();
	private store: Writable<ArenaState>;

	constructor() {
		this.state = this.createInitialState();
		this.store = writable(this.state);
	}

	private createInitialState(): ArenaState {
		return {
			version: 0,
			agents: new Map(),
			tasks: new Map(),
			repositories: new Map(),
			handoffs: [],
			zones: {
				pending: this.emptyZone(),
				inProgress: this.emptyZone(),
				backlog: this.emptyZone(),
				blocked: this.emptyZone(),
				recovery: this.emptyZone()
			},
			metrics: {
				successRate: 0,
				failureRate: 0,
				retryRate: 0,
				throughput: 0,
				avgDuration: 0,
				tokenConsumption: 0,
				cost: 0,
				agentUtilization: 0,
				queueDepth: 0
			},
			ui: {
				selectedEntityId: null,
				selectedEntityType: null,
				zoom: 1.0,
				panX: 0,
				panY: 0,
				hoveredEntityId: null,
				activeFilter: {
					repository: null,
					roles: [],
					priorities: [],
					statuses: [],
					search: ""
				},
				timelineVisible: false,
				sidePanelVisible: false,
				sidePanelView: "agent",
				eventLog: [],
				paused: false
			}
		};
	}

	private emptyZone(): ZoneAggregate {
		return {
			count: 0,
			oldestWait: 0,
			averageWait: 0,
			priorityDistribution: {},
			eta: null,
			blockedByDistribution: null
		};
	}

	// ── Public API ──────────────────────────────────────────────────────────

	/** Subscribe to state patches emitted on every event. */
	subscribe(cb: (patch: ArenaPatch) => void): () => void {
		this.subscribers.add(cb);
		return () => {
			this.subscribers.delete(cb);
		};
	}

	/** Get the Svelte store for reactive bindings. */
	getStore(): Writable<ArenaState> {
		return this.store;
	}

	/** Get a shallow snapshot of the current state. */
	getSnapshot(): ArenaState {
		return { ...this.state };
	}

	/** Apply a domain event and produce a differential patch. */
	applyEvent(event: DomainEvent): ArenaPatch {
		this.logDomainEvent(event);
		const patch = this.processEvent(event);
		if (patch) {
			this.applyPatch(patch);
		}
		return patch;
	}

	/** Apply a pre-computed patch directly. */
	applyPatch(patch: ArenaPatch): void {
		this.state.version++;

		// Apply entity changes
		if (patch.entities.agents) {
			for (const [id, changes] of patch.entities.agents) {
				const existing = this.state.agents.get(id);
				if (existing) {
					Object.assign(existing, changes);
				} else {
					this.state.agents.set(id, changes as VisualAgent);
				}
			}
		}
		if (patch.entities.tasks) {
			for (const [id, changes] of patch.entities.tasks) {
				const existing = this.state.tasks.get(id);
				if (existing) {
					Object.assign(existing, changes);
				} else {
					this.state.tasks.set(id, changes as VisualTask);
				}
			}
		}
		if (patch.entities.repositories) {
			for (const [id, changes] of patch.entities.repositories) {
				const existing = this.state.repositories.get(id);
				if (existing) {
					Object.assign(existing, changes);
				} else {
					this.state.repositories.set(id, changes as VisualRepository);
				}
			}
		}

		// Recompute zone aggregates if needed
		if (patch.invalidatedZones.length > 0) {
			this.recomputeZones(patch.invalidatedZones);
		}

		// Recompute metrics if needed
		if (patch.metricsChanged) {
			this.recomputeMetrics();
		}

		// Push to Svelte store + notify external subscribers
		this.store.set(this.state);

		for (const cb of this.subscribers) {
			cb(patch);
		}
	}

	// ── Event Processors ────────────────────────────────────────────────────

	private processEvent(event: DomainEvent): ArenaPatch {
		const patch: ArenaPatch = {
			entities: {},
			invalidatedZones: [],
			effects: [],
			metricsChanged: false
		};

		switch (event.type) {
			case "agent-connected": {
				const agent: VisualAgent = {
					id: event.agentId,
					name: event.name,
					role: event.role,
					model: event.model,
					color: "#8b5cf6",
					x: 100,
					y: 100,
					targetX: 100,
					targetY: 100,
					vx: 0,
					vy: 0,
					walkPhase: 0,
					facing: "down",
					state: "idle",
					claimedTaskIds: [],
					repos: [],
					lastUpdateTs: event.timestamp,
					handoffAnim: null,
					health: "healthy",
					currentAction: "idle",
					currentTool: "",
					confidence: 1.0,
					progress: 0,
					tokenUsage: 0,
					tokenBurnRate: 0,
					cost: 0,
					latency: 0,
					contextUsage: 0,
					queueLength: 0,
					memoryOps: 0,
					toolCalls: 0,
					statusIcon: "●",
					speechBubble: null,
					speechBubbleTs: 0,
					activityAnimation: "idle",
					healthRing: 100,
					coloredOutline: "#8b5cf6"
				};
				patch.entities.agents = new Map([[event.agentId, agent]]);
				patch.invalidatedZones = ["inProgress"];
				break;
			}

			case "agent-disconnected": {
				patch.entities.agents = new Map([
					[event.agentId, { state: "burnout", health: "offline" } as Partial<VisualAgent>]
				]);
				patch.invalidatedZones = ["inProgress", "recovery"];
				break;
			}

			case "agent-health-changed": {
				patch.entities.agents = new Map([
					[
						event.agentId,
						{
							health: event.health,
							healthRing: event.health === "healthy" ? 100 : event.health === "degraded" ? 60 : 25,
							speechBubble: `Health: ${event.reason}`,
							speechBubbleTs: Date.now()
						}
					]
				]);
				if (event.health === "critical") {
					patch.effects.push({
						type: "error-flash",
						entityId: event.agentId,
						entityType: "agent",
						intensity: 1,
						duration: 500
					});
				}
				break;
			}

			case "agent-action-changed": {
				patch.entities.agents = new Map([
					[
						event.agentId,
						{
							currentAction: event.action as VisualAgent["currentAction"],
							currentTool: event.tool || ""
						}
					]
				]);
				break;
			}

			case "task-created": {
				const task: VisualTask = {
					id: event.taskId,
					taskCode: event.taskId,
					title: event.title,
					repo: event.repositoryId,
					status: "pending",
					priority: 2,
					x: 0,
					y: 0,
					claimedByAgentId: null,
					hasPendingHandoff: false,
					priorityLevel: "p2",
					ownerId: "",
					repositoryId: event.repositoryId,
					createdAt: event.timestamp,
					startedAt: null,
					estimatedDuration: 0,
					actualDuration: null,
					waitTime: 0,
					progress: 0,
					retryCount: 0,
					maxRetries: 3,
					failureReason: null,
					blockedReason: null,
					blockedById: null,
					tokenCost: 0,
					estimatedCost: 0,
					labels: [],
					tags: [],
					taskType: "feature",
					animationState: "entering"
				};
				patch.entities.tasks = new Map([[event.taskId, task]]);
				patch.invalidatedZones = ["pending"];
				patch.metricsChanged = true;
				break;
			}

			case "task-assigned": {
				patch.entities.tasks = new Map([
					[
						event.taskId,
						{
							claimedByAgentId: event.agentId,
							ownerId: event.agentId,
							status: "pending",
							animationState: "pulse"
						} as Partial<VisualTask>
					]
				]);
				patch.invalidatedZones = ["pending", "inProgress"];
				break;
			}

			case "task-started": {
				patch.entities.tasks = new Map([
					[
						event.taskId,
						{
							status: "in_progress",
							startedAt: event.timestamp,
							progress: 0,
							animationState: "pulse"
						} as Partial<VisualTask>
					]
				]);
				patch.entities.agents = new Map([
					[
						event.agentId,
						{
							state: "processing",
							currentAction: "coding"
						} as Partial<VisualAgent>
					]
				]);
				patch.invalidatedZones = ["pending", "inProgress"];
				break;
			}

			case "task-progressed": {
				patch.entities.tasks = new Map([
					[
						event.taskId,
						{
							progress: event.progress,
							tokenCost: event.tokenUsage
						}
					]
				]);
				break;
			}

			case "task-blocked": {
				patch.entities.tasks = new Map([
					[
						event.taskId,
						{
							status: "blocked",
							blockedReason: event.reason as VisualTask["blockedReason"],
							blockedById: event.blockedById,
							failureReason: event.detail,
							animationState: "shake"
						} as Partial<VisualTask>
					]
				]);
				patch.invalidatedZones = ["inProgress", "blocked"];
				patch.effects.push({
					type: "blocked-pulse",
					entityId: event.taskId,
					entityType: "task",
					intensity: 0.5,
					duration: 800
				});
				break;
			}

			case "task-unblocked": {
				patch.entities.tasks = new Map([
					[
						event.taskId,
						{
							status: "pending",
							blockedReason: null,
							blockedById: null,
							failureReason: null,
							animationState: "entering"
						} as Partial<VisualTask>
					]
				]);
				patch.invalidatedZones = ["blocked", "pending"];
				break;
			}

			case "task-retry-scheduled": {
				patch.entities.tasks = new Map([
					[
						event.taskId,
						{
							retryCount: event.attempt,
							maxRetries: event.maxRetries,
							status: "pending",
							animationState: "pulse"
						} as Partial<VisualTask>
					]
				]);
				patch.invalidatedZones = ["recovery", "pending"];
				patch.effects.push({
					type: "cooldown",
					entityId: event.taskId,
					entityType: "task",
					intensity: 0.3,
					duration: event.backoffSeconds * 1000
				});
				break;
			}

			case "task-completed": {
				patch.entities.tasks = new Map([
					[
						event.taskId,
						{
							status: "completed",
							actualDuration: event.duration,
							tokenCost: event.tokenCost,
							progress: 1,
							animationState: "celebration"
						} as Partial<VisualTask>
					]
				]);
				patch.entities.agents = new Map([
					[
						event.agentId,
						{
							state: "idle",
							currentAction: "idle",
							progress: 0
						} as Partial<VisualAgent>
					]
				]);
				patch.invalidatedZones = ["inProgress"];
				patch.metricsChanged = true;
				patch.effects.push({
					type: "celebration",
					entityId: event.taskId,
					entityType: "task",
					intensity: 1,
					duration: 1500
				});
				break;
			}

			case "task-failed": {
				patch.entities.tasks = new Map([
					[
						event.taskId,
						{
							status: "blocked",
							failureReason: event.error,
							retryCount: event.canRetry ? 1 : 0,
							animationState: "shake"
						} as Partial<VisualTask>
					]
				]);
				patch.entities.agents = new Map([
					[
						event.agentId,
						{
							state: "burnout",
							currentAction: "retrying"
						} as Partial<VisualAgent>
					]
				]);
				patch.invalidatedZones = ["inProgress", "blocked", "recovery"];
				patch.metricsChanged = true;
				patch.effects.push({
					type: "error-flash",
					entityId: event.taskId,
					entityType: "task",
					intensity: 1,
					duration: 600
				});
				break;
			}

			case "memory-created":
			case "memory-updated": {
				const memEvent = event as { agentId: string; summary: string };
				if (memEvent.agentId && this.state.agents.has(memEvent.agentId)) {
					patch.entities.agents = new Map([
						[
							memEvent.agentId,
							{
								memoryOps: (this.state.agents.get(memEvent.agentId)?.memoryOps || 0) + 1,
								speechBubble: `Memory: ${memEvent.summary || "synced"}`,
								speechBubbleTs: Date.now()
							}
						]
					]);
					patch.effects.push({
						type: "memory-sync",
						entityId: memEvent.agentId,
						entityType: "agent",
						intensity: 0.4,
						duration: 2000
					});
				}
				break;
			}

			case "repository-locked": {
				patch.entities.repositories = new Map([
					[event.repositoryId, { lockedFiles: [event.file] } as Partial<VisualRepository>]
				]);
				break;
			}

			case "repository-unlocked": {
				patch.entities.repositories = new Map([[event.repositoryId, { lockedFiles: [] } as Partial<VisualRepository>]]);
				break;
			}

			case "repository-health-changed": {
				patch.entities.repositories = new Map([
					[
						event.repositoryId,
						{
							health: event.health,
							utilizationPercent: event.metrics.utilizationPercent || 0
						} as Partial<VisualRepository>
					]
				]);
				break;
			}

			case "metrics-updated": {
				patch.metricsChanged = true;
				break;
			}
		}

		return patch;
	}

	// ── Zone Recomputations ─────────────────────────────────────────────────

	private recomputeZones(zoneNames: string[]): void {
		const tasks = Array.from(this.state.tasks.values());
		const agents = Array.from(this.state.agents.values());
		const now = Date.now();

		for (const zoneName of zoneNames) {
			let zoneTasks: VisualTask[];
			switch (zoneName) {
				case "pending":
					zoneTasks = tasks.filter((t) => t.status === "pending" && !t.claimedByAgentId);
					break;
				case "inProgress":
					zoneTasks = tasks.filter((t) => t.status === "in_progress" || (t.status === "pending" && t.claimedByAgentId));
					break;
				case "backlog":
					zoneTasks = tasks.filter((t) => t.status === "backlog");
					break;
				case "blocked":
					zoneTasks = tasks.filter((t) => t.status === "blocked");
					break;
				case "recovery":
					zoneTasks = tasks.filter((t) => t.retryCount > 0 || t.failureReason !== null);
					break;
				default:
					zoneTasks = [];
			}

			const aggregate = this.emptyZone();
			aggregate.count = zoneTasks.length;

			if (zoneTasks.length > 0) {
				const waits = zoneTasks.map((t) => (t.createdAt ? (now - t.createdAt) / 1000 : 0));
				aggregate.oldestWait = Math.max(...waits);
				aggregate.averageWait = waits.reduce((a, b) => a + b, 0) / waits.length;

				// Priority distribution
				const dist: Record<string, number> = {};
				for (const t of zoneTasks) {
					const p = `p${t.priority}`;
					dist[p] = (dist[p] || 0) + 1;
				}
				aggregate.priorityDistribution = dist;

				// ETA rough estimate
				const activeAgents = agents.filter((a) => a.state === "processing").length;
				if (activeAgents > 0 && zoneTasks.length > 0) {
					const avgDuration = 30; // rough 30s default
					aggregate.eta = (zoneTasks.length * avgDuration) / activeAgents;
				}

				// Blocked by distribution (blocked zone only)
				if (zoneName === "blocked") {
					const blockedDist: Record<string, number> = {};
					for (const t of zoneTasks) {
						const reason = t.blockedReason || "unknown";
						blockedDist[reason] = (blockedDist[reason] || 0) + 1;
					}
					aggregate.blockedByDistribution = blockedDist;
				}
			}

			(this.state.zones as Record<string, ZoneAggregate>)[zoneName] = aggregate;
		}
	}

	// ── Metrics Recomputations ──────────────────────────────────────────────

	private recomputeMetrics(): void {
		const tasks = Array.from(this.state.tasks.values());
		const agents = Array.from(this.state.agents.values());
		const completed = tasks.filter((t) => t.status === "completed").length;
		const failed = tasks.filter((t) => t.status === "blocked" && t.failureReason !== null).length;
		const total = completed + failed + tasks.filter((t) => t.status === "in_progress").length;

		this.state.metrics = {
			successRate: total > 0 ? (completed / total) * 100 : 100,
			failureRate: total > 0 ? (failed / total) * 100 : 0,
			retryRate: (tasks.filter((t) => t.retryCount > 0).length / Math.max(1, total)) * 100,
			throughput: completed / Math.max(1, (Date.now() - (tasks[0]?.createdAt || Date.now())) / 60000),
			avgDuration:
				completed > 0
					? tasks.filter((t) => t.actualDuration !== null).reduce((s, t) => s + (t.actualDuration || 0), 0) / completed
					: 0,
			tokenConsumption: tasks.reduce((s, t) => s + (t.tokenCost || 0), 0),
			cost: tasks.reduce((s, t) => s + (t.estimatedCost || 0), 0),
			agentUtilization:
				agents.length > 0 ? (agents.filter((a) => a.state === "processing").length / agents.length) * 100 : 0,
			queueDepth: tasks.filter((t) => t.status === "pending").length
		};
	}

	// ── Initialization from Scene ───────────────────────────────────────────

	/** Populate the full state from an existing ArenaScene snapshot. */
	initFromScene(scene: ArenaScene): void {
		this.state.agents = new Map(scene.agents);
		this.state.tasks = new Map(scene.tasks);
		this.state.handoffs = scene.handoffs;
		this.state.repositories = new Map(scene.repositories);
		this.recomputeZones(["pending", "inProgress", "backlog", "blocked", "recovery"]);
		this.recomputeMetrics();
		this.store.set(this.state);
	}

	// ── UI State Helpers ────────────────────────────────────────────────────

	setSelected(entityId: string | null, entityType: "agent" | "task" | "repository" | null): void {
		this.state.ui.selectedEntityId = entityId;
		this.state.ui.selectedEntityType = entityType;
		this.store.set(this.state);
	}

	setZoom(zoom: number): void {
		this.state.ui.zoom = Math.max(0.1, Math.min(3.0, zoom));
		this.store.set(this.state);
	}

	setPan(panX: number, panY: number): void {
		this.state.ui.panX = panX;
		this.state.ui.panY = panY;
		this.store.set(this.state);
	}

	resetView(): void {
		this.state.ui.zoom = 1.0;
		this.state.ui.panX = 0;
		this.state.ui.panY = 0;
		this.store.set(this.state);
	}

	/** Animate zoom+pan to center on a world coordinate. */
	zoomToEntity(worldX: number, worldY: number, targetZoom: number = 2.0): void {
		this.state.ui.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, targetZoom));
		// Center on the entity: pan = -(worldPos * zoom - canvasCenter)
		// The caller should compute pan based on canvas size, but we store zoom here.
		// Pan is computed in the Svelte component where canvas dims are known.
		this.store.set(this.state);
	}

	setHovered(entityId: string | null): void {
		this.state.ui.hoveredEntityId = entityId;
		this.store.set(this.state);
	}

	setFilter(filter: Partial<FilterState>): void {
		Object.assign(this.state.ui.activeFilter, filter);
		this.store.set(this.state);
	}

	toggleTimeline(): void {
		this.state.ui.timelineVisible = !this.state.ui.timelineVisible;
		this.store.set(this.state);
	}

	toggleSidePanel(): void {
		this.state.ui.sidePanelVisible = !this.state.ui.sidePanelVisible;
		this.store.set(this.state);
	}

	setSidePanelView(view: "agent" | "task" | "repo" | "trace"): void {
		this.state.ui.sidePanelView = view;
		this.state.ui.sidePanelVisible = true;
		this.store.set(this.state);
	}

	togglePause(): void {
		this.state.ui.paused = !this.state.ui.paused;
		this.store.set(this.state);
	}

	/** Clear an agent's speech bubble after display duration expires. */
	clearSpeechBubble(agentId: string): void {
		const agent = this.state.agents.get(agentId);
		if (agent) {
			agent.speechBubble = null;
			agent.speechBubbleTs = 0;
			this.store.set(this.state);
		}
	}

	private logDomainEvent(event: DomainEvent): void {
		let detail = "";
		let entityType: "agent" | "task" | "repository" = "task";
		let entityId = "";
		const action = event.type;

		switch (event.type) {
			case "agent-connected":
				entityType = "agent";
				entityId = event.agentId;
				detail = `Agent connected: ${event.name} (${event.role})`;
				break;
			case "agent-disconnected":
				entityType = "agent";
				entityId = event.agentId;
				detail = `Agent disconnected: ${event.agentId}`;
				break;
			case "agent-health-changed":
				entityType = "agent";
				entityId = event.agentId;
				detail = `Agent health changed to ${event.health} (${event.reason})`;
				break;
			case "agent-action-changed":
				entityType = "agent";
				entityId = event.agentId;
				detail = `Agent action: ${event.action}${event.tool ? ` using ${event.tool}` : ""}`;
				break;
			case "task-created":
				entityType = "task";
				entityId = event.taskId;
				detail = `Task created: ${event.title}`;
				break;
			case "task-assigned":
				entityType = "task";
				entityId = event.taskId;
				detail = `Task assigned to agent ${event.agentId}`;
				break;
			case "task-started":
				entityType = "task";
				entityId = event.taskId;
				detail = `Task started by agent ${event.agentId}`;
				break;
			case "task-progressed":
				entityType = "task";
				entityId = event.taskId;
				detail = `Task progress: ${Math.round(event.progress * 100)}%`;
				break;
			case "task-blocked":
				entityType = "task";
				entityId = event.taskId;
				detail = `Task blocked: ${event.reason}`;
				break;
			case "task-unblocked":
				entityType = "task";
				entityId = event.taskId;
				detail = `Task unblocked`;
				break;
			case "task-retry-scheduled":
				entityType = "task";
				entityId = event.taskId;
				detail = `Task retry scheduled: attempt ${event.attempt}/${event.maxRetries}`;
				break;
			case "task-completed":
				entityType = "task";
				entityId = event.taskId;
				detail = `Task completed by agent ${event.agentId}`;
				break;
			case "task-failed":
				entityType = "task";
				entityId = event.taskId;
				detail = `Task failed by agent ${event.agentId}: ${event.error}`;
				break;
			case "memory-created":
				entityType = "agent";
				entityId = event.agentId;
				detail = `Memory created by agent: ${event.summary}`;
				break;
			case "memory-updated":
				entityType = "agent";
				entityId = event.agentId;
				detail = `Memory updated by agent: ${event.summary}`;
				break;
			case "repository-locked":
				entityType = "repository";
				entityId = event.repositoryId;
				detail = `Repository locked file: ${event.file}`;
				break;
			case "repository-unlocked":
				entityType = "repository";
				entityId = event.repositoryId;
				detail = `Repository unlocked`;
				break;
			case "repository-health-changed":
				entityType = "repository";
				entityId = event.repositoryId;
				detail = `Repository health changed to ${event.health}`;
				break;
			case "metrics-updated":
				entityType = "repository";
				entityId = "metrics";
				detail = `Metrics updated`;
				break;
			default:
				detail = `Event: ${(event as any).type}`;
		}

		const entry: EventLogEntry = {
			id: Math.random().toString(36).substring(2, 9) + "-" + Date.now(),
			type: event.type,
			entityId,
			entityType,
			action,
			timestamp: (event as any).timestamp || Date.now(),
			detail,
			event
		};

		this.state.ui.eventLog = [...this.state.ui.eventLog, entry];
		// Limit to 200 entries to prevent memory grow
		if (this.state.ui.eventLog.length > 200) {
			this.state.ui.eventLog = this.state.ui.eventLog.slice(this.state.ui.eventLog.length - 200);
		}
	}
}

// Singleton instance
export const arenaStateManager = new ArenaStateManager();
