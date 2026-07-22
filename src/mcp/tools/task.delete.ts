import { SQLiteStore } from "../storage/sqlite";
import { createMcpResponse } from "../utils/mcp-response";
import { UUID_REGEX } from "../utils/uuid";
import { TaskDeleteSchema } from "./schemas";

export async function handleTaskDelete(args: unknown, storage: SQLiteStore) {
	const validated = TaskDeleteSchema.parse(args);
	const { owner, repo, id, ids, task_code } = validated;

	// Resolve task_code to id if needed
	const resolvedIds: string[] = [];
	if (ids) {
		for (const item of ids) {
			if (UUID_REGEX.test(item)) {
				resolvedIds.push(item);
			} else {
				const task = storage.tasks.getTaskByCode(owner, repo, item);
				if (!task) throw new Error(`Task not found: ${item}`);
				resolvedIds.push(task.id);
			}
		}
	}
	if (id) {
		if (!UUID_REGEX.test(id)) {
			const task = storage.tasks.getTaskByCode(owner, repo, id);
			if (!task) throw new Error(`Task not found: ${id}`);
			resolvedIds.push(task.id);
		} else {
			resolvedIds.push(id);
		}
	}
	if (task_code) {
		const task = storage.tasks.getTaskByCode(owner, repo, task_code);
		if (!task) throw new Error(`Task not found: ${task_code}`);
		resolvedIds.push(task.id);
	}

	if (resolvedIds.length === 0) {
		throw new Error("Either 'id', 'ids', or 'task_code' must be provided for deletion");
	}

	const targetIds = resolvedIds;

	const tasksToDelete = storage.tasks.getTasksByIds(targetIds);
	const deletedCodes = tasksToDelete.map((t) => t.task_code);

	for (const targetId of targetIds) {
		storage.tasks.deleteTask(targetId);
	}

	return createMcpResponse(
		{
			success: true,
			id: id || undefined,
			ids: ids || undefined,
			repo,
			deletedCount: targetIds.length,
			deletedCodes
		},
		`Deleted ${targetIds.length} ${targetIds.length === 1 ? "task" : "tasks"} from repo "${repo}".`,
		{ includeJson: validated.json }
	);
}
