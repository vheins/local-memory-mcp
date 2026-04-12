import { MCPClient } from "../../mcp/client.js";
import { SQLiteStore } from "../../mcp/storage/sqlite.js";
import { logger } from "../../mcp/utils/logger.js";

export const db = new SQLiteStore();
export const mcpClient = new MCPClient();
export const startTime = Date.now();
export { logger };
