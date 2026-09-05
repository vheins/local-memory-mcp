import { MCPClient } from "../../mcp/client";
import { SQLiteStore } from "../../mcp/storage/sqlite";
import { RealVectorStore } from "../../mcp/storage/vectors";
import { CapabilityAwareVectorStore } from "../../mcp/storage/lazy-vectors";
import { EmbeddingWorker } from "../../mcp/embedding-queue";
import { RuntimeCapabilityRegistry, setRuntimeCapabilities } from "../../mcp/runtime-capabilities";
import { EMBEDDING_QUEUE_BACKFILL_CAP } from "../../mcp/utils/constants";
import { logger } from "../../mcp/utils/logger";

export const db = await SQLiteStore.create();
export const mcpClient = new MCPClient();
const realVectors = new RealVectorStore(db);
export const runtimeCapabilities = new RuntimeCapabilityRegistry();
setRuntimeCapabilities(runtimeCapabilities);
export const vectors = new CapabilityAwareVectorStore(realVectors, runtimeCapabilities);
// Embedding/KG outbox worker (TASK-013): the dashboard shares the SQLite
// queue_jobs table with the MCP server — atomic claims serialize work across
// processes. Started by dashboard/server.ts.
//
// Backfill ownership (TASK-457-F4): the dashboard worker backfills with the
// SAME env-tunable cap as the MCP server (EMBEDDING_QUEUE_BACKFILL_CAP,
// default 2000), so a dashboard-only deployment (no MCP server process) still
// backfills missing/stale vectors at boot — the pre-fix backfillCap=0 silently
// disabled the recovery path for pre-existing entities in standalone mode.
// Chunked backfill (≤200-row immediate txns, enqueue.ts — TASK-457) bounds the
// per-transaction SQLite write-lock hold to milliseconds, so the old
// single-owner rationale (the big BEGIN IMMEDIATE txn starving sibling
// writers past busy_timeout) no longer applies. When BOTH processes run,
// concurrent backfills are idempotent (INSERT ... ON CONFLICT DO NOTHING) and
// the queue-depth gate (EMBEDDING_QUEUE_BACKFILL_MIN_QUEUE) prevents a deep
// backlog being double-refilled. Set EMBEDDING_QUEUE_BACKFILL_CAP=0 to restore
// single-owner (MCP-server-only) backfill.
export const embeddingWorker = new EmbeddingWorker(db, realVectors, { backfillCap: EMBEDDING_QUEUE_BACKFILL_CAP });
runtimeCapabilities.register("semantic", async () => {
	await realVectors.initialize();
	embeddingWorker.start();
});
runtimeCapabilities.markReady("dashboard");
if (runtimeCapabilities.profile === "full") void runtimeCapabilities.ensure("semantic");
export const startTime = Date.now();
export { logger };
