import { SQLiteStore } from "../storage/sqlite";
import { createMcpResponse } from "../utils/mcp-response";
import { logger } from "../utils/logger";
import { UUID_REGEX } from "../utils/uuid";
import { TaskDeleteSchema } from "./schemas";

export async function handleTaskDelete(args: unknown, storage: SQLiteStore) {
	const validated = TaskDeleteSchema.parse(args);
	const { owner, repo, id, code, task_code, ids, task_codes } = validated;

	// Resolve all identifiers to UUIDs
	const resolvedIds: string[] = [];

	// Helper: resolve a single identifier (UUID or task_code) to UUID
	function resolveIdentifier(identifier: string): string {
		if (UUID_REGEX.test(identifier)) return identifier;
		const task = storage.tasks.getTaskByCode(owner, repo, identifier);
		if (!task) throw new Error(`Task not found: ${identifier}`);
		return task.id;
	}

	// Single identifier: id (UUID or task_code)
	if (id) {
		resolvedIds.push(resolveIdentifier(id));
	}

	// Single code: code (alias for task_code)
	if (code) {
		resolvedIds.push(resolveIdentifier(code));
	}

	// Single task_code
	if (task_code) {
		resolvedIds.push(resolveIdentifier(task_code));
	}

	// Bulk identifiers: ids (array of UUIDs or task_codes)
	if (ids) {
		for (const item of ids) {
			resolvedIds.push(resolveIdentifier(item));
		}
	}

	// Bulk codes: task_codes (array of string codes)
	if (task_codes) {
		for (const tc of task_codes) {
			resolvedIds.push(resolveIdentifier(tc));
		}
	}

	if (resolvedIds.length === 0) {
		throw new Error("At least one of 'id', 'code', 'task_code', 'ids', or 'task_codes' must be provided for deletion");
	}

	// Fetch tasks to verify existence and collect codes for response
	const tasksToDelete = storage.tasks.getTasksByIds(resolvedIds);
	const deletedCodes = tasksToDelete.map((t) => t.task_code);
	const taskMap = new Map(tasksToDelete.map((t) => [t.id, t]));

	// Soft-delete: cancel tasks, remove vectors, release claims, expire handoffs
	const now = new Date().toISOString();
	for (const targetId of resolvedIds) {
		storage.tasks.updateTask(targetId, {
			status: "canceled",
			canceled_at: now
		});
		storage.tasks.removeTaskVector(targetId);
		storage.handoffs.releaseClaimsForTask(targetId);
		storage.handoffs.updatePendingHandoffsForTask(targetId, "expired");

		// KG cleanup: best-effort cascade delete (REFACTOR-KG-006)
		const taskEntry = taskMap.get(targetId);
		if (taskEntry) {
			try {
				storage.db
					.prepare(`DELETE FROM observations WHERE observation = ?`)
					.run(`Mentioned in task: ${taskEntry.title}`);
				storage.db
					.prepare(`DELETE FROM entities WHERE name NOT IN (SELECT DISTINCT entity_name FROM observations)`)
					.run();
			} catch (kgError) {
				logger.warn("[KG-Cleanup] Failed to clean up KG entities for deleted task", {
					taskId: targetId,
					error: String(kgError)
				});
			}
		}
	}

	return createMcpResponse(
		{
			success: true,
			id: id || undefined,
			ids: ids || undefined,
			repo,
			canceledCount: resolvedIds.length,
			canceledCodes: deletedCodes
		},
		`Canceled ${resolvedIds.length} ${resolvedIds.length === 1 ? "task" : "tasks"} from repo "${repo}".`,
		{ includeJson: validated.json }
	);
}
