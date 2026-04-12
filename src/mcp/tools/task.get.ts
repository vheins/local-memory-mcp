import { SQLiteStore } from "../storage/sqlite";
import { createMcpResponse } from "../utils/mcp-response";
import { TaskGetSchema } from "./schemas";

export async function handleTaskGet(args: unknown, storage: SQLiteStore) {
	const validated = TaskGetSchema.parse(args);
	const { repo, id, task_code, structured: isStructuredRequest } = validated;

	let task;
	if (id) {
		task = storage.tasks.getTaskById(id);
	} else if (task_code) {
		task = storage.tasks.getTaskByCode(repo, task_code);
	} else {
		throw new Error("Either id or task_code must be provided");
	}

	if (!task) {
		throw new Error(`Task not found: ${id || task_code} in repo ${repo}`);
	}

	const comments = storage.tasks.getTaskCommentsByTaskId(task.id);

	let contentSummary: string | undefined;
	if (!isStructuredRequest) {
		const lines: string[] = [
			`Task: ${task.title}`,
			`Code: ${task.task_code}`,
			`Status: ${task.status}`,
			`Priority: ${task.priority}`,
			`ID: ${task.id}`
		];

		if (task.phase) lines.push(`Phase: ${task.phase}`);
		if (task.description) lines.push(`Description: ${task.description}`);
		if (task.metadata) lines.push(`Metadata: ${JSON.stringify(task.metadata)}`);
		lines.push(`Created: ${task.created_at}`);
		if (task.updated_at) lines.push(`Updated: ${task.updated_at}`);
		if (task.in_progress_at) lines.push(`Started: ${task.in_progress_at}`);
		if (task.finished_at) lines.push(`Finished: ${task.finished_at}`);

		if (comments.length > 0) {
			lines.push("", "--- History ---");
			for (const c of comments) {
				const statusChange =
					c.previous_status || c.next_status ? ` [${c.previous_status || "?"} → ${c.next_status || "?"}]` : "";
				const agentInfo = c.agent ? ` (${c.agent})` : "";
				lines.push(`- ${c.created_at}${statusChange}${agentInfo}: ${c.comment}`);
			}
		}
		contentSummary = lines.join("\n");
	}

	const structuredData = {
		...task,
		comments
	};

	return createMcpResponse(structuredData, contentSummary || "", {
		contentSummary,
		includeSerializedStructuredContent: isStructuredRequest
	});
}
