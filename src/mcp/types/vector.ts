export type VectorResult = {
	id: string;
	score: number;
};

export interface VectorStore {
	upsert(id: string, text: string): Promise<void>;
	remove(id: string): Promise<void>;
	search(query: string, limit: number, repo?: string): Promise<VectorResult[]>;
}
