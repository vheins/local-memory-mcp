import { TaskSearchSchema, TaskStatusSchema } from "./schemas";
import { SQLiteStore } from "../storage/sqlite";
import { Task } from "../types";
import { logger } from "../utils/logger";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";

export async function handleTaskSearch(args: unknown, storage: SQLiteStore): Promise<McpResponse> {
	const validated = TaskSearchSchema.parse(args);
	const { owner, repo, query, status, limit, offset, json: isJsonRequest = false, phase, priority } = validated;

	let tasks: Task[];
	if (status) {
		const statuses = status
			.split(",")
			.map((s: string) => s.trim())
			.filter(Boolean);
		if (statuses.length > 1) {
			tasks = storage.tasks.getTasksByMultipleStatuses(owner, repo, statuses, undefined, undefined, query);
		} else {
			tasks = storage.tasks.getTasksByRepo(owner, repo, status, undefined, undefined, query);
		}
	} else {
		tasks = storage.tasks.getTasksByMultipleStatuses(
			owner,
			repo,
			[...TaskStatusSchema.options],
			undefined,
			undefined,
			query
		);
	}

	if (phase) {
		const phaseLower = phase.toLowerCase();
		tasks = tasks.filter((t: Task) => t.phase && t.phase.toLowerCase() === phaseLower);
	}
	if (priority !== undefined) {
		tasks = tasks.filter((t: Task) => t.priority === priority);
	}

	const total = tasks.length;
	const paginated = tasks.slice(offset, offset + limit);

	const COLUMNS = ["id", "task_code", "title", "status", "priority", "updated_at", "phase"] as const;
	const rows = paginated.map((t: Task) => [t.id, t.task_code, t.title, t.status, t.priority, t.updated_at, t.phase]);

	const structuredData = {
		schema: "task-search" as const,
		query,
		count: paginated.length,
		total,
		offset,
		limit,
		results: {
			columns: [...COLUMNS],
			rows
		}
	};

	let contentSummary: string | undefined;
	if (!isJsonRequest) {
		contentSummary =
			paginated.length > 0
				? `Found ${total} tasks matching "${query}" in repo "${repo}". Use task-detail to fetch full task content.`
				: `No tasks found for "${query}" in repo "${repo}".`;
	}

	logger.info("[Tool] task.search", {
		repo,
		query,
		total,
		offset,
		returned: paginated.length
	});

	return createMcpResponse(structuredData, contentSummary || `Found ${total} tasks for "${query}".`, {
		contentSummary,
		structuredContentPathHint: "results",
		includeJson: isJsonRequest
	});
}
