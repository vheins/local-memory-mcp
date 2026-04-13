import path from "node:path";
import { listResources, listResourceTemplates, readResource } from "./resources/index";
import { SessionContext, findContainingRoot, inferRepoFromSession, isPathWithinRoots } from "./session";
import { logger } from "./utils/logger";
import { getPrompt, listPrompts } from "./prompts/registry";
import { TOOL_DEFINITIONS } from "./tools/schemas";
import { complete, type CompletionRequest } from "./completion";
import { SQLiteStore } from "./storage/sqlite";
import { VectorStore } from "./types";
import { handleMemoryStore } from "./tools/memory.store";
import { handleMemoryUpdate } from "./tools/memory.update";
import { handleMemorySearch } from "./tools/memory.search";
import { handleMemorySummarize } from "./tools/memory.summarize";
import { handleMemorySynthesize } from "./tools/memory.synthesize";
import { handleMemoryDelete } from "./tools/memory.delete";
import { handleMemoryRecap } from "./tools/memory.recap";
import { handleMemoryAcknowledge } from "./tools/memory.acknowledge";
import { handleMemoryDetail } from "./tools/memory.detail";
import {
	handleTaskList,
	handleTaskCreate,
	handleTaskCreateInteractive,
	handleTaskUpdate,
	handleTaskDelete
} from "./tools/task.manage";
import { handleTaskGet as handleTaskDetail } from "./tools/task.get";
import { SamplingRequestHandler } from "./sampling";
import { ElicitationRequestHandler } from "./elicitation";
import { getLogLevel, LOG_LEVEL_VALUES, setLogLevel } from "./utils/logger";
import { decodeCursor, encodeCursor } from "./utils/pagination";

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
				return getPrompt(params?.name as string, (params?.arguments as Record<string, string>) || {}, db, getSessionContext?.());
			}

			case "completion/complete":
				return complete(params as CompletionRequest, db, getSessionContext?.());

			default:
				throw new Error(`Unsupported method: ${method}`);
		}
	}

	// Tools that mutate the DB — must run under write lock
	const WRITE_TOOLS = new Set([
		"memory-store",
		"memory-acknowledge",
		"memory-update",
		"memory-delete",
		"memory-bulk-delete",
		"memory-summarize",
		"task-create",
		"task-create-interactive",
		"task-update",
		"task-delete",
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

		const executeToolLogic = async () => {
			switch (toolName) {
				case "memory-store":
					return await handleMemoryStore(args, db, vectors);

				case "memory-acknowledge":
					return await handleMemoryAcknowledge(args, db);

				case "memory-update":
					return await handleMemoryUpdate(args, db, vectors);

				case "memory-recap":
					return await handleMemoryRecap(args, db);

				case "memory-search":
					return await handleMemorySearch(args, db, vectors);

				case "memory-summarize":
					return await handleMemorySummarize(args, db);

				case "memory-synthesize":
					return await handleMemorySynthesize(args, db, vectors, {
						session: getSessionContext?.(),
						sampleMessage: options?.sampleMessage,
						elicit: options?.elicit
					});

				case "memory-delete":
				case "memory-bulk-delete": // Fallback for backward compatibility
					return await handleMemoryDelete(args, db, vectors, onProgress);

				case "memory-detail":
					return await handleMemoryDetail(args, db);

				case "task-create":
					return await handleTaskCreate(args, db);

				case "task-create-interactive":
					return await handleTaskCreateInteractive(args, db, {
						session: getSessionContext?.(),
						elicit: options?.elicit
					});

				case "task-update":
					return await handleTaskUpdate(args, db, vectors);

				case "task-delete":
					return await handleTaskDelete(args, db);

				case "task-list":
					return await handleTaskList(args, db);

				case "task-detail":
					return await handleTaskDetail(args, db);

				default:
					throw new Error(`Unknown tool: ${name}`);
			}
		};

		if (isWrite) {
			result = await db.withWrite(executeToolLogic);
		} else {
			result = await executeToolLogic();
		}

		// Log the action (write — use lock only if not already inside a write lock)
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
				db.actions.logAction(actionType, repo, logOptions);
			} else {
				await db.withWrite(() => db.actions.logAction(actionType, repo, logOptions));
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
		if (tool.name === "memory-synthesize" && !session?.supportsSampling) {
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

function normalizeToolArguments(args: unknown, session?: SessionContext): Record<string, unknown> | unknown {
	if (!args || typeof args !== "object") {
		return args;
	}

	const anyArgs = args as Record<string, unknown>;
	const nextArgs: Record<string, unknown> = {
		...anyArgs,
		scope: anyArgs.scope ? { ...(anyArgs.scope as Record<string, unknown>) } : undefined
	};

	validateRootBoundPath(nextArgs.current_file_path, "current_file_path", session);
	validateRootBoundPath(nextArgs.doc_path, "doc_path", session);

	if (!nextArgs.repo) {
		nextArgs.repo = inferRepoFromSession(session);
	}

	const scope = nextArgs.scope as Record<string, unknown> | undefined;
	if (scope && !scope.repo) {
		scope.repo = (nextArgs.repo as string) ?? inferRepoFromSession(session);
	}

	if (typeof nextArgs.current_file_path === "string" && scope) {
		const containingRoot = path.isAbsolute(nextArgs.current_file_path)
			? findContainingRoot(nextArgs.current_file_path, session)
			: null;

		if (containingRoot) {
			const relativePath = path.relative(containingRoot, path.resolve(nextArgs.current_file_path));
			const relativeFolder = path.dirname(relativePath);
			if (relativeFolder && relativeFolder !== "." && !scope.folder) {
				scope.folder = relativeFolder;
			}
		}
	}

	return nextArgs;
}

function validateRootBoundPath(value: unknown, field: string, session?: SessionContext): void {
	if (typeof value !== "string" || !path.isAbsolute(value)) {
		return;
	}

	if (!isPathWithinRoots(value, session)) {
		throw new Error(`${field} must stay within the active MCP roots`);
	}
}

function normalizePageLimit(value: unknown, fallback: number) {
	if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
		return Math.max(1, fallback);
	}

	return Math.min(value, 100);
}
