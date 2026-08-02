import { SQLiteStore } from "../storage/sqlite";
import { createMcpResponse } from "../utils/mcp-response";
import { collectEntityIds } from "../utils/auto-infer";
import { purgeEntityAndCleanup } from "../utils/purge-entity-cleanup";
import { TaskDeleteSchema } from "./schemas";

export async function handleTaskDelete(args: unknown, storage: SQLiteStore) {
	const validated = TaskDeleteSchema.parse(args);
	const { owner, repo, id, code, task_code, ids, codes, task_codes } = validated;

	// Resolve all identifiers (id/code/task_code/ids/codes/task_codes — UUID or
	// code, auto-inferred per item) to UUIDs via the shared helper (OPT-DRY-06).
	// Unresolvable non-empty identifiers still throw from resolveEntityRef —
	// the TASK-123 fail-loud behavior (no `?? ""` sentinel, no phantom success).
	const resolvedIds = collectEntityIds(validated, "task", storage, { owner, repo });

	if (resolvedIds.length === 0) {
		throw new Error(
			"At least one of 'id', 'code', 'task_code', 'ids', 'codes', or 'task_codes' must be provided for deletion"
		);
	}

	// Fetch tasks to verify existence and collect codes for response
	const tasksToDelete = storage.tasks.getTasksByIds(resolvedIds);
	const deletedCodes = tasksToDelete.map((t) => t.task_code);
	const taskMap = new Map(tasksToDelete.map((t) => [t.id, t]));

	// Shared purge + cleanup contract (OPT-DRY-03): soft cancel + child detach +
	// vector removal + claim release + handoff expiry + queue_jobs purge +
	// repo-scoped KG cleanup — identical to the memory/standard delete tools.
	// All DB mutations run in ONE transaction; KG cleanup stays best-effort.
	purgeEntityAndCleanup(
		storage,
		"task",
		resolvedIds.map((id) => {
			const task = taskMap.get(id);
			return task ? { id, title: task.title, repo } : { id };
		})
	);

	return createMcpResponse(
		{
			success: true,
			id: id || undefined,
			code: code || undefined,
			ids: ids || undefined,
			codes: codes || undefined,
			task_code: task_code || undefined,
			task_codes: task_codes || undefined,
			repo,
			canceledCount: resolvedIds.length,
			canceledCodes: deletedCodes
		},
		`Deleted ${resolvedIds.length} ${resolvedIds.length === 1 ? "task" : "tasks"} from "${repo}"${deletedCodes.length > 0 ? `: ${deletedCodes.join(", ")}` : ""}.`,
		{ includeJson: validated.json }
	);
}
