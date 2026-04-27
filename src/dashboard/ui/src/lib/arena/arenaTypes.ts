export type AgentState = "idle" | "claiming" | "processing" | "handoff_out" | "handoff_in" | "burnout" | "blocked";
export type AgentFacing = "down" | "up" | "left" | "right";

// ── Handoff Animation Types ────────────────────────────────────────────────
export type HandoffAnimPhase = "pickup" | "moving" | "arrive" | "resting";
export type HandoffVehicle = "wheelchair" | "stretcher";
export type HelperVariant = "male_nurse" | "female_nurse" | "staff1" | "staff2";

export interface HandoffAnimData {
	phase: HandoffAnimPhase;
	vehicle: HandoffVehicle;
	helperVariant: HelperVariant;
	/** Start position when handoff began */
	startX: number;
	startY: number;
	/** Target position in therapy room */
	endX: number;
	endY: number;
	/** 0..1 progress along the path */
	progress: number;
	/** Timestamp when current phase started */
	phaseStartTs: number;
	/** Wheel rotation angle (radians) */
	wheelAngle: number;
	/** Helper walk phase for leg animation */
	helperWalkPhase: number;
	/** Helper facing direction */
	helperFacing: AgentFacing;
	/** Step bounce offset (sine-based for natural walk) */
	stepBounce: number;
}

export interface VisualAgent {
	id: string;
	name: string;
	role: string;
	color: string;
	x: number;
	y: number;
	targetX: number;
	targetY: number;
	vx: number;
	vy: number;
	walkPhase: number; // 0–2π continuous, drives leg/bob animation
	facing: AgentFacing;
	state: AgentState;
	claimedTaskIds: string[];
	repos: string[];
	lastUpdateTs: number;
	/** Active handoff animation data, null when no handoff in progress */
	handoffAnim: HandoffAnimData | null;
}

export interface VisualTask {
	id: string;
	taskCode: string;
	title: string;
	repo: string;
	status: string;
	priority: number;
	x: number;
	y: number;
	claimedByAgentId: string | null;
	hasPendingHandoff: boolean;
}

export interface VisualHandoff {
	id: string;
	fromAgentId: string;
	toAgentId: string | null;
	taskId: string | null;
	summary: string;
}

export interface ArenaScene {
	agents: Map<string, VisualAgent>;
	tasks: Map<string, VisualTask>;
	handoffs: VisualHandoff[];
}

export interface ArenaLayoutConfig {
	canvasWidth: number;
	canvasHeight: number;
}

export interface ZoneRect {
	id: string;
	label: string;
	x: number;
	y: number;
	w: number;
	h: number;
	color: string;
}
