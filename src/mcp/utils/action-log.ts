/**
 * ActionLogService — unified action-log policy for the whole server.
 *
 * POLICY: action_log INSERTs NEVER acquire the file lock (WriteLock).
 *
 * Rationale:
 * - SQLite is opened with journal_mode=WAL + busy_timeout=5000 (see
 *   storage/sqlite.ts), which already serializes single-row INSERTs safely
 *   across processes. action_log is append-only audit data — a concurrent
 *   INSERT only ever contends for the duration of a WAL commit (µs–ms).
 * - The file lock exists to serialize multi-statement mutations of business
 *   entities (memories, tasks, standards, ...). Taking it just to log a read
 *   would make every READ tool acquire the write lock, violating the
 *   "reads are never locked" contract documented in storage/write-lock.ts.
 *
 * All call sites (native SDK tools/index.ts, upstream router.ts, dashboard
 * controllers) must log through this module so the policy lives in ONE place.
 */

import type { SQLiteStore } from "../storage/sqlite";
import { logger } from "./logger";

export interface ActionLogOptions {
	query?: string;
	response?: string | object;
	memoryId?: string;
	taskId?: string;
	resultCount?: number;
}

export interface ActionLogEntry {
	action: string;
	owner: string;
	repo: string;
	options?: ActionLogOptions;
}

/**
 * Result of {@link extractActionLog} — everything needed to persist one
 * action-log row for a tool call.
 */
export interface ExtractedActionLog {
	/** Log-action type derived from the tool name (e.g. "memory-read" → "read"). */
	action: string;
	/** Effective repo scope: `args.repo`, `args.scope.repo`, or "unknown". */
	repo: string;
	/** Parsed metadata (query / memoryId / taskId / resultCount). */
	options: ActionLogOptions;
}

/**
 * Extracts action-log metadata for a single tool call from the tool name, its
 * (already-normalized) args, and the handler's `McpResponse`.
 *
 * BOTH dispatch transports call this — the native SDK path (tools/index.ts)
 * and the upstream router (router.ts) — so the derivation lives in ONE place
 * and cannot drift between them.
 *
 * CRITICAL: reads `result.structuredContent`, the field `createMcpResponse`
 * actually sets (utils/mcp-response.ts). The previous copy-pasted readers in
 * tools/index.ts:87 and router.ts:198 read the non-existent `structuredData`
 * key, so `memoryId`/`taskId`/`resultCount` silently no-opped on every tool
 * call. Keep this reading `structuredContent`.
 *
 * ENTITY-AWARE ID FALLBACK (TASK-155): action_log has exactly two entity
 * columns (`memory_id`, `task_id`), so a response id is only written when the
 * tool's domain matches that column — memory-domain tools populate
 * `memoryId`, task/handoff/claim-domain tools populate `taskId`, and nothing
 * else does. Each domain prefers its domain-qualified nested key (e.g.
 * memory-read detail nests `structuredContent.memory.id`, handoff-write nests
 * `structuredContent.handoff.id`) over the generic top-level `.id`. Standard
 * entities intentionally map to NEITHER column — writing a standard UUID into
 * `memory_id`/`task_id` would corrupt audit linkage exactly like the bug this
 * fixes.
 *
 * ONE-DIRECTION ARGS ROUTING (TASK-157): the generic `args.id` is applied ONLY
 * to the column matching the tool's domain — memory-domain tools populate
 * `memoryId`, task/handoff/claim-domain tools populate `taskId`, and every
 * other domain (incl. standard) applies `args.id` to NEITHER column. This
 * closes the residual leak where a memory UUID sent as `args.id` (memory-write
 * update/acknowledge, memory-read detail, memory-delete) was written into
 * `action_log.task_id`. Qualified args always map to their own column:
 * `args.memory_id` → `memoryId`, `args.task_id` → `taskId`, regardless of
 * domain.
 *
 * RESULT-COUNT CHAIN (TASK-156): explicit count fields handlers actually
 * emit — delete tools (`deletedCount` for memory/standard.delete,
 * `canceledCount` for task.delete) and bulk creates (`createdCount` for
 * task-write/bulk) — are preferred over the generic list-envelope `count`
 * (buildTableResult) and the `results` array length, before the `0` terminal.
 *
 * Pure and never throws: `result` is `unknown` and may be any scaffolded
 * shape — malformed payloads degrade to fallbacks, not exceptions.
 */
export function extractActionLog(toolName: string, args: Record<string, unknown>, result: unknown): ExtractedActionLog {
	const action = toolName.split("-")[1] || toolName;

	const repo = (args?.repo as string) || ((args?.scope as Record<string, unknown>)?.repo as string) || "unknown";

	const structuredContent = ((result as Record<string, unknown> | undefined)?.structuredContent ?? undefined) as
		| Record<string, unknown>
		| undefined;

	const domain = toolName.split("-")[0];
	const isMemoryDomain = domain === "memory";
	const isTaskLinkedDomain = domain === "task" || domain === "handoff" || domain === "claim";

	const nestedId = (key: string): string | undefined =>
		((structuredContent?.[key] as Record<string, unknown> | undefined)?.id as string | undefined) ?? undefined;

	const genericId = structuredContent?.id as string | undefined;

	// One-direction domain routing (TASK-157): the generic `args.id` is applied
	// ONLY to the column matching this tool's domain. A memory-domain tool
	// passing `id` (memory-write update/acknowledge, memory-read detail,
	// memory-delete) must NEVER leak that memory UUID into action_log.task_id —
	// the wrong-entity corruption this module exists to prevent. Qualified
	// args (`memory_id` / `task_id`) still map to their OWN column regardless
	// of domain; `args.id` does not.
	const memoryId = isMemoryDomain
		? (args?.id as string) || (args?.memory_id as string) || (nestedId("memory") ?? genericId)
		: (args?.memory_id as string) || undefined;

	const taskId = isTaskLinkedDomain
		? (args?.id as string) ||
			(args?.task_id as string) ||
			(nestedId("task") ?? nestedId("handoff") ?? nestedId("claim") ?? genericId)
		: (args?.task_id as string) || undefined;

	const countValue = (key: string): number | undefined => {
		const value = structuredContent?.[key];
		return typeof value === "number" && Number.isFinite(value) ? value : undefined;
	};

	const resultCount =
		countValue("deletedCount") ??
		countValue("createdCount") ??
		countValue("canceledCount") ??
		countValue("count") ??
		(Array.isArray(structuredContent?.results) ? structuredContent.results.length : undefined) ??
		0;

	const options: ActionLogOptions = {
		query: (args?.query as string) || (args?.title as string) || (args?.task_code as string) || undefined,
		response: result as string | object,
		memoryId,
		taskId,
		resultCount
	};

	return { action, repo, options };
}

/**
 * Log a single action WITHOUT acquiring the file lock.
 * Never throws: logging must never break the request it audits.
 */
export function logAction(
	db: SQLiteStore,
	action: string,
	owner: string,
	repo: string,
	options?: ActionLogOptions
): void {
	try {
		db.actions.logAction(action, owner, repo, options);
	} catch (err) {
		logger.error("Failed to log action", { action, repo, error: String(err) });
	}
}

/**
 * Log multiple actions atomically (single SQLite transaction), still WITHOUT
 * the file lock. Intended for callers that emit several rows at once.
 */
export function logActions(db: SQLiteStore, entries: ActionLogEntry[]): void {
	if (entries.length === 0) return;
	try {
		db.db
			.transaction((rows: ActionLogEntry[]) => {
				for (const entry of rows) {
					db.actions.logAction(entry.action, entry.owner, entry.repo, entry.options);
				}
			})
			.immediate(entries);
	} catch (err) {
		logger.error("Failed to log actions (batch)", { count: entries.length, error: String(err) });
	}
}
