import { SQLiteStore } from "../storage/sqlite";
import { createMcpResponse } from "../utils/mcp-response";
import { TaskGetSchema } from "./schemas";

export async function handleTaskGet(args: Record<string, unknown>, storage: SQLiteStore) {
	const { repo, id, task_code } = TaskGetSchema.parse(args);

	let task;
	if (id) {
		task = storage.tasks.getTaskById(id);
	} else if (task_code) {
		task = storage.tasks.getTaskByCode(repo, task_code);
	} else {
		// Should be caught by Zod refine, but for safety:
		throw new Error("Either id or task_code must be provided");
	}

	if (!task) {
		throw new Error(`Task not found: ${id || task_code} in repo ${repo}`);
	}

	const summary = `Task [${task.task_code}] ${task.title} (${task.status})`;

	return createMcpResponse(task, summary, {
		contentSummary: summary,
		includeSerializedStructuredContent: true,
		resourceLinks: [
			{
				uri: `task://${task.id}`,
				name: `Task: ${task.title}`,
				mimeType: "application/json"
			}
		]
	});
}
