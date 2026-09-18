import type { McpServerFactory } from "@modelcontextprotocol/server";
import { createMcpServer } from "../mcp-server";
import { updateSessionFromInitialize } from "../session";
import type { SQLiteStore } from "../storage/sqlite";
import type { VectorStore } from "../types";
import { logger } from "../utils/logger";

/**
 * Build an SDK {@link McpServerFactory} that constructs one fully-wired
 * {@link McpServer} (plus its per-connection {@link SessionContext}) per
 * serving unit — one stdio connection, or one HTTP request/session — over the
 * shared store and vectors.
 *
 * The factory is transport-agnostic and used by BOTH the stdio entry and the
 * Streamable HTTP transport, so the tool surface and the initialize-handshake
 * capture (client name/version/capabilities into the session context) can
 * never drift between the two transports.
 *
 * @param store - The process-wide SQLiteStore shared by every session.
 * @param vectors - The process-wide vector store shared by every session.
 * @returns A zero-argument factory assignable to the SDK's McpServerFactory.
 */
export function createServerFactory(store: SQLiteStore, vectors: VectorStore): McpServerFactory {
	return () => {
		const { server, ctx } = createMcpServer(store, vectors);

		// Wire oninitialized to capture client info from the initialize handshake
		// (mirrors the historical stdio wiring in server.ts).
		server.server.oninitialized = () => {
			try {
				const clientVer = server.server.getClientVersion();
				if (clientVer) {
					ctx.clientName = clientVer.name;
					ctx.clientVersion = clientVer.version;
					ctx.lastSeenAgent = clientVer.name;
				}
				ctx.lastSeenModel ??= process.env.MCP_MODEL;
				ctx.lastSeenAgent ??= process.env.MCP_CLIENT_NAME;

				updateSessionFromInitialize(ctx, {
					clientInfo: clientVer,
					capabilities: server.server.getClientCapabilities()
				} as Record<string, unknown>);
			} catch (error) {
				// Non-fatal — just logging
				logger.warn("[session] Failed to capture client info", { error: String(error) });
			}
		};

		return server;
	};
}
