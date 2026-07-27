import { McpServer, CallToolResult, fromJsonSchema } from "@modelcontextprotocol/server";
import { SQLiteStore } from "../storage/sqlite";
import { VectorStore } from "../types";
import { SessionContext } from "../session";
import { logger } from "../utils/logger";
import { normalizeToolArguments } from "../utils/normalize-args";
import { SamplingRequestHandler } from "../sampling";
import { ElicitationRequestHandler } from "../elicitation";

// ── Handler imports ──────────────────────────────────────────────────────
import { handleMemoryWrite } from "./memory.write";
import { handleMemorySummarize } from "./memory.summarize";
import { handleMemorySynthesize } from "./memory.synthesize";
import { handleMemoryDelete } from "./memory.delete";
import { handleMemoryRead } from "./memory.read";
import { handleHandoffWrite } from "./handoff.write";
import { handleHandoffRead } from "./handoff.read";
import { handleClaimManage } from "./claim.manage";
import { handleStandardDelete } from "./standard.delete";
import { handleStandardWrite } from "./standard.write";
import { handleStandardRead } from "./standard.read";
import { handleTaskCreate, handleTaskCreateInteractive } from "./task.create";
import { handleTaskUpdate } from "./task.update";
import { handleTaskWrite } from "./task.write";
import { handleTaskDelete } from "./task.delete";
import { handleTaskList } from "./task.list";
import { handleTaskGet as handleTaskDetail } from "./task.get";
import { handleTaskSearch } from "./task.search";
import { handleTaskRead } from "./task.read";
import { handleAgentContext } from "./agent-context";
import { handleCodebaseIndex } from "./codebase.index";
import { handleCodebaseRead } from "./codebase.read";
import { McpResponse } from "../utils/mcp-response";

// ── Tool definitions ────────────────────────────────────────────────────
import { TOOL_DEFINITIONS } from "./tool-definitions";

// ── Types ────────────────────────────────────────────────────────────────

export type RegisterAllOptions = {
	/** Client sampling handler (required for memory-synthesize) */
	sampleMessage?: SamplingRequestHandler;
	/** Client elicitation handler (required for task-create-interactive) */
	elicit?: ElicitationRequestHandler;
	/** Called after write tools with the set of affected resource URIs */
	onResourcesMutated?: (uris: string[]) => void;
};

// ── Tools that mutate the DB — must run under write lock ──────────────────
const WRITE_TOOLS = new Set([
	"memory-write",
	"memory-delete",
	"memory-bulk-delete",
	"memory-summarize",
	"handoff-write",
	"claim-manage",
	"standard-store",
	"standard-update",
	"standard-write",
	"standard-delete",
	"task-create",
	"task-create-interactive",
	"task-write",
	"task-update",
	"task-delete",
	"agent-summarize",
	// Codebase index tools (write)
	"codebase-index",
	"index_repository"
]);

// ── Resource mutation URIs ───────────────────────────────────────────────

function collectAffectedResourceUris(toolName: string, args: Record<string, unknown>, result: unknown): string[] {
	const res = result as Record<string, unknown> | undefined;
	const repo =
		(args?.repo as string) ||
		((args?.scope as Record<string, unknown>)?.repo as string) ||
		((res?.data as Record<string, unknown>)?.repo as string);
	const uris = new Set<string>();

	const touchesMemory =
		toolName.startsWith("memory-") ||
		toolName === "task-write" ||
		toolName === "task-update" ||
		toolName === "task-delete";
	const touchesTasks = toolName.startsWith("task-");

	if (touchesMemory && repo) {
		uris.add(`repository://${encodeURIComponent(repo)}/memories`);
	}

	if (touchesTasks && repo) {
		uris.add(`repository://${encodeURIComponent(repo)}/tasks`);
	}

	if (repo) {
		uris.add("repository://index");
	}

	const memoryId =
		(args?.id as string) || (args?.memory_id as string) || ((res?.data as Record<string, unknown>)?.id as string);
	if (typeof memoryId === "string" && /^[0-9a-f-]{36}$/i.test(memoryId) && toolName.startsWith("memory-")) {
		uris.add(`memory://${memoryId}`);
	}

	const taskId =
		(args?.id as string) ||
		(args?.task_id as string) ||
		(((res as Record<string, unknown>)?.structuredData as Record<string, unknown>)?.id as string);
	if (typeof taskId === "string" && /^[0-9a-f-]{36}$/i.test(taskId) && toolName.startsWith("task-")) {
		uris.add(`task://${taskId}`);
	}

	return [...uris];
}

// ── Action logging ───────────────────────────────────────────────────────

function logToolAction(
	toolName: string,
	args: Record<string, unknown>,
	result: unknown,
	db: SQLiteStore,
	isWrite: boolean
): void {
	try {
		const actionType = toolName.split("-")[1] || toolName;
		const res = result as Record<string, unknown> | undefined;
		const sc = (res as Record<string, unknown>)?.structuredData as Record<string, unknown> | undefined;
		const repo = (args?.repo as string) || ((args?.scope as Record<string, unknown>)?.repo as string) || "unknown";

		const logOptions: {
			query?: string;
			response?: Record<string, unknown>;
			memoryId?: string;
			taskId?: string;
			resultCount?: number;
		} = {
			query:
				(args?.query as string) ||
				(args?.title as string) ||
				(args?.task_code as string) ||
				(toolName === "memory-recap" ? `Offset: ${args?.offset || 0}` : undefined),
			response: res,
			memoryId: (args?.id as string) || (args?.memory_id as string) || (sc?.id as string),
			taskId: (args?.id as string) || (args?.task_id as string) || (sc?.id as string),
			resultCount: Array.isArray(sc?.results) ? sc.results.length : (sc?.count as number) || 0
		};

		if (isWrite) {
			db.actions.logAction(actionType, "", repo, logOptions);
		} else {
			void db.withWrite(() => {
				db.actions.logAction(actionType, "", repo, logOptions);
			});
		}
	} catch (e) {
		logger.error("Failed to log action", { toolName, error: String(e) });
	}
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

type ExecutorExtra = {
	onProgress?: (progress: number, total?: number) => void;
	signal?: AbortSignal;
};

// ── Tool executor dispatch ───────────────────────────────────────────────

function buildExecutors(
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
		// Backward-compat aliases — old names route to new handlers
		"memory-store": (args, db, vectors, _extra) => handleMemoryWrite(args, db, vectors),
		"memory-update": (args, db, vectors, _extra) => handleMemoryWrite(args, db, vectors),
		"memory-acknowledge": (args, db, vectors, _extra) => handleMemoryWrite(args, db, vectors),
		"memory-search": (args, db, vectors, _extra) => handleMemoryRead(args, db, vectors),
		"memory-detail": (args, db, vectors, _extra) => handleMemoryRead(args, db, vectors),
		"memory-recap": (args, db, vectors, _extra) => handleMemoryRead(args, db, vectors),
		// Other memory tools
		"memory-summarize": (args, db, _vectors, _extra) => handleMemorySummarize(args, db),
		"memory-synthesize": (args, db, vectors, _extra) =>
			handleMemorySynthesize(args, db, vectors, {
				session,
				sampleMessage,
				elicit
			}),
		// New canonical handlers
		"handoff-write": (args, db, _vectors, _extra) => handleHandoffWrite(args, db),
		"handoff-read": (args, db, _vectors, _extra) => handleHandoffRead(args, db),
		"claim-manage": (args, db, _vectors, _extra) => handleClaimManage(args, db),
		// Backward-compat aliases — old names route to new unified handlers
		"handoff-create": (args, db, _vectors, _extra) => handleHandoffWrite(args, db),
		"handoff-update": (args, db, _vectors, _extra) => handleHandoffWrite(args, db),
		"handoff-list": (args, db, _vectors, _extra) => handleHandoffRead(args, db),
		"task-claim": (args, db, _vectors, _extra) => handleClaimManage(args, db),
		"claim-list": (args, db, _vectors, _extra) => handleClaimManage(args, db),
		"claim-release": (args, db, _vectors, _extra) =>
			handleClaimManage({ ...args, release: true } as Record<string, unknown>, db),
		"standard-write": (args, db, vectors, _extra) => handleStandardWrite(args, db, vectors),
		"standard-read": (args, db, vectors, _extra) => handleStandardRead(args, db, vectors),
		"standard-delete": (args, db, vectors, _extra) => handleStandardDelete(args, db, vectors),
		// Backward-compat aliases — old names route to new unified handlers
		"standard-store": (args, db, vectors, _extra) => handleStandardWrite(args, db, vectors),
		"standard-update": (args, db, vectors, _extra) => handleStandardWrite(args, db, vectors),
		"standard-search": (args, db, vectors, _extra) => handleStandardRead(args, db, vectors),
		"standard-detail": (args, db, vectors, _extra) => handleStandardRead(args, db, vectors),
		// New canonical handlers
		"task-write": (args, db, vectors, _extra) =>
			handleTaskWrite(args, db, vectors, { session, elicit: options?.elicit }),
		"task-read": (args, db, vectors, _extra) => handleTaskRead(args, db, vectors),
		"task-delete": (args, db, _vectors, _extra) => handleTaskDelete(args, db),
		// Backward-compat aliases — old names route to new unified handlers
		"task-create": (args, db, vectors, _extra) =>
			handleTaskWrite(args, db, vectors, { session, elicit: options?.elicit }),
		"task-create-interactive": (args, db, vectors, _extra) =>
			handleTaskWrite(args, db, vectors, { session, elicit: options?.elicit }),
		"task-update": (args, db, vectors, _extra) =>
			handleTaskWrite(args, db, vectors, { session, elicit: options?.elicit }),
		"task-list": (args, db, vectors, _extra) => handleTaskRead(args, db, vectors),
		"task-detail": (args, db, vectors, _extra) => handleTaskRead(args, db, vectors),
		"task-search": (args, db, vectors, _extra) => handleTaskRead(args, db, vectors),
		"agent-context": (args, db, vectors, _extra) => handleAgentContext(args, db, vectors),
		"agent-synthesize": (args, db, vectors, _extra) =>
			handleMemorySynthesize(args, db, vectors, {
				session,
				sampleMessage,
				elicit
			}),
		"agent-summarize": (args, db, _vectors, _extra) => handleMemorySummarize(args, db),
		// Codebase index tools
		"codebase-read": (args, db, _vectors, _extra) => handleCodebaseRead(args, db, _vectors),
		// Write tool — canonical name
		"codebase-index": (args, db, _vectors, _extra) => handleCodebaseIndex(args, db, _vectors),
		// Backward-compat alias — routes to the same handler
		index_repository: (args, db, _vectors, _extra) => handleCodebaseIndex(args, db, _vectors),
		// Backward-compat read aliases — all route through codebase-read
		index_status: (args, db, _vectors, _extra) => handleCodebaseRead(args, db, _vectors),
		get_architecture: (args, db, _vectors, _extra) => handleCodebaseRead(args, db, _vectors),
		get_file_symbols: (args, db, _vectors, _extra) => handleCodebaseRead(args, db, _vectors),
		trace_symbol: (args, db, _vectors, _extra) => handleCodebaseRead(args, db, _vectors),
		search_symbols: (args, db, _vectors, _extra) => handleCodebaseRead(args, db, _vectors),
		codebase_search: (args, db, _vectors, _extra) => handleCodebaseRead(args, db, _vectors)
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
		if ((def.name === "memory-synthesize" || def.name === "agent-synthesize") && !session.supportsSampling) {
			return false;
		}
		if (def.name === "task-create-interactive" && !session.supportsElicitationForm) {
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
				logToolAction(toolName, normalizedArgs, result, store, isWrite);

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
