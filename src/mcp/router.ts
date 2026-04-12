import path from "node:path";
import { listResources, listResourceTemplates, readResource } from "./resources/index.js";
import { SessionContext, findContainingRoot, inferRepoFromSession, isPathWithinRoots } from "./session.js";
import { logger } from "./utils/logger.js";
import { getPrompt, listPrompts } from "./prompts/registry.js";
import { TOOL_DEFINITIONS } from "./tools/schemas.js";
import { complete } from "./completion.js";
import { SQLiteStore } from "./storage/sqlite.js";
import { VectorStore } from "./types.js";
import { handleMemoryStore } from "./tools/memory.store.js";
import { handleMemoryUpdate } from "./tools/memory.update.js";
import { handleMemorySearch } from "./tools/memory.search.js";
import { handleMemorySummarize } from "./tools/memory.summarize.js";
import { handleMemorySynthesize } from "./tools/memory.synthesize.js";
import { handleMemoryDelete } from "./tools/memory.delete.js";
import { handleMemoryBulkDelete } from "./tools/memory.bulk-delete.js";
import { handleMemoryRecap } from "./tools/memory.recap.js";
import { handleMemoryAcknowledge } from "./tools/memory.acknowledge.js";
import { handleMemoryGet } from "./tools/memory.get.js";
import {
	handleTaskList,
	handleTaskCreate,
	handleTaskCreateInteractive,
	handleTaskUpdate,
	handleTaskDelete
} from "./tools/task.manage.js";
import { handleTaskGet } from "./tools/task.get.js";
import { handleTaskBulkManage } from "./tools/task.bulk-manage.js";
import { SamplingRequestHandler } from "./sampling.js";
import { ElicitationRequestHandler } from "./elicitation.js";
import { getLogLevel, LOG_LEVEL_VALUES, setLogLevel } from "./utils/logger.js";
import { decodeCursor, encodeCursor } from "./utils/pagination.js";

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
				return await handleToolCall(params, (params as Record<string, unknown>)?.signal as AbortSignal | undefined, onProgress);

			// ---- resources ----
			case "resources/list":
				return listResources(getSessionContext?.(), params);

			case "resources/templates/list":
				return listResourceTemplates(params);

			case "resources/read":
				return readResource(params?.uri, db, getSessionContext?.());

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
				return getPrompt(params?.name, params?.arguments || {}, db, getSessionContext?.());
			}

			case "completion/complete":
				return complete(params, db, getSessionContext?.());

			default:
				throw new Error(`Unsupported method: ${method}`);
		}
	}

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
		const repo = (args?.repo as string) || (args?.scope as Record<string, unknown>)?.repo as string || "unknown";

		switch (toolName) {
			case "memory-store":
				result = await handleMemoryStore(args, db, vectors);
				break;

			case "memory-acknowledge":
				result = await handleMemoryAcknowledge(args, db);
				break;

			case "memory-update":
				result = await handleMemoryUpdate(args, db, vectors);
				break;

			case "memory-recap":
				result = await handleMemoryRecap(args, db);
				break;

			case "memory-search":
				result = await handleMemorySearch(args, db, vectors);
				break;

			case "memory-summarize":
				result = await handleMemorySummarize(args, db);
				break;

			case "memory-synthesize":
				result = await handleMemorySynthesize(args, db, vectors, {
					session: getSessionContext?.(),
					sampleMessage: options?.sampleMessage,
					elicit: options?.elicit
				});
				break;

			case "memory-delete":
				result = await handleMemoryDelete(args, db, vectors);
				break;

			case "memory-bulk-delete":
				result = await handleMemoryBulkDelete(args, db, vectors, onProgress);
				break;

			case "memory-detail":
				result = await handleMemoryGet(args, db);
				break;

			case "task-create":
				result = await handleTaskCreate(args, db);
				break;

			case "task-create-interactive":
				result = await handleTaskCreateInteractive(args, db, {
					session: getSessionContext?.(),
					elicit: options?.elicit
				});
				break;

			case "task-update":
				result = await handleTaskUpdate(args, db, vectors);
				break;

			case "task-delete":
				result = await handleTaskDelete(args, db);
				break;

			case "task-list":
				result = await handleTaskList(args, db);
				break;

			case "task-detail":
				result = await handleTaskGet(args, db);
				break;

			case "task-bulk-manage":
				result = await handleTaskBulkManage(args, db, vectors, onProgress);
				break;

			default:
				throw new Error(`Unknown tool: ${name}`);
		}

		// Log the action
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
				response: result,
				memoryId: (args?.id as string) || (args?.memory_id as string) || (sc?.id as string),
				taskId: (args?.id as string) || (args?.task_id as string) || (sc?.id as string),
				resultCount: Array.isArray(sc?.results) ? sc.results.length : (sc?.count as number) || 0
			};

			db.actions.logAction(actionType, repo, logOptions);
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

function collectAffectedResourceUris(toolName: string, args: any, result: unknown): string[] {
	const res = result as Record<string, any> | undefined;
	const repo = (args?.repo as string) || (args?.scope as any)?.repo || res?.data?.repo;
	const uris = new Set<string>();

	const touchesMemory =
		toolName.startsWith("memory-") ||
		toolName === "task-update" ||
		toolName === "task-bulk-manage" ||
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

	const memoryId = (args?.id as string) || (args?.memory_id as string) || res?.data?.id;
	if (typeof memoryId === "string" && /^[0-9a-f-]{36}$/i.test(memoryId) && toolName.startsWith("memory-")) {
		uris.add(`memory://${memoryId}`);
	}

	const taskId = (args?.id as string) || (args?.task_id as string) || res?.structuredData?.id;
	if (typeof taskId === "string" && /^[0-9a-f-]{36}$/i.test(taskId) && toolName.startsWith("task-")) {
		uris.add(`task://${taskId}`);
	}

	return [...uris];
}

function normalizeToolArguments(args: unknown, session?: SessionContext): any {
	if (!args || typeof args !== "object") {
		return args;
	}

	const anyArgs = args as Record<string, any>;
	const nextArgs = {
		...anyArgs,
		scope: anyArgs.scope ? { ...anyArgs.scope } : undefined
	};

	validateRootBoundPath(nextArgs.current_file_path, "current_file_path", session);
	validateRootBoundPath(nextArgs.doc_path, "doc_path", session);

	if (!nextArgs.repo) {
		nextArgs.repo = inferRepoFromSession(session);
	}

	if (nextArgs.scope && !nextArgs.scope.repo) {
		nextArgs.scope.repo = nextArgs.repo ?? inferRepoFromSession(session);
	}

	if (typeof nextArgs.current_file_path === "string" && nextArgs.scope) {
		const containingRoot = path.isAbsolute(nextArgs.current_file_path)
			? findContainingRoot(nextArgs.current_file_path, session)
			: null;

		if (containingRoot) {
			const relativePath = path.relative(containingRoot, path.resolve(nextArgs.current_file_path));
			const relativeFolder = path.dirname(relativePath);
			if (relativeFolder && relativeFolder !== "." && !nextArgs.scope.folder) {
				nextArgs.scope.folder = relativeFolder;
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
