import { MCPClient } from "../../mcp/client";
import { SQLiteStore } from "../../mcp/storage/sqlite";
import { logger } from "../../mcp/utils/logger";

export const db = new SQLiteStore();
export const mcpClient = new MCPClient();
export const startTime = Date.now();
export { logger };
