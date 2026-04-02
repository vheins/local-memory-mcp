// Shared types for MCP Local Memory

export type MemoryType = "code_fact" | "decision" | "mistake" | "pattern";

export type MemoryScope = {
  repo: string;
  branch?: string;
  folder?: string;
  language?: string;
};

export type MemoryEntry = {
  id: string;
  type: MemoryType;
  title: string;
  content: string;
  importance: number;
  agent: string;
  role: string;
  model: string;
  scope: MemoryScope;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  hit_count: number;
  recall_count: number;
  last_used_at: string | null;
  expires_at: string | null;
  supersedes: string | null;
  status: "active" | "archived";
  tags: string[];
  is_global: boolean;
};

export type VectorResult = {
  id: string;
  score: number;
};

export type TaskStatus = "pending" | "in_progress" | "completed" | "canceled" | "blocked";
export type TaskPriority = 1 | 2 | 3 | 4 | 5; // 5 is highest

export interface Task {
  id: string;
  repo: string;
  task_code: string;
  phase: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  agent: string;
  role: string;
  doc_path: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
  canceled_at: string | null;
  tags: string[];
  metadata: Record<string, any>;
  parent_id: string | null;
  depends_on: string | null;
}

export interface VectorStore {
  upsert(id: string, text: string): Promise<void>;
  remove(id: string): Promise<void>;
  search(query: string, limit: number, repo?: string): Promise<VectorResult[]>;
}
