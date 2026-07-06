import { SQLiteStore } from "../storage/sqlite";
import { type TaskStatus, type VectorStore } from "../types";
import { logger } from "../utils/logger";
import { handleMemoryStore } from "./memory.store";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves a parent_id value that is either a UUID or a task_code string.
 * Returns the resolved UUID, or throws if the task cannot be found.
 * An optional localCodeMap is checked first for cross-references within the same batch.
 */
export function resolveParentId(
	value: string | null | undefined,
	owner: string,
	repo: string,
	storage: SQLiteStore,
	localCodeMap?: Map<string, string>
): string | null {
	if (!value) return null;
	if (UUID_REGEX.test(value)) return value;
	// Check in-memory batch map first (cross-reference within same create batch)
	if (localCodeMap?.has(value)) return localCodeMap.get(value)!;
	// Treat as task_code, fall back to DB
	const parent = storage.tasks.getTaskByCode(owner, repo, value);
	if (!parent) throw new Error(`parent_id: task with code '${value}' not found in repo '${repo}'`);
	return parent.id;
}

export function resolveDependsOn(
	value: string | null | undefined,
	owner: string,
	repo: string,
	storage: SQLiteStore,
	localCodeMap?: Map<string, string>
): string | null {
	if (!value) return null;
	if (UUID_REGEX.test(value)) return value;
	// Check in-memory batch map first (cross-reference within same create batch)
	if (localCodeMap?.has(value)) return localCodeMap.get(value)!;
	const task = storage.tasks.getTaskByCode(owner, repo, value);
	if (!task) throw new Error(`depends_on: task with code '${value}' not found in repo '${repo}'`);
	return task.id;
}

export function deriveTaskStatusTimestamps(status: TaskStatus, now: string, existingTask?: { status: TaskStatus }) {
	const timestamps = {
		in_progress_at: null as string | null,
		finished_at: null as string | null,
		canceled_at: null as string | null
	};

	if (status === "in_progress" && existingTask?.status !== "in_progress") {
		timestamps.in_progress_at = now;
	}

	if (status === "completed") {
		timestamps.finished_at = now;
	}

	if (status === "canceled") {
		timestamps.canceled_at = now;
	}

	return timestamps;
}

export async function archiveTaskToMemory(taskId: string, repo: string, storage: SQLiteStore, vectors: VectorStore) {
	const task = storage.tasks.getTaskById(taskId);
	if (!task) return;

	const comments = storage.taskComments.getTaskCommentsByTaskId(taskId);

	let content = `Task: [${task.task_code}] ${task.title}\n`;
	content += `Phase: ${task.phase}\n`;
	content += `Description: ${task.description || "No description"}\n`;
	content += `Commit: ${task.commit_id || "N/A"}\n`;
	if (task.changed_files && task.changed_files.length > 0) {
		content += `Files changed:\n`;
		for (const f of task.changed_files) {
			content += `  - ${f}\n`;
		}
	}

	if (comments && comments.length > 0) {
		content += `\nComments & History:\n`;
		const chronComments = [...comments].reverse();
		for (const c of chronComments) {
			const statusInfo = c.next_status ? ` (Status: ${c.previous_status} -> ${c.next_status})` : "";
			content += `- [${c.created_at}] ${c.agent}${statusInfo}: ${c.comment}\n`;
		}
	}

	const metadata = {
		task_id: taskId,
		task_code: task.task_code,
		original_metadata: task.metadata
	};

	const title = `Completed Task: ${task.title}`;
	const truncatedTitle = title.length > 100 ? title.substring(0, 97) + "..." : title;

	try {
		await handleMemoryStore(
			{
				type: "task_archive",
				title: truncatedTitle,
				content: content,
				importance: Math.min(5, task.priority + 1),
				agent: task.agent || "system",
				role: task.role || "unknown",
				model: "system",
				scope: { repo, owner: task.owner || "" },
				tags: ["task-archive", ...task.tags],
				metadata: metadata
			},
			storage,
			vectors
		);
	} catch (error) {
		logger.error("Failed to archive task to memory", { error: String(error) });
	}
}
