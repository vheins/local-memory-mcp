export type AgentState = 'idle' | 'claiming' | 'processing' | 'handoff_out' | 'handoff_in';

export interface VisualAgent {
  id: string;
  name: string;
  role: string;
  color: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
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
