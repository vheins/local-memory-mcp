import { VectorStore, VectorResult } from "../types.js";

// Stub implementation - no embedding yet
export class StubVectorStore implements VectorStore {
  async upsert(id: string, text: string): Promise<void> {
    // no-op
  }

  async remove(id: string): Promise<void> {
    // no-op
  }

  async search(query: string, limit: number): Promise<VectorResult[]> {
    // Return empty results - fallback to keyword search
    return [];
  }
}
