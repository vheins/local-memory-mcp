import { MCPClient } from "../../mcp/client";
import { SQLiteStore } from "../../mcp/storage/sqlite";
import { RealVectorStore } from "../../mcp/storage/vectors";
import { EmbeddingWorker } from "../../mcp/embedding-queue";
import { logger } from "../../mcp/utils/logger";

export const db = await SQLiteStore.create();
export const mcpClient = new MCPClient();
export const vectors = new RealVectorStore(db);
// Embedding/KG outbox worker (TASK-013): the dashboard shares the SQLite
// queue_jobs table with the MCP server — atomic claims serialize work across
// processes. Started by dashboard/server.ts.
export const embeddingWorker = new EmbeddingWorker(db, vectors);
export const startTime = Date.now();
export { logger };

vectors.initialize().catch((err) => {
	logger.warn("[Dashboard] Initial vector model loading failed. Will retry on first use.", { error: String(err) });
});
