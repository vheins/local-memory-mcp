// ── Shared tool plumbing ──────────────────────────────────────────────────
// Single source of truth for the write-tool set, resource-mutation URI
// derivation, and page-limit normalization.
//
// Consumed by BOTH dispatch paths so they cannot drift:
//   - router.ts        (MCP protocol router — thin test adapter)
//   - tools/index.ts   (native MCP SDK tool registration — production)
//
// Keep this file free of store/vector dependencies: it is pure logic shared
// by two transports.

/**
 * Tools that mutate the DB — must run under write lock.
 *
 * NOTE: "codebase-index" is intentionally NOT a WRITE_TOOL (TASK-007).
 * The full index run (file discovery + tree-sitter parse) is heavy CPU work
 * that must not hold the file lock. indexing-writer.ts acquires the lock
 * per DB batch (with retry/backoff) instead, keeping lock hold time minimal.
 */
export const WRITE_TOOLS: ReadonlySet<string> = new Set([
	// Canonical memory tools
	"memory-write",
	"memory-delete",
	// Summarize tools
	"repo-summarize",
	// Handoff & Claim
	"handoff-write",
	"claim-manage",
	// Standards
	"standard-write",
	"standard-delete",
	// Tasks
	"task-write",
	"task-delete"
]);

/**
 * Derives the set of resource URIs affected by a tool call, used to notify
 * clients via `notifications/resources/updated` after mutations.
 *
 * Both transports call this with the same normalized args + handler result so
 * resource invalidation stays consistent regardless of dispatch path.
 */
export function collectAffectedResourceUris(
	toolName: string,
	args: Record<string, unknown>,
	result: unknown
): string[] {
	const res = result as Record<string, unknown> | undefined;
	const repo =
		(args?.repo as string) ||
		((args?.scope as Record<string, unknown>)?.repo as string) ||
		((res?.data as Record<string, unknown>)?.repo as string);
	const uris = new Set<string>();

	const touchesMemory = toolName.startsWith("memory-") || toolName === "task-write" || toolName === "task-delete";
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

/**
 * Normalizes a list/tool pagination `limit` argument.
 *
 * Falls back to `fallback` for missing/invalid values, clamps to [1, 100],
 * and coerces to an integer.
 */
export function normalizePageLimit(value: unknown, fallback: number): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
		return Math.max(1, fallback);
	}

	return Math.min(value, 100);
}
