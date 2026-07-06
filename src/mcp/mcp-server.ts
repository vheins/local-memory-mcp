import { McpServer } from "@modelcontextprotocol/server";
import { loadServerInstructions } from "./prompts/loader";
import { SQLiteStore } from "./storage/sqlite";
import { VectorStore } from "./types";
import { SessionContext, createSessionContext } from "./session";
import { CAPABILITIES } from "./capabilities";
import { registerAllTools } from "./tools/index";
import { registerAllResources } from "./resources/sdk-index";
import { registerAllPrompts } from "./prompts/sdk-index";
import { addLogSink } from "./utils/logger";
import { complete } from "./completion";
import type { CompletionRequest } from "./completion";

/**
 * Creates and configures an McpServer instance for the local-memory-mcp service.
 *
 * @param store - SQLiteStore instance for persistence
 * @param vectors - VectorStore instance for semantic search
 * @param session - Optional session context for owner/repo inference
 * @returns A fully configured McpServer instance with all tools registered
 */
export function createMcpServer(store: SQLiteStore, vectors: VectorStore, session?: SessionContext): McpServer {
	const instructions = loadServerInstructions();
	const ctx = session ?? createSessionContext();

	const server = new McpServer(
		{
			name: "local-memory-mcp",
			version: CAPABILITIES.serverInfo.version
		},
		{
			instructions,
			capabilities: CAPABILITIES.capabilities
		}
	);

	// Register all 27 tools via SDK registerTool()
	registerAllTools(server, store, vectors, ctx);

	// Register all resources and resource templates via SDK registerResource()
	registerAllResources(server, store, vectors, ctx);

	// Register all prompts via SDK registerPrompt()
	registerAllPrompts(server, store, vectors, ctx);

	// ── Wire logger to MCP client logging notifications ────────────────
	// Forward log sink payloads to connected clients via the SDK's
	// sendLoggingMessage(). The logging/setLevel handler is built into the
	// SDK and automatically filters messages based on client preference.
	const _removeLogSink = addLogSink((payload) => {
		void server
			.sendLoggingMessage({
				level: payload.level,
				data: payload.data,
				logger: payload.logger
			})
			.catch(() => {
				// Best-effort: if the client disconnected, ignore EPIPE errors.
			});
	});

	// ── Wire completion handler ────────────────────────────────────────
	// Prompt arguments are documented as text (no zod argsSchema due to
	// v3/v4 incompatibility), so the SDK cannot use completable() for
	// prompt completions. Register a handler for completion/complete
	// that delegates to the existing completion logic which handles
	// both prompt and resource argument completions.
	server.server.setRequestHandler("completion/complete", async (request, _serverCtx) => {
		const params = request.params;
		const completionResult = await complete(
			{
				ref: {
					type: params.ref.type,
					name: (params.ref as { name?: string }).name,
					uri: (params.ref as { uri?: string }).uri
				},
				argument: {
					name: params.argument.name,
					value: params.argument.value
				},
				context: {
					arguments: params.context?.arguments as Record<string, unknown> | undefined
				}
			} as CompletionRequest,
			store,
			ctx
		);

		return {
			completion: completionResult.completion
		};
	});

	return server;
}
