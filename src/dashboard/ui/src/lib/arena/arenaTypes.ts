export type AgentState = 'idle' | 'claiming' | 'processing' | 'handoff_out' | 'handoff_in';
export type AgentFacing = 'down' | 'up' | 'left' | 'right';

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
	walkPhase: number;   // 0–2π continuous, drives leg/bob animation
	facing: AgentFacing;
	state: AgentState;
	claimedTaskIds: string[];
	repos: string[];
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
