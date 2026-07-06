import { randomUUID } from "crypto";
import { SQLiteStore } from "../storage/sqlite";
import { TaskStatus, VectorStore } from "../types";
import { createMcpResponse } from "../utils/mcp-response";
import { logger } from "../utils/logger";
import { TaskUpdateSchema } from "./schemas";
import { resolveParentId, resolveDependsOn, archiveTaskToMemory } from "./task.helpers";

export async function handleTaskUpdate(args: unknown, storage: SQLiteStore, vectors: VectorStore) {
	const updateData = TaskUpdateSchema.parse(args);
	const { owner, repo, id, ids, comment, force, ...updates } = updateData;

	// Resolve task_code to id if needed
	let resolvedId = id;
	if (!resolvedId && !ids && updates.task_code) {
		const found = storage.tasks.getTaskByCode(owner, repo, updates.task_code);
		if (!found) throw new Error(`Task not found: ${updates.task_code}`);
		resolvedId = found.id;
	}

	const targetIds = ids || (resolvedId ? [resolvedId] : []);

	if (targetIds.length === 0) {
		throw new Error("Either 'id' or 'ids' must be provided for update");
	}

	let updatedCount = 0;
	const updatedTasks: { id: string; code: string }[] = [];
	const completedTaskIds: string[] = [];
	let releasedClaims = 0;
	let expiredHandoffs = 0;
	const now = new Date().toISOString();
	const isStatusChangingGlobal = updates.status !== undefined;

	const existingTasks = storage.tasks.getTasksByIds(targetIds);
	const taskMap = new Map(existingTasks.map((t) => [t.id, t]));

	for (const targetId of targetIds) {
		const existingTask = taskMap.get(targetId);
		if (!existingTask) {
			if (id) throw new Error(`Task not found: ${targetId}`);
			continue;
		}

		const isStatusChanging = isStatusChangingGlobal && updates.status !== existingTask.status;

		if (isStatusChanging && !force) {
			if (!comment || comment.trim() === "") {
				throw new Error("comment is required when changing task status");
			}

			const isStartable =
				existingTask.status === "backlog" || existingTask.status === "pending" || existingTask.status === "blocked";

			if (isStartable && updates.status === "completed") {
				throw new Error(
					`Cannot transition task ${targetId} from '${existingTask.status}' directly to 'completed'. Must be 'in_progress' first.`
				);
			}
		}

		if (updates.status === "completed" && isStatusChanging) {
			if (updates.est_tokens === undefined) {
				throw new Error("est_tokens is required when changing task status to completed");
			}

			const children = storage.tasks.getChildrenByParentId(targetId);
			const incompleteChildren = children.filter((c) => c.status !== "completed");
			if (incompleteChildren.length > 0) {
				const childList = incompleteChildren.map((c) => `[${c.task_code}] ${c.title} (${c.status})`).join("; ");
				throw new Error(
					`Cannot complete task [${existingTask.task_code}] "${existingTask.title}" — it has ${incompleteChildren.length} incomplete child task(s). Complete the following child task(s) first: ${childList}`
				);
			}
		}

		if (updates.task_code && storage.tasks.isTaskCodeDuplicate(owner, repo, updates.task_code, targetId)) {
			throw new Error(`Duplicate task_code: '${updates.task_code}' already exists`);
		}

		const finalUpdates: Record<string, unknown> = { ...updates };

		// Resolve parent_id if it was provided (can be UUID or task code)
		if (updates.parent_id !== undefined) {
			finalUpdates.parent_id = resolveParentId(updates.parent_id, owner, repo, storage);
		}

		// Resolve depends_on if it was provided (can be UUID or task code)
		if (updates.depends_on !== undefined) {
			finalUpdates.depends_on = resolveDependsOn(updates.depends_on as string | null | undefined, owner, repo, storage);
		}

		if (updates.phase !== undefined || updates.tags !== undefined) {
			let currentTags = updates.tags || existingTask.tags || [];
			// Remove any existing phase: tags
			currentTags = currentTags.filter((t) => !t.startsWith("phase:"));

			// Add new phase: tag if phase exists
			const finalPhase = updates.phase !== undefined ? updates.phase : existingTask.phase;
			if (finalPhase) {
				const phaseTag = `phase:${finalPhase}`;
				if (!currentTags.includes(phaseTag)) {
					currentTags.push(phaseTag);
				}
			}
			finalUpdates.tags = currentTags;
		}

		if (updates.status === "completed") {
			finalUpdates.finished_at = now;
			finalUpdates.commit_id = updates.commit_id;
			finalUpdates.changed_files = updates.changed_files;
		} else if (updates.status === "canceled") finalUpdates.canceled_at = now;
		else if (updates.status === "in_progress" && existingTask.status !== "in_progress")
			finalUpdates.in_progress_at = now;

		storage.tasks.updateTask(targetId, finalUpdates);

		if (comment !== undefined || isStatusChanging) {
			storage.taskComments.insertTaskComment({
				id: randomUUID(),
				task_id: targetId,
				owner,
				repo,
				comment: comment || `Status updated to ${updates.status}`,
				agent: updates.agent || existingTask.agent || "unknown",
				role: updates.role || existingTask.role || "unknown",
				model: updates.model || "unknown",
				previous_status: isStatusChanging ? (existingTask.status as TaskStatus) : null,
				next_status: isStatusChanging ? (updates.status as TaskStatus) : null,
				created_at: now
			});
		}

		if (updates.status === "completed" && existingTask.status !== "completed") {
			completedTaskIds.push(targetId);
		}
		if (isStatusChanging && (updates.status === "completed" || updates.status === "canceled")) {
			releasedClaims += storage.handoffs.releaseClaimsForTask(targetId);
			expiredHandoffs += storage.handoffs.updatePendingHandoffsForTask(targetId, "expired");
		}
		updatedTasks.push({ id: targetId, code: (updates.task_code as string) || existingTask.task_code });
		updatedCount++;
	}

	const taskCodesStr = updatedTasks.length > 0 ? ` Tasks: ${updatedTasks.map((t) => t.code).join(", ")}.` : "";
	const fieldsStr = Object.keys(updates).length > 0 ? ` Fields: ${Object.keys(updates).join(", ")}.` : "";
	const isCompleted = updates.status === "completed" && updatedCount > 0;
	let summaryText = isCompleted
		? `Updated ${updatedCount} task(s) in repo "${repo}". Task marked as completed with commit ${updates.commit_id} (${(updates.changed_files || []).length} files changed).`
		: `Updated ${updatedCount} task(s) in repo "${repo}".`;
	summaryText += `${taskCodesStr}${fieldsStr}`;
	if (releasedClaims || expiredHandoffs) {
		summaryText += ` Auto-closed coordination: released ${releasedClaims} claim(s), expired ${expiredHandoffs} handoff(s).`;
	}

	const response = createMcpResponse(
		{
			success: true,
			id: id || undefined,
			ids: ids || undefined,
			repo,
			status: updates.status,
			updatedCount,
			updatedFields: Object.keys(updates),
			coordinationCleanup: {
				releasedClaims,
				expiredHandoffs
			}
		},
		summaryText,
		{ includeSerializedStructuredContent: updateData.structured }
	);

	// Archive completed tasks AFTER releasing write lock (vector embedding is slow)
	// Run sequentially to avoid parallel ONNX model loading (OOM risk)
	if (completedTaskIds.length > 0) {
		setImmediate(async () => {
			for (const taskId of completedTaskIds) {
				try {
					await archiveTaskToMemory(taskId, repo, storage, vectors);
				} catch (err) {
					logger.error("Failed to archive task to memory", { taskId, error: String(err) });
				}
			}
		});
	}

	return response;
}
