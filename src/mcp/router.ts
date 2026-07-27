import { listResources, listResourceTemplates, readResource } from "./resources/index";
import { SessionContext } from "./session";
import { logger } from "./utils/logger";
import { getPrompt, listPrompts } from "./prompts/registry";
import { TOOL_DEFINITIONS } from "./tools/tool-definitions";
import { complete, type CompletionRequest } from "./completion";
import { normalizeToolArguments, validateRootBoundPath } from "./utils/normalize-args";
import { SQLiteStore } from "./storage/sqlite";
import { VectorStore } from "./types";
import { handleMemoryWrite } from "./tools/memory.write";
import { handleMemoryRead } from "./tools/memory.read";
import { handleMemoryStore } from "./tools/memory.store";
import { handleMemoryUpdate } from "./tools/memory.update";
import { handleMemorySearch } from "./tools/memory.search";
import { handleMemorySummarize } from "./tools/memory.summarize";
import { handleMemorySynthesize } from "./tools/memory.synthesize";
import { handleMemoryDelete } from "./tools/memory.delete";
import { handleMemoryRecap } from "./tools/memory.recap";
import { handleMemoryAcknowledge } from "./tools/memory.acknowledge";
import { handleMemoryDetail } from "./tools/memory.detail";
import { handleHandoffWrite } from "./tools/handoff.write";
import { handleHandoffRead } from "./tools/handoff.read";
import { handleClaimManage } from "./tools/claim.manage";

import { handleStandardWrite } from "./tools/standard.write";
import { handleStandardRead } from "./tools/standard.read";
import { handleStandardDelete } from "./tools/standard.delete";
import { handleTaskCreate, handleTaskCreateInteractive } from "./tools/task.create";
import { handleTaskWrite } from "./tools/task.write";
import { handleTaskUpdate } from "./tools/task.update";
import { handleTaskDelete } from "./tools/task.delete";
import { handleTaskList } from "./tools/task.list";
import { handleTaskRead } from "./tools/task.read";
import { handleTaskGet as handleTaskDetail } from "./tools/task.get";
import { handleTaskSearch } from "./tools/task.search";
import { SamplingRequestHandler } from "./sampling";
import { ElicitationRequestHandler } from "./elicitation";
import { getLogLevel, LOG_LEVEL_VALUES, setLogLevel } from "./utils/logger";
import { decodeCursor, encodeCursor } from "./utils/pagination";
import { handleCodebaseIndex } from "./tools/codebase.index";
import { handleCodebaseRead } from "./tools/codebase.read";

type RouterOptions = {
	getSessionContext?: () => SessionContext;
	sampleMessage?: SamplingRequestHandler;
	elicit?: ElicitationRequestHandler;
	onResourcesMutated?: (uris: string[]) => void;
};

export function createRouter(
	db: SQLiteStore,
	vectors: VectorStore,
	options?: RouterOptions
): (
	method: string,
	params: Record<string, unknown> | undefined,
	signal?: AbortSignal,
	onProgress?: (progress: number, total?: number) => void
) => Promise<unknown> {
	const getSessionContext = options?.getSessionContext;

	async function handleMethod(
		method: string,
		params: Record<string, unknown> | undefined,
		signal?: AbortSignal,
		onProgress?: (progress: number, total?: number) => void
	): Promise<unknown> {
		const t0 = Date.now();
		try {
			const result = await _dispatch(method, params, signal, onProgress);
			logger.debug(`[Router] ${method}`, { ms: Date.now() - t0 });
			return result;
		} catch (err) {
			logger.error(`[Router] ${method} failed`, { ms: Date.now() - t0, error: String(err) });
			throw err;
		}
	}

	async function _dispatch(
		method: string,
		params: Record<string, unknown> | undefined,
		signal?: AbortSignal,
		onProgress?: (progress: number, total?: number) => void
	): Promise<unknown> {
		switch (method) {
			// ---- tools ----
			case "tools/list":
				return listTools(getSessionContext?.(), params);

			case "tools/call":
				return await handleToolCall(
					params,
					(params as Record<string, unknown>)?.signal as AbortSignal | undefined,
					onProgress
				);

			// ---- resources ----
			case "resources/list":
				return listResources(getSessionContext?.(), params);

			case "resources/templates/list":
				return listResourceTemplates(params);

			case "resources/read": {
				const result = readResource(params?.uri as string, db, getSessionContext?.()) as Record<string, unknown>;
				// Map MCP protocol `contents` to `content` for consistency
				if (result && Array.isArray(result.contents) && !result.content) {
					result.content = result.contents;
				}
				return result;
			}

			// ---- prompts ----
			case "prompts/list":
				return listPrompts(db, getSessionContext?.(), params);

			case "logging/setLevel": {
				const requestedLevel = typeof params?.level === "string" ? params.level : "";
				const previousLevel = getLogLevel();
				const level = setLogLevel(requestedLevel);
				return {
					level,
					supportedLevels: LOG_LEVEL_VALUES,
					previousLevel
				};
			}

			case "prompts/get": {
				return getPrompt(
					params?.name as string,
					(params?.arguments as Record<string, string>) || {},
					db,
					getSessionContext?.()
				);
			}

			case "completion/complete":
				return complete(params as CompletionRequest, db, getSessionContext?.());

			default:
				throw new Error(`Unsupported method: ${method}`);
		}
	}

	// Tools that mutate the DB — must run under write lock
	const WRITE_TOOLS = new Set([
		"memory-write",
		"memory-store",
		"memory-update",
		"memory-acknowledge",
		"memory-delete",
		"memory-bulk-delete",
		"memory-summarize",
		"agent-summarize",
		// Handoff & Claim — new canonical names
		"handoff-write",
		"claim-manage",
		// Backward-compat aliases
		"handoff-create",
		"handoff-update",
		"standard-store",
		"standard-update",
		"standard-write",
		"standard-delete",
		"task-create",
		"task-create-interactive",
		"task-write",
		"task-claim",
		"claim-release",
		"task-update",
		"task-delete",
		"codebase-index",
		"index_repository"
	]);

	async function handleToolCall(
		params: Record<string, unknown> | undefined,
		signal?: AbortSignal,
		onProgress?: (progress: number, total?: number) => void
	): Promise<unknown> {
		const { name } = params || {};
		const args = normalizeToolArguments(params?.arguments, getSessionContext?.()) as Record<string, unknown>;
		// Normalize tool naming: accept both dot (memory.store) and hyphen (memory-store)
		const toolName = String(name).replace(/\./g, "-");

		let result: unknown;
		const repo = (args?.repo as string) || ((args?.scope as Record<string, unknown>)?.repo as string) || "unknown";

		const isWrite = WRITE_TOOLS.has(toolName);

		logger.info(`[Tool] ${toolName}`, { repo, write: isWrite });

		const executeToolLogic = async () => {
			switch (toolName) {
				// New canonical handlers
				case "memory-write":
					return await handleMemoryWrite(args, db, vectors);

				case "memory-read":
					return await handleMemoryRead(args, db, vectors);

				case "memory-delete":
				case "memory-bulk-delete": // Fallback for backward compatibility
					return await handleMemoryDelete(args, db, vectors, onProgress);

				// Backward-compat aliases — old names route to new handlers
				case "memory-store":
				case "memory-update":
				case "memory-acknowledge":
					return await handleMemoryWrite(args, db, vectors);

				case "memory-search":
				case "memory-detail":
				case "memory-recap":
					return await handleMemoryRead(args, db, vectors);

				case "memory-summarize":
				case "agent-summarize":
					return await handleMemorySummarize(args, db);

				case "memory-synthesize":
				case "agent-synthesize":
					return await handleMemorySynthesize(args, db, vectors, {
						session: getSessionContext?.(),
						sampleMessage: options?.sampleMessage,
						elicit: options?.elicit
					});

				// New canonical handlers
				case "handoff-write":
					return await handleHandoffWrite(args, db);

				case "handoff-read":
					return await handleHandoffRead(args, db);

				case "claim-manage":
					return await handleClaimManage(args, db);

				// Backward-compat aliases — old names route to new unified handlers
				case "handoff-create":
				case "handoff-update":
					return await handleHandoffWrite(args, db);

				case "handoff-list":
					return await handleHandoffRead(args, db);

				case "task-claim":
				case "claim-list":
					return await handleClaimManage(args, db);

				case "claim-release":
					return await handleClaimManage({ ...args, release: true }, db);

				// Standards
				case "standard-write":
				case "standard-store":
				case "standard-update":
					return await handleStandardWrite(args, db, vectors);

				case "standard-read":
				case "standard-search":
				case "standard-detail":
					return await handleStandardRead(args, db, vectors);

				case "standard-delete":
					return await handleStandardDelete(args, db, vectors);

				// New canonical handlers
				case "task-write":
				case "task-create":
				case "task-create-interactive":
				case "task-update":
					return await handleTaskWrite(args, db, vectors, {
						session: getSessionContext?.(),
						elicit: options?.elicit
					});

				case "task-read":
					return await handleTaskRead(args, db, vectors);

				case "task-delete":
					return await handleTaskDelete(args, db);

				case "task-list":
				case "task-detail":
				case "task-search":
					return await handleTaskRead(args, db, vectors);

				// Codebase index tools
				case "codebase-index":
				case "index_repository":
					return await handleCodebaseIndex(args, db, vectors);

				// Codebase read tools (unified + backward-compat aliases)
				case "codebase-read":
				case "index_status":
				case "get_architecture":
				case "get_file_symbols":
				case "trace_symbol":
				case "search_symbols":
				case "codebase_search":
					return await handleCodebaseRead(args, db, vectors);

				default:
					throw new Error(`Unknown tool: ${name}`);
			}
		};

		if (isWrite) {
			result = await db.withWrite(executeToolLogic);
		} else {
			result = await executeToolLogic();
		}

		logger.info(`[Tool] ${toolName} result`, { repo, result });
		try {
			const actionType = toolName.split("-")[1] || toolName;
			const res = result as Record<string, unknown> | undefined;
			const sc = res?.structuredData as Record<string, unknown> | undefined;
			const logOptions = {
				query:
					(args?.query as string) ||
					(args?.title as string) ||
					(args?.task_code as string) ||
					(toolName === "memory-recap" ? `Offset: ${args?.offset || 0}` : undefined),
				response: result as Record<string, unknown>,
				memoryId: (args?.id as string) || (args?.memory_id as string) || (sc?.id as string),
				taskId: (args?.id as string) || (args?.task_id as string) || (sc?.id as string),
				resultCount: Array.isArray(sc?.results) ? sc.results.length : (sc?.count as number) || 0
			};

			// action_log write: if already inside withWrite (isWrite), lock is already held
			if (isWrite) {
				db.actions.logAction(actionType, "", repo, logOptions);
			} else {
				await db.withWrite(() => db.actions.logAction(actionType, "", repo, logOptions));
			}
		} catch (e) {
			logger.error("Failed to log action", { toolName, error: String(e) });
		}

		const affectedResources = collectAffectedResourceUris(toolName, args, result);
		if (affectedResources.length > 0) {
			options?.onResourcesMutated?.(affectedResources);
		}

		return result;
	}

	return handleMethod;
}

function listTools(session: SessionContext | undefined, params: Record<string, unknown> | undefined) {
	const tools = getAvailableToolDefinitions(session);
	const limit = normalizePageLimit(params?.limit, tools.length || 1);
	const start = decodeCursor(params?.cursor as string | undefined);

	// Strictly conform to MCP Tool spec: remove internal fields like outputSchema, annotations, title
	const compliantTools = tools.map((tool) => {
		const { name, description, inputSchema } = tool;
		return { name, description, inputSchema };
	});

	const page = compliantTools.slice(start, start + limit);
	const nextCursor = start + limit < tools.length ? encodeCursor(start + limit) : undefined;

	return {
		tools: page,
		nextCursor
	};
}

function getAvailableToolDefinitions(session?: SessionContext) {
	return TOOL_DEFINITIONS.filter((tool) => {
		if ((tool.name === "memory-synthesize" || tool.name === "agent-synthesize") && !session?.supportsSampling) {
			return false;
		}

		if (tool.name === "task-create-interactive" && !session?.supportsElicitationForm) {
			return false;
		}

		return true;
	});
}

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
		((res?.structuredData as Record<string, unknown>)?.id as string);
	if (typeof taskId === "string" && /^[0-9a-f-]{36}$/i.test(taskId) && toolName.startsWith("task-")) {
		uris.add(`task://${taskId}`);
	}

	return [...uris];
}

function normalizePageLimit(value: unknown, fallback: number) {
	if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
		return Math.max(1, fallback);
	}

	return Math.min(value, 100);
}
