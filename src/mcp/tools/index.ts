import { McpServer, CallToolResult, fromJsonSchema } from "@modelcontextprotocol/server";
import { SQLiteStore } from "../storage/sqlite";
import { VectorStore } from "../types";
import { SessionContext } from "../session";
import { logger } from "../utils/logger";
import { normalizeToolArguments } from "../utils/normalize-args";
import { SamplingRequestHandler } from "../sampling";
import { ElicitationRequestHandler } from "../elicitation";

// ── Handler imports ──────────────────────────────────────────────────────
import { handleMemoryWrite } from "./memory-write";
import { handleMemorySummarize } from "./memory.summarize";
import { handleMemorySynthesize } from "./memory.synthesize";
import { handleMemoryDelete } from "./memory.delete";
import { handleMemoryRead } from "./memory.read";
import { handleHandoffWrite } from "./handoff.write";
import { handleHandoffRead } from "./handoff.read";
import { handleClaimManage } from "./claim.manage";
import { handleStandardDelete } from "./standard.delete";
import { handleStandardWrite } from "./standard-write";
import { handleStandardRead } from "./standard-read";
import { handleTaskWrite } from "./task-write";
import { handleTaskDelete } from "./task.delete";
import { handleTaskRead } from "./task-read";
import { handleAgentContext } from "./agent-context";
import { handleCodebaseIndex } from "./codebase-index-sdk";
import { handleCodebaseRead } from "./codebase.read";
import { McpResponse } from "../utils/mcp-response";
import { logAction } from "../utils/action-log";
import { collectAffectedResourceUris, WRITE_TOOLS } from "../utils/tool-plumbing";

// ── Tool definitions ────────────────────────────────────────────────────
import { TOOL_DEFINITIONS } from "./tool-definitions";

// ── Types ────────────────────────────────────────────────────────────────

export type RegisterAllOptions = {
	/** Client sampling handler (required for memory-synthesize) */
	sampleMessage?: SamplingRequestHandler;
	/** Client elicitation handler (required for interactive task creation via task-write) */
	elicit?: ElicitationRequestHandler;
	/** Called after write tools with the set of affected resource URIs */
	onResourcesMutated?: (uris: string[]) => void;
};

// ── Write-lock + resource-mutation plumbing ──────────────────────────────
// WRITE_TOOLS and collectAffectedResourceUris live in utils/tool-plumbing.ts
// (shared with the router.ts adapter) — single source of truth.

// ── Action logging ───────────────────────────────────────────────────────

function logToolAction(toolName: string, args: Record<string, unknown>, result: unknown, db: SQLiteStore): void {
	const actionType = toolName.split("-")[1] || toolName;
	const res = result as Record<string, unknown> | undefined;
	const sc = (res as Record<string, unknown>)?.structuredData as Record<string, unknown> | undefined;
	const repo = (args?.repo as string) || ((args?.scope as Record<string, unknown>)?.repo as string) || "unknown";

	// Unified policy (ActionLogService): action_log INSERTs never take the file
	// lock — WAL + busy_timeout serialize single-row inserts. Exactly one row
	// per tool call, read AND write tools alike.
	logAction(db, actionType, "", repo, {
		query: (args?.query as string) || (args?.title as string) || (args?.task_code as string) || undefined,
		response: res,
		memoryId: (args?.id as string) || (args?.memory_id as string) || (sc?.id as string),
		taskId: (args?.id as string) || (args?.task_id as string) || (sc?.id as string),
		resultCount: Array.isArray(sc?.results) ? sc.results.length : (sc?.count as number) || 0
	});
}

// ── Response conversion (McpResponse → CallToolResult) ──────────────────

function toCallToolResult(response: McpResponse): CallToolResult {
	const content = Array.isArray(response.content)
		? response.content.map((item) => {
				if (item.type === "image") {
					return { type: "image" as const, data: item.data, mimeType: item.mimeType };
				}
				if (item.type === "resource") {
					return {
						type: "text" as const,
						text: item.resource.text ?? JSON.stringify(item.resource)
					};
				}
				return { type: "text" as const, text: (item as { text?: string }).text ?? "" };
			})
		: [];
	return {
		content,
		isError: response.isError ?? false,
		...(response.structuredContent !== undefined ? { structuredContent: response.structuredContent } : {})
	};
}

// ── Executor extra context (progress / cancellation) ────────────────────

export type ExecutorExtra = {
	onProgress?: (progress: number, total?: number) => void;
	signal?: AbortSignal;
};

// ── Tool executor dispatch ───────────────────────────────────────────────

export function buildExecutors(
	session: SessionContext,
	options?: RegisterAllOptions
): Record<
	string,
	(args: Record<string, unknown>, db: SQLiteStore, vectors: VectorStore, extra?: ExecutorExtra) => Promise<McpResponse>
> {
	const sampleMessage = options?.sampleMessage;
	const elicit = options?.elicit;

	return {
		// New canonical handlers
		"memory-write": (args, db, vectors, _extra) => handleMemoryWrite(args, db, vectors),
		"memory-read": (args, db, vectors, _extra) => handleMemoryRead(args, db, vectors),
		"memory-delete": (args, db, vectors, extra) => handleMemoryDelete(args, db, vectors, extra?.onProgress),
		// New canonical names per ADR-001
		synthesize: (args, db, vectors, _extra) =>
			handleMemorySynthesize(args, db, vectors, {
				session,
				sampleMessage,
				elicit
			}),
		"repo-summarize": (args, db, _vectors, _extra) => handleMemorySummarize(args, db),
		// New canonical handlers
		"handoff-write": (args, db, _vectors, _extra) => handleHandoffWrite(args, db),
		"handoff-read": (args, db, _vectors, _extra) => handleHandoffRead(args, db),
		"claim-manage": (args, db, _vectors, _extra) => handleClaimManage(args, db),
		// New canonical handlers
		"standard-write": (args, db, vectors, _extra) => handleStandardWrite(args, db, vectors),
		"standard-read": (args, db, vectors, _extra) => handleStandardRead(args, db, vectors),
		"standard-delete": (args, db, vectors, _extra) => handleStandardDelete(args, db, vectors),
		// New canonical handlers
		"task-write": (args, db, vectors, _extra) =>
			handleTaskWrite(args, db, vectors, { session, elicit: options?.elicit }),
		"task-read": (args, db, vectors, _extra) => handleTaskRead(args, db, vectors),
		"task-delete": (args, db, _vectors, _extra) => handleTaskDelete(args, db),

		"agent-context": (args, db, vectors, _extra) => handleAgentContext(args, db, vectors),
		// Codebase index tools — only 2 canonical names
		"codebase-index": (args, db, _vectors, _extra) => handleCodebaseIndex(args, db, _vectors),
		"codebase-read": (args, db, _vectors, _extra) => handleCodebaseRead(args, db, _vectors)
	};
}

// ── Main registration function ───────────────────────────────────────────

export function registerAllTools(
	server: McpServer,
	store: SQLiteStore,
	vectors: VectorStore,
	session: SessionContext,
	options?: RegisterAllOptions
): void {
	const executors = buildExecutors(session, options);

	// Filter tool definitions by client capabilities
	const definitions = TOOL_DEFINITIONS.filter((def) => {
		if (def.name === "synthesize" && !session.supportsSampling) {
			return false;
		}
		return true;
	});

	for (const def of definitions) {
		const toolName = def.name;
		const executor = executors[toolName];

		if (!executor) {
			logger.warn(`[registerAllTools] No executor for tool: ${toolName} — skipping`);
			continue;
		}

		const isWrite = WRITE_TOOLS.has(toolName);

		server.registerTool(
			toolName,
			{
				description: def.description ?? "",
				inputSchema: def.inputSchema ? fromJsonSchema(def.inputSchema as never) : undefined
			},
			async (args, extra) => {
				const rawArgs = (args ?? {}) as Record<string, unknown>;
				const normalizedArgs = normalizeToolArguments(rawArgs, session) as Record<string, unknown>;

				logger.info(`[Tool] ${toolName}`, {
					repo: (normalizedArgs?.repo as string) || "unknown",
					write: isWrite
				});

				// Build progress callback from the SDK's ServerContext
				const progressToken = extra?.mcpReq?._meta?.progressToken;
				const executorExtra: ExecutorExtra = {
					onProgress:
						progressToken !== undefined
							? (progress: number, total?: number) => {
									void extra.mcpReq
										.notify({
											method: "notifications/progress",
											params: { progressToken, progress, total }
										})
										.catch(() => {});
								}
							: undefined,
					signal: extra?.mcpReq?.signal
				};

				// Execute tool logic under write lock if needed
				const executeFn = () => executor(normalizedArgs, store, vectors, executorExtra);

				let result: McpResponse;
				try {
					if (isWrite) {
						result = await store.withWrite(executeFn);
					} else {
						result = await executeFn();
					}
				} catch (err) {
					logger.error(`[Tool] ${toolName} failed`, { error: String(err) });
					return {
						content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
						isError: true
					};
				}

				logger.info(`[Tool] ${toolName} result`, {
					repo: (normalizedArgs?.repo as string) || "unknown"
				});

				// Action logging
				logToolAction(toolName, normalizedArgs, result, store);

				// Resource mutation notifications
				const affectedUris = collectAffectedResourceUris(toolName, normalizedArgs, result);
				if (affectedUris.length > 0) {
					options?.onResourcesMutated?.(affectedUris);
				}

				return toCallToolResult(result);
			}
		);

		logger.debug(`[registerAllTools] Registered tool: ${toolName}`);
	}
}
