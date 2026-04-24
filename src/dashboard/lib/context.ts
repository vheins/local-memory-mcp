import { MCPClient } from "../../mcp/client";
import { SQLiteStore } from "../../mcp/storage/sqlite";
import { RealVectorStore } from "../../mcp/storage/vectors";
import { logger } from "../../mcp/utils/logger";

export const db = await SQLiteStore.create();
export const mcpClient = new MCPClient();
export const vectors = new RealVectorStore(db);
export const startTime = Date.now();
export { logger };

vectors.initialize().catch((err) => {
	logger.warn("[Dashboard] Initial vector model loading failed. Will retry on first use.", { error: String(err) });
});
