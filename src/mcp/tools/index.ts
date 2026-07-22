import path from "node:path";
import { McpServer, CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { SQLiteStore } from "../storage/sqlite";
import { VectorStore } from "../types";
import {
	SessionContext,
	findContainingRoot,
	inferOwnerFromSession,
	inferRepoFromSession,
	isPathWithinRoots
} from "../session";
import { logger } from "../utils/logger";
import { parseRepoInput } from "../utils/normalize";
import { SamplingRequestHandler } from "../sampling";
import { ElicitationRequestHandler } from "../elicitation";

// ── Handler imports ──────────────────────────────────────────────────────
import { handleMemoryStore } from "./memory.store";
import { handleMemoryUpdate } from "./memory.update";
import { handleMemorySearch } from "./memory.search";
import { handleMemoryAcknowledge } from "./memory.acknowledge";
import { handleMemorySummarize } from "./memory.summarize";
import { handleMemorySynthesize } from "./memory.synthesize";
import { handleMemoryRecap } from "./memory.recap";
import { handleMemoryDelete } from "./memory.delete";
import { handleMemoryDetail } from "./memory.detail";
import {
	handleClaimList,
	handleClaimRelease,
	handleHandoffCreate,
	handleHandoffList,
	handleHandoffUpdate,
	handleTaskClaim
} from "./handoff.manage";
import { handleStandardStore } from "./standard.store";
import { handleStandardSearch } from "./standard.search";
import { handleStandardUpdate } from "./standard.update";
import { handleStandardDetail } from "./standard.detail";
import { handleStandardDelete } from "./standard.delete";
import { handleTaskCreate, handleTaskCreateInteractive } from "./task.create";
import { handleTaskUpdate } from "./task.update";
import { handleTaskDelete } from "./task.delete";
import { handleTaskList } from "./task.list";
import { handleTaskGet as handleTaskDetail } from "./task.get";
import { handleTaskSearch } from "./task.search";
import { handleAgentContext } from "./agent-context";
import { handleDecisionLog } from "./decision-log";
import { handleSessionSummarize } from "./session-summarize";
import {
	handleCreateEntity,
	handleDeleteEntity,
	handleCreateRelation,
	handleDeleteRelation,
	handleDeleteObservation
} from "./kg.crud";
import { handleKGBackfill } from "./kg-backfill";
import { handleCodebaseIndexRepository, handleCodebaseIndexStatus } from "./codebase-index";
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
	"memory-store",
	"memory-acknowledge",
	"memory-update",
	"memory-delete",
	"memory-bulk-delete",
	"memory-summarize",
	"handoff-create",
	"handoff-update",
	"standard-store",
	"standard-update",
	"standard-delete",
	"task-create",
	"task-create-interactive",
	"task-claim",
	"claim-release",
	"task-update",
	"task-delete",
	"decision-log",
	"session-summarize",
	// Upstream alias tools (write)
	"remember_fact",
	"remember_facts",
	"forget",
	// Knowledge graph tools (write)
	"create_entity",
	"delete_entity",
	"create_relation",
	"delete_relation",
	"delete_observation",
	"kg-backfill",
	// Codebase index tools (write)
	"index_repository"
]);

// ── Session / argument middleware ─────────────────────────────────────────

function validateRootBoundPath(value: unknown, field: string, session?: SessionContext): void {
	if (typeof value !== "string" || !path.isAbsolute(value)) {
		return;
	}
	if (!isPathWithinRoots(value, session)) {
		throw new Error(`${field} must stay within the active MCP roots`);
	}
}

/**
 * Injects owner/repo from session context when not provided in args.
 * Extracted from router.ts normalizeToolArguments().
 */
function normalizeToolArgs(args: Record<string, unknown>, session: SessionContext): Record<string, unknown> {
	const anyArgs = args as Record<string, unknown>;
	const scopeVal = anyArgs.scope;
	const nextArgs: Record<string, unknown> = {
		...anyArgs,
		// Handle string scope gracefully: "my-repo" → { repo: "my-repo" }
		scope:
			typeof scopeVal === "string"
				? { repo: scopeVal }
				: scopeVal
					? { ...(scopeVal as Record<string, unknown>) }
					: undefined
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

	if (!nextArgs.owner) {
		const repoVal = (nextArgs.repo as string) || "";
		const parsed = parseRepoInput(repoVal, undefined);
		const inferredOwner = parsed.owner || inferOwnerFromSession(session);
		if (inferredOwner !== undefined) {
			nextArgs.owner = inferredOwner;
			if (!repoVal.includes("/")) {
				logger.warn(
					`[tools] owner inferred from session (${nextArgs.owner}) — may be incorrect. Agents should pass explicit owner/repo.`
				);
			}
		}
	}

	if (scope && !scope.owner) {
		const repoVal = (scope.repo as string) || (nextArgs.repo as string) || "";
		const parsed = parseRepoInput(repoVal, undefined);
		const inferredOwner = parsed.owner || (nextArgs.owner as string) || inferOwnerFromSession(session);
		if (inferredOwner !== undefined) {
			scope.owner = inferredOwner;
		}
	}

	const ownerVal = (nextArgs.owner as string) || inferOwnerFromSession(session) || undefined;
	const repoVal = (nextArgs.repo as string) || inferRepoFromSession(session) || undefined;
	const memories = nextArgs.memories as Array<Record<string, unknown>> | undefined;
	if (memories) {
		for (const mem of memories) {
			const memScope = mem.scope as Record<string, unknown> | undefined;
			if (memScope) {
				if (!memScope.owner) {
					const inferredMemOwner =
						ownerVal || parseRepoInput((memScope.repo as string) || repoVal || "", undefined).owner;
					if (inferredMemOwner) memScope.owner = inferredMemOwner;
				}
				if (!memScope.repo && repoVal) memScope.repo = repoVal;
			}
		}
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

// ── Resource mutation URIs ───────────────────────────────────────────────

function collectAffectedResourceUris(toolName: string, args: Record<string, unknown>, result: unknown): string[] {
	const res = result as Record<string, unknown> | undefined;
	const repo =
		(args?.repo as string) ||
		((args?.scope as Record<string, unknown>)?.repo as string) ||
		((res?.data as Record<string, unknown>)?.repo as string);
	const uris = new Set<string>();

	const touchesMemory = toolName.startsWith("memory-") || toolName === "task-update" || toolName === "task-delete";
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

// ── Public input schema for registerTool ─────────────────────────────────
// Uses a minimal schema that accepts any input. The handlers validate
// internally with their own Zod schemas (which include refinements and
// normalized transformations).
//
// NOTE: z.any() produces JSON Schema `{}` (any value), preventing MCP
// clients from stripping parameters that aren't explicitly listed.
// Individual tool handlers are responsible for validating their own params.

function makePublicSchema(): z.ZodSchema {
	return z.any();
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
		"memory-store": (args, db, vectors, _extra) => handleMemoryStore(args, db, vectors),
		"memory-acknowledge": (args, db, _vectors, _extra) => handleMemoryAcknowledge(args, db),
		"memory-update": (args, db, vectors, _extra) => handleMemoryUpdate(args, db, vectors),
		"memory-recap": (args, db, _vectors, _extra) => handleMemoryRecap(args, db),
		"memory-search": (args, db, vectors, _extra) => handleMemorySearch(args, db, vectors),
		"memory-summarize": (args, db, _vectors, _extra) => handleMemorySummarize(args, db),
		"memory-synthesize": (args, db, vectors, _extra) =>
			handleMemorySynthesize(args, db, vectors, {
				session,
				sampleMessage,
				elicit
			}),
		"memory-delete": (args, db, vectors, extra) => handleMemoryDelete(args, db, vectors, extra?.onProgress),
		"memory-detail": (args, db, _vectors, _extra) => handleMemoryDetail(args, db),
		"handoff-create": (args, db, _vectors, _extra) => handleHandoffCreate(args, db),
		"handoff-list": (args, db, _vectors, _extra) => handleHandoffList(args, db),
		"handoff-update": (args, db, _vectors, _extra) => handleHandoffUpdate(args, db),
		"task-claim": (args, db, _vectors, _extra) => handleTaskClaim(args, db),
		"claim-list": (args, db, _vectors, _extra) => handleClaimList(args, db),
		"claim-release": (args, db, _vectors, _extra) => handleClaimRelease(args, db),
		"standard-store": (args, db, vectors, _extra) => handleStandardStore(args, db, vectors),
		"standard-update": (args, db, vectors, _extra) => handleStandardUpdate(args, db, vectors),
		"standard-detail": (args, db, _vectors, _extra) => handleStandardDetail(args, db),
		"standard-delete": (args, db, vectors, _extra) => handleStandardDelete(args, db, vectors),
		"standard-search": (args, db, vectors, _extra) => handleStandardSearch(args, db, vectors),
		"task-create": (args, db, _vectors, _extra) => handleTaskCreate(args, db),
		"task-create-interactive": (args, db, _vectors, _extra) =>
			handleTaskCreateInteractive(args, db, { session, elicit }),
		"task-update": (args, db, vectors, _extra) => handleTaskUpdate(args, db, vectors),
		"task-delete": (args, db, _vectors, _extra) => handleTaskDelete(args, db),
		"task-list": (args, db, _vectors, _extra) => handleTaskList(args, db),
		"task-search": (args, db, _vectors, _extra) => handleTaskSearch(args, db),
		"task-detail": (args, db, _vectors, _extra) => handleTaskDetail(args, db),
		"agent-context": (args, db, vectors, _extra) => handleAgentContext(args, db, vectors),
		"decision-log": (args, db, vectors, _extra) => handleDecisionLog(args, db, vectors),
		"session-summarize": (args, db, vectors, _extra) => handleSessionSummarize(args, db, vectors),
		// Upstream alias tools
		remember_fact: (args, db, vectors, _extra) => handleMemoryStore(args, db, vectors),
		remember_facts: (args, db, vectors, _extra) => handleMemoryStore(args, db, vectors),
		recall: (args, db, vectors, _extra) => handleMemorySearch(args, db, vectors),
		forget: (args, db, vectors, _extra) => handleMemoryDelete(args, db, vectors),
		// Knowledge graph tools
		create_entity: (args, db, _vectors, _extra) => handleCreateEntity(args, db, _vectors),
		delete_entity: (args, db, _vectors, _extra) => handleDeleteEntity(args, db, _vectors),
		create_relation: (args, db, _vectors, _extra) => handleCreateRelation(args, db, _vectors),
		delete_relation: (args, db, _vectors, _extra) => handleDeleteRelation(args, db, _vectors),
		delete_observation: (args, db, _vectors, _extra) => handleDeleteObservation(args, db, _vectors),
		"kg-backfill": (args, db, _vectors, _extra) => handleKGBackfill(args, db),
		// Codebase index tools
		index_repository: (args, db, _vectors, _extra) => handleCodebaseIndexRepository(args, db, _vectors),
		index_status: (args, db, _vectors, _extra) => handleCodebaseIndexStatus(args, db, _vectors)
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
		if (def.name === "memory-synthesize" && !session.supportsSampling) {
			return false;
		}
		if (def.name === "task-create-interactive" && !session.supportsElicitationForm) {
			return false;
		}
		return true;
	});

	const publicSchema = makePublicSchema();

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
				inputSchema: publicSchema
			},
			async (args, extra) => {
				const rawArgs = (args ?? {}) as Record<string, unknown>;
				const normalizedArgs = normalizeToolArgs(rawArgs, session);

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
