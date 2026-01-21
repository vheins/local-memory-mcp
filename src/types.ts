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
  content: string;
  importance: number;
  scope: MemoryScope;
  created_at: string;
  updated_at: string;
};

export type VectorResult = {
  id: string;
  score: number;
};

export interface VectorStore {
  upsert(id: string, text: string): Promise<void>;
  remove(id: string): Promise<void>;
  search(query: string, limit: number): Promise<VectorResult[]>;
}
