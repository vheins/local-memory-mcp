import { SQLiteStore } from "../../storage/sqlite";
import { TaskStatus, VectorStore } from "../../types";
import { createMcpResponse, McpResponse } from "../../utils/mcp-response";
import { UUID_REGEX } from "../../utils/uuid";
import { resolveParentId, resolveDependsOn } from "../task.helpers";
import { validateStatusTransition } from "./state-machine";
import { WriteParams } from "./types";
import {
	buildUpdatesFromParams,
	applyPhaseTagSync,
	applyDecisionRefsToUpdates,
	enrichUpdatedTasks
} from "./update-field";
import {
	applyStatusTimestamps,
	insertStatusComment,
	handleCoordinationCleanup,
	archiveCompletedTasks
} from "./update-status";

// ---------------------------------------------------------------------------
// Single UPDATE — shared core logic
// ---------------------------------------------------------------------------

async function coreUpdate(
	params: WriteParams,
	storage: SQLiteStore,
	vectors: VectorStore
): Promise<{
	updatedCount: number;
	updatedTasks: { id: string; code: string }[];
	completedTaskIds: string[];
	releasedClaims: number;
	expiredHandoffs: number;
	updatedFields: string[];
	taskTitle: string;
	oldStatus: string;
	newStatus: string | undefined;
}> {
	const { owner, repo, id, comment, force } = params;

	// Build the set of updates (exclude identification/control fields)
	const updates = buildUpdatesFromParams(params);

	// Resolve task identifier to UUID: prefer id, fall back to code
	let resolvedId: string | undefined;
	if (id) {
		if (UUID_REGEX.test(id)) {
			resolvedId = id;
		} else {
			throw new Error(`Invalid id format: '${id}'. Use a UUID or use 'code' for code-based lookup.`);
		}
	}
	if (!resolvedId && params.code) {
		const found = storage.tasks.getTaskByCode(owner, repo, params.code);
		if (!found) throw new Error(`Task not found by code: ${params.code}`);
		resolvedId = found.id;
	}

	if (!resolvedId) {
		throw new Error("Either 'id' (UUID) or 'code' must be provided for update");
	}

	const targetIds = [resolvedId];
	let updatedCount = 0;
	const updatedTasks: { id: string; code: string }[] = [];
	const completedTaskIds: string[] = [];
	let releasedClaims = 0;
	let expiredHandoffs = 0;
	const now = new Date().toISOString();
	const isStatusChangingGlobal = updates.status !== undefined;

	const existingTasks = storage.tasks.getTasksByIds(targetIds);
	const taskMap = new Map(existingTasks.map((t) => [t.id, t]));

	// All task mutations for this update run in ONE transaction — a mid-loop
	// failure (validation, FK, etc.) rolls back the entire batch (no partial state).
	storage.db.transaction(() => {
		for (const targetId of targetIds) {
			const existingTask = taskMap.get(targetId);
			if (!existingTask) {
				throw new Error(`Task not found: ${targetId}`);
			}

			const isStatusChanging = isStatusChangingGlobal && updates.status !== existingTask.status;

			// Status transition validation
			if (isStatusChanging && !force) {
				const validationError = validateStatusTransition(
					existingTask.status,
					updates.status as TaskStatus,
					comment,
					force,
					updates.est_tokens as number | undefined
				);
				if (validationError) {
					throw new Error(validationError);
				}

				// Children gate: cannot complete if children are incomplete
				if (updates.status === "completed") {
					const children = storage.tasks.getChildrenByParentId(targetId);
					const incompleteChildren = children.filter((c) => c.status !== "completed");
					if (incompleteChildren.length > 0) {
						const childList = incompleteChildren.map((c) => `[${c.task_code}] ${c.title} (${c.status})`).join("; ");
						throw new Error(
							`Cannot complete task [${existingTask.task_code}] "${existingTask.title}" — it has ${incompleteChildren.length} incomplete child task(s). Complete the following child task(s) first: ${childList}`
						);
					}
				}
			}

			// Check for duplicate task_code if updating it
			if (updates.task_code && storage.tasks.isTaskCodeDuplicate(owner, repo, updates.task_code as string, targetId)) {
				throw new Error(`Duplicate task_code: '${updates.task_code}' already exists`);
			}

			const finalUpdates: Record<string, unknown> = { ...updates };

			// Resolve parent_id if provided (UUID or code)
			if (updates.parent_id !== undefined) {
				finalUpdates.parent_id = resolveParentId(updates.parent_id as string | null | undefined, owner, repo, storage);
			}

			// Resolve depends_on if provided (UUID or code)
			if (updates.depends_on !== undefined) {
				finalUpdates.depends_on = resolveDependsOn(
					updates.depends_on as string | null | undefined,
					owner,
					repo,
					storage
				);
			}

			// Phase tag sync
			applyPhaseTagSync(updates, existingTask, finalUpdates);

			// decision_refs → metadata injection
			applyDecisionRefsToUpdates(params, existingTask, finalUpdates);

			// Status timestamp management
			applyStatusTimestamps(updates, existingTask, now, finalUpdates);

			storage.tasks.updateTask(targetId, finalUpdates);

			// Insert comment if status changed or comment provided
			insertStatusComment(storage, targetId, owner, repo, updates, existingTask, isStatusChanging, comment, now);

			// Track completed tasks for later archival
			if (updates.status === "completed" && existingTask.status !== "completed") {
				completedTaskIds.push(targetId);
			}

			// Auto-release claims and expire handoffs on completion/cancellation
			const cleanup = handleCoordinationCleanup(
				storage,
				targetId,
				isStatusChanging,
				updates.status as TaskStatus | undefined
			);
			releasedClaims += cleanup.releasedClaims;
			expiredHandoffs += cleanup.expiredHandoffs;

			updatedTasks.push({
				id: targetId,
				code: (updates.task_code as string) || existingTask.task_code
			});
			updatedCount++;
		}
	})();

	// Best-effort vector embedding + KG extraction for updated tasks (if title/description changed)
	if ((params.title !== undefined || params.description !== undefined) && updatedCount > 0) {
		await enrichUpdatedTasks(updatedTasks, storage, vectors);
	}

	const existingTask = taskMap.get(targetIds[0])!;
	return {
		updatedCount,
		updatedTasks,
		completedTaskIds,
		releasedClaims,
		expiredHandoffs,
		updatedFields: Object.keys(updates),
		taskTitle: (updates.title as string) || existingTask.title,
		oldStatus: existingTask.status,
		newStatus: updates.status as string | undefined
	};
}

export async function handleUpdate(
	params: WriteParams,
	storage: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	const {
		updatedCount,
		updatedTasks,
		completedTaskIds,
		releasedClaims,
		expiredHandoffs,
		updatedFields,
		taskTitle,
		oldStatus,
		newStatus
	} = await coreUpdate(params, storage, vectors);

	const fieldsStr = updatedFields.length > 0 ? updatedFields.join(", ") : "none";
	let summaryText: string;
	if (updatedCount === 1 && updatedTasks.length === 1) {
		const extra =
			params.status === "completed"
				? ` (completed with commit ${params.commit_id}, ${(params.changed_files || []).length} files changed)`
				: "";
		const transition = oldStatus && newStatus && oldStatus !== newStatus ? ` ${oldStatus} → ${newStatus}` : "";
		summaryText = `Updated [${updatedTasks[0].code}] "${taskTitle}"${transition} in "${params.repo}" — ${fieldsStr}.${extra}`;
	} else {
		const tasksStr = updatedTasks.map((t) => `[${t.code}]`).join(", ");
		summaryText = `Updated ${updatedCount} tasks in "${params.repo}" — ${tasksStr}.`;
	}
	if (releasedClaims || expiredHandoffs) {
		summaryText += ` Auto-closed coordination: released ${releasedClaims} ${releasedClaims === 1 ? "claim" : "claims"}, expired ${expiredHandoffs} ${expiredHandoffs === 1 ? "handoff" : "handoffs"}.`;
	}

	const response = createMcpResponse(
		{
			success: true,
			id: params.id || undefined,
			repo: params.repo,
			status: params.status,
			updatedCount,
			updatedFields,
			coordinationCleanup: {
				releasedClaims,
				expiredHandoffs
			}
		},
		summaryText,
		{ includeJson: params.json }
	);

	// Archive completed tasks BEFORE the response resolves so task_archive
	// memory rows exist once the caller observes the write (deterministic —
	// no setImmediate race). Awaited under the (reentrant) write lock.
	await archiveCompletedTasks(completedTaskIds, params.repo, storage, vectors);

	return response;
}

// ---------------------------------------------------------------------------
// BULK UPDATE by IDs (array of UUIDs)
// ---------------------------------------------------------------------------

/**
 * Handles bulk update of tasks by array of UUID `ids`. All tasks receive the same updates.
 * Supports status transitions (with validation, timestamps, claims/handoffs cleanup, archival),
 * field updates, comments, coordination cleanup, and KG enrichment.
 */
export async function handleBulkUpdateByIds(
	params: WriteParams,
	storage: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	const { owner, repo, ids, comment, force } = params;
	if (!ids || ids.length === 0) {
		throw new Error("No task IDs provided for bulk update");
	}

	// Build the set of updates (exclude identification/control fields)
	const updates = buildUpdatesFromParams(params);

	// Validate all IDs exist before mutating
	const existingTasks = storage.tasks.getTasksByIds(ids);
	const taskMap = new Map(existingTasks.map((t) => [t.id, t]));

	const notFound = ids.filter((id) => !taskMap.has(id));
	if (notFound.length > 0) {
		throw new Error(`Tasks not found: ${notFound.join(", ")}`);
	}

	const now = new Date().toISOString();
	const isStatusChangingGlobal = updates.status !== undefined;

	const updatedTasks: { id: string; code: string }[] = [];
	const completedTaskIds: string[] = [];
	let releasedClaims = 0;
	let expiredHandoffs = 0;

	// All task mutations for this bulk update run in ONE transaction — a
	// mid-loop failure rolls back the entire batch (no partial state).
	storage.db.transaction(() => {
		for (const targetId of ids) {
			const existingTask = taskMap.get(targetId)!;
			const isStatusChanging = isStatusChangingGlobal && updates.status !== existingTask.status;

			// Status transition validation
			if (isStatusChanging && !force) {
				const validationError = validateStatusTransition(
					existingTask.status,
					updates.status as TaskStatus,
					comment,
					force,
					updates.est_tokens as number | undefined
				);
				if (validationError) {
					throw new Error(validationError);
				}

				// Children gate: cannot complete if children are incomplete
				if (updates.status === "completed") {
					const children = storage.tasks.getChildrenByParentId(targetId);
					const incompleteChildren = children.filter((c) => c.status !== "completed");
					if (incompleteChildren.length > 0) {
						throw new Error(
							`Cannot complete task [${existingTask.task_code}] "${existingTask.title}" — it has ${incompleteChildren.length} incomplete child task(s)`
						);
					}
				}
			}

			const finalUpdates: Record<string, unknown> = { ...updates };

			// Phase tag sync
			applyPhaseTagSync(updates, existingTask, finalUpdates);

			// decision_refs → metadata injection
			applyDecisionRefsToUpdates(params, existingTask, finalUpdates);

			// Remove identification fields that should not be persisted
			delete finalUpdates.ids;
			delete finalUpdates.id;
			delete finalUpdates.code;
			delete finalUpdates.json;
			delete finalUpdates.owner;
			delete finalUpdates.repo;
			delete finalUpdates.interactive;
			delete finalUpdates.tasks;
			delete finalUpdates.comment;
			delete finalUpdates.force;

			// Status timestamp management
			applyStatusTimestamps(updates, existingTask, now, finalUpdates);

			storage.tasks.updateTask(targetId, finalUpdates);

			// Insert comment if status changed or comment provided
			insertStatusComment(storage, targetId, owner, repo, updates, existingTask, isStatusChanging, comment, now);

			// Track completed tasks for later archival
			if (updates.status === "completed" && existingTask.status !== "completed") {
				completedTaskIds.push(targetId);
			}

			// Auto-release claims and expire handoffs on completion/cancellation
			const cleanup = handleCoordinationCleanup(
				storage,
				targetId,
				isStatusChanging,
				updates.status as TaskStatus | undefined
			);
			releasedClaims += cleanup.releasedClaims;
			expiredHandoffs += cleanup.expiredHandoffs;

			updatedTasks.push({
				id: targetId,
				code: existingTask.task_code
			});
		}
	})();

	// Best-effort vector embedding + KG extraction for updated tasks (if title/description changed)
	if ((params.title !== undefined || params.description !== undefined) && updatedTasks.length > 0) {
		await enrichUpdatedTasks(updatedTasks, storage, vectors);
	}

	// Build response
	const updatedCount = updatedTasks.length;
	const fieldsStr = Object.keys(updates).length > 0 ? Object.keys(updates).join(", ") : "none";
	let summaryText: string;
	if (updatedCount === 1 && updatedTasks.length === 1) {
		const extra =
			params.status === "completed"
				? ` (completed with commit ${params.commit_id}, ${(params.changed_files || []).length} files changed)`
				: "";
		summaryText = `Updated [${updatedTasks[0].code}] in repo "${params.repo}": fields ${fieldsStr}.${extra}`;
	} else {
		const tasksStr = updatedTasks.map((t) => `[${t.code}]`).join(", ");
		summaryText = `Updated ${updatedCount} tasks in repo "${params.repo}": ${tasksStr}.`;
	}
	if (releasedClaims || expiredHandoffs) {
		summaryText += ` Auto-closed coordination: released ${releasedClaims} ${releasedClaims === 1 ? "claim" : "claims"}, expired ${expiredHandoffs} ${expiredHandoffs === 1 ? "handoff" : "handoffs"}.`;
	}

	const response = createMcpResponse(
		{
			success: true,
			repo: params.repo,
			status: params.status,
			updatedCount,
			updatedFields: Object.keys(updates),
			coordinationCleanup: {
				releasedClaims,
				expiredHandoffs
			}
		},
		summaryText,
		{ includeJson: params.json }
	);

	// Archive completed tasks BEFORE the response resolves so task_archive
	// memory rows exist once the caller observes the write (deterministic —
	// no setImmediate race). Awaited under the (reentrant) write lock.
	await archiveCompletedTasks(completedTaskIds, params.repo, storage, vectors);

	return response;
}
