export type VectorResult = {
	id: string;
	score: number;
};

export type VectorEntityKind = "memory" | "standard" | "task" | "codebase_symbol";

export interface VectorStore {
	upsert(id: string, text: string, kind?: VectorEntityKind): Promise<void>;
	remove(id: string, kind?: VectorEntityKind): Promise<void>;
	search(query: string, limit: number, repo?: string, kind?: VectorEntityKind): Promise<VectorResult[]>;
}
