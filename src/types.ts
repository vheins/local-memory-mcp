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
  scope: MemoryScope;
  created_at: string;
  updated_at: string;
  hit_count: number;
  recall_count: number;
  last_used_at: string | null;
  expires_at: string | null;
  supersedes: string | null;
  status: "active" | "archived";
};

export type VectorResult = {
  id: string;
  score: number;
};

export interface VectorStore {
  upsert(id: string, text: string): Promise<void>;
  remove(id: string): Promise<void>;
  search(query: string, limit: number, repo?: string): Promise<VectorResult[]>;
}
