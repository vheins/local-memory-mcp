import { pipeline, FeatureExtractionPipeline } from "@xenova/transformers";
import { VectorStore, VectorResult } from "../types.js";
import { SQLiteStore } from "./sqlite.js";
import { logger } from "../utils/logger.js";

export class RealVectorStore implements VectorStore {
  private db: SQLiteStore;
  private extractor: FeatureExtractionPipeline | null = null;
  private modelName = "Xenova/all-MiniLM-L6-v2";

  constructor(db: SQLiteStore) {
    this.db = db;
  }

  /**
   * Triggers background loading of the vector model.
   * Useful for avoiding timeouts on the first search/upsert request.
   */
  async initialize(): Promise<void> {
    await this.getExtractor();
  }

  private async getExtractor(): Promise<FeatureExtractionPipeline> {
    if (!this.extractor) {
      this.extractor = await pipeline("feature-extraction", this.modelName);
    }
    return this.extractor;
  }

  private cosineSimilarity(v1: number[], v2: number[]): number {
    let dotProduct = 0;
    let mag1 = 0;
    let mag2 = 0;
    for (let i = 0; i < v1.length; i++) {
      dotProduct += v1[i] * v2[i];
      mag1 += v1[i] * v1[i];
      mag2 += v2[i] * v2[i];
    }
    const mag = Math.sqrt(mag1) * Math.sqrt(mag2);
    return mag === 0 ? 0 : dotProduct / mag;
  }

  async upsert(id: string, text: string): Promise<void> {
    try {
      const extractor = await this.getExtractor();
      const output = await extractor(text, { pooling: "mean", normalize: true });
      const vector = Array.from(output.data as Float32Array);
      
      this.db.upsertVectorEmbedding(id, vector);
    } catch (error) {
      logger.error("[Vectors] Error during upsert", { id, error: String(error) });
      throw error;
    }
  }

  async remove(id: string): Promise<void> {
    // Handled by SQL CASCADE
  }

  async search(query: string, limit: number, repo?: string): Promise<VectorResult[]> {
    try {
      const extractor = await this.getExtractor();
      const output = await extractor(query, { pooling: "mean", normalize: true });
      const queryVector = Array.from(output.data as Float32Array);

      // Fetch candidates from SQLite using the new public method
      const rows = this.db.getVectorCandidates(repo, 100);

      const results: VectorResult[] = rows.map((row) => {
        const memoryVector = JSON.parse(row.vector) as number[];
        return {
          id: row.memory_id,
          score: this.cosineSimilarity(queryVector, memoryVector)
        };
      });

      return results
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    } catch (error) {
      logger.error("[Vectors] Error during search", { error: String(error) });
      return [];
    }
  }
}
