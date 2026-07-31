import { randomUUID } from "crypto";
import { SQLiteStore } from "../../storage/sqlite";
import { Task, TaskStatus, VectorStore } from "../../types";
import { logger } from "../../utils/logger";
import { archiveTaskToMemory } from "../task.helpers";

// ---------------------------------------------------------------------------
// Status transition logic
// ---------------------------------------------------------------------------

/**
 * Applies status timestamp fields (finished_at, canceled_at, in_progress_at)
 * based on the target status and current task state.
 * Modifies finalUpdates in place.
 */
export function applyStatusTimestamps(
	updates: Record<string, unknown>,
	existingTask: Task,
	now: string,
	finalUpdates: Record<string, unknown>
): void {
	const status = updates.status as TaskStatus | undefined;
	if (status === "completed") {
		finalUpdates.finished_at = now;
	} else if (status === "canceled") {
		finalUpdates.canceled_at = now;
	} else if (status === "in_progress" && existingTask.status !== "in_progress") {
		finalUpdates.in_progress_at = now;
	}
}

/**
 * Inserts a task comment when status changes or a comment is provided.
 */
export function insertStatusComment(
	storage: SQLiteStore,
	targetId: string,
	owner: string,
	repo: string,
	updates: Record<string, unknown>,
	existingTask: Task,
	isStatusChanging: boolean,
	comment: string | undefined,
	now: string
): void {
	if (comment !== undefined || isStatusChanging) {
		storage.taskComments.insertTaskComment({
			id: randomUUID(),
			task_id: targetId,
			owner,
			repo,
			comment: comment || `Status updated to ${updates.status}`,
			agent: (updates.agent as string) || existingTask.agent || "unknown",
			role: (updates.role as string) || existingTask.role || "unknown",
			model: (updates.model as string) || "unknown",
			previous_status: isStatusChanging ? (existingTask.status as TaskStatus) : null,
			next_status: isStatusChanging ? (updates.status as TaskStatus) : null,
			created_at: now
		});
	}
}

/**
 * Releases claims and expires handoffs for completed/canceled tasks.
 */
export function handleCoordinationCleanup(
	storage: SQLiteStore,
	targetId: string,
	isStatusChanging: boolean,
	status: TaskStatus | undefined
): { releasedClaims: number; expiredHandoffs: number } {
	if (isStatusChanging && (status === "completed" || status === "canceled")) {
		const releasedClaims = storage.handoffs.releaseClaimsForTask(targetId);
		const expiredHandoffs = storage.handoffs.updatePendingHandoffsForTask(targetId, "expired");
		return { releasedClaims, expiredHandoffs };
	}
	return { releasedClaims: 0, expiredHandoffs: 0 };
}

/**
 * Archives completed tasks to memory (awaited, not fire-and-forget).
 *
 * Callers await this BEFORE returning the tool response so the task_archive
 * memory rows exist the moment the caller observes the write (deterministic
 * for tests and agents alike — no race window, no deferred work leaking into
 * later requests). Each archive runs under withWrite: the archival performs
 * memory INSERT + outbox enqueue via handleMemoryWrite (task.helpers.ts), so
 * it must never run unlocked. The write lock is reentrant (WriteLock.withLock),
 * so when the router already holds the outer withWrite the inner acquisition is
 * a no-op — no nested locking, no deadlock.
 *
 * The archival is intentionally cheap: task_archive skips the conflict check
 * (memory-write/helpers.ts) and ONNX embedding + KG extraction run later via
 * the outbox worker (TASK-013), so awaiting it adds negligible latency to the
 * write path.
 */
export async function archiveCompletedTasks(
	completedTaskIds: string[],
	repo: string,
	storage: SQLiteStore,
	vectors: VectorStore
): Promise<void> {
	for (const taskId of completedTaskIds) {
		try {
			await storage.withWrite(() => archiveTaskToMemory(taskId, repo, storage, vectors));
		} catch (err) {
			logger.error("Failed to archive task to memory", { taskId, error: String(err) });
		}
	}
}
