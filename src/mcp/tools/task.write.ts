import { randomUUID } from "crypto";
import { SQLiteStore } from "../storage/sqlite";
import { Task, TaskStatus, TaskPriority, VectorStore } from "../types";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";
import { logger } from "../utils/logger";
import { TaskWriteSchema } from "./schemas";
import { UUID_REGEX } from "../utils/uuid";
import { resolveEntityCode } from "../utils/code-generator";
import { resolveParentId, resolveDependsOn, deriveTaskStatusTimestamps, archiveTaskToMemory } from "./task.helpers";
import { saveExtractions, saveTaskRelations } from "./kg-archivist";
import { extractAcceptedElicitationContent, type ElicitationRequestHandler } from "../elicitation";
import { type SessionContext } from "../session";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskWriteOptions = {
	session?: SessionContext;
	elicit?: ElicitationRequestHandler;
};

type WriteParams = {
	owner: string;
	repo: string;
	json: boolean;
	interactive?: boolean;

	// Identification (for update)
	id?: string;
	ids?: string[];
	code?: string;

	// Mutable fields
	phase?: string;
	title?: string;
	description?: string;
	status?: TaskStatus;
	priority?: number;
	agent?: string;
	role?: string;
	model?: string;
	comment?: string;
	doc_path?: string;
	tags?: string[];
	suggested_skills?: string[];
	metadata?: Record<string, unknown>;
	decision_refs?: string[];
	parent_id?: string;
	depends_on?: string;
	est_tokens?: number;
	commit_id?: string;
	changed_files?: string[];
	force?: boolean;

	// Bulk
	tasks?: Record<string, unknown>[];
};

type ItemInfer = "create" | "update";

/**
 * Infers whether a bulk item is a CREATE or UPDATE.
 * - If the item has an `id` (UUID), it's always an UPDATE.
 * - If `code` is set but none of the required CREATE fields (phase, title, description) are present,
 *   it's an UPDATE (e.g., status-only update).
 * - Otherwise (has phase + title + description, with or without code), it's a CREATE.
 */
function inferItemMode(item: Record<string, unknown>): ItemInfer {
	if (item.id) return "update";
	// If code is present but we lack the mandatory create fields → update
	if (item.code && !item.phase && !item.title && !item.description) return "update";
	return "create";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Merges decision_refs into metadata if provided.
 */
function applyDecisionRefs(
	decisionRefs: string[] | undefined,
	existingMetadata: Record<string, unknown> | undefined
): Record<string, unknown> {
	const meta = { ...(existingMetadata ?? {}) };
	if (decisionRefs !== undefined && decisionRefs.length > 0) {
		meta.decision_refs = decisionRefs;
	}
	return meta;
}

/**
 * Best-effort vector embedding for a task.
 */
async function tryVectorEmbedding(taskId: string, title: string, description: string | null, vectors: VectorStore) {
	try {
		await vectors.upsert(taskId, `${title}\n${description ?? ""}`, "task");
	} catch (error) {
		logger.warn("Failed to generate vector embedding for task", { taskId, error: String(error) });
	}
}

// ---------------------------------------------------------------------------
// Status state machine validation
// ---------------------------------------------------------------------------

/**
 * Validates that a status transition is allowed.
 * Returns the error message or null if valid.
 */
function validateStatusTransition(
	existingStatus: TaskStatus,
	newStatus: TaskStatus,
	comment: string | undefined,
	force: boolean | undefined,
	estTokens: number | undefined
): string | null {
	if (existingStatus === newStatus) return null; // no-op

	// Comment required unless force bypass
	if (!force && (!comment || comment.trim() === "")) {
		return "comment is required when changing task status";
	}

	// Validate transition paths
	const isStartable = existingStatus === "backlog" || existingStatus === "pending" || existingStatus === "blocked";

	if (isStartable && newStatus === "completed") {
		return `Cannot transition from '${existingStatus}' directly to 'completed'. Must go through 'in_progress' first.`;
	}

	if (newStatus === "completed" && (estTokens === undefined || estTokens < 0)) {
		return "est_tokens is required when changing task status to completed";
	}

	return null;
}

function validateBulkStatus(status: string | undefined): string | null {
	if (!status) return null;
	if (status !== "backlog" && status !== "pending") {
		return `New tasks must be 'backlog' or 'pending'. Got '${status}'.`;
	}
	return null;
}

// ---------------------------------------------------------------------------
// Single CREATE
// ---------------------------------------------------------------------------

function coreCreate(params: WriteParams, storage: SQLiteStore): { task: Task; code: string } {
	const { owner, repo } = params;

	if (!params.phase || !params.title || !params.description) {
		throw new Error("Missing required fields for single task creation (phase, title, description)");
	}

	const resolvedCode = resolveEntityCode(params.code ?? null, owner ?? "", repo, "task", storage);

	if (params.code && resolvedCode !== params.code) {
		throw new Error(`Task code '${params.code}' already exists`);
	}

	let effectiveStatus: TaskStatus = (params.status || "backlog") as TaskStatus;

	if (params.status !== "backlog" && params.status !== "pending" && params.status !== undefined) {
		throw new Error("New tasks must be created with status 'backlog' or 'pending'.");
	}

	if (params.status === "pending") {
		const stats = storage.taskStats.getTaskStats(owner, repo);
		if (stats.todo > 10) {
			effectiveStatus = "backlog" as TaskStatus;
		}
	}

	const taskId = randomUUID();
	const now = new Date().toISOString();
	const statusTimestamps = deriveTaskStatusTimestamps(effectiveStatus, now);
	const finalTags = [...(params.tags || [])];
	const phaseTag = `phase:${params.phase}`;
	if (!finalTags.includes(phaseTag)) {
		finalTags.push(phaseTag);
	}

	const finalMetadata = applyDecisionRefs(params.decision_refs, params.metadata);

	const task: Task = {
		id: taskId,
		owner,
		repo,
		task_code: resolvedCode,
		phase: params.phase,
		title: params.title,
		description: params.description,
		status: effectiveStatus,
		priority: (params.priority as TaskPriority) || 3,
		agent: params.agent || "unknown",
		role: params.role || "unknown",
		doc_path: params.doc_path || null,
		created_at: now,
		updated_at: now,
		in_progress_at: statusTimestamps.in_progress_at,
		finished_at: statusTimestamps.finished_at,
		canceled_at: statusTimestamps.canceled_at,
		est_tokens: params.est_tokens ?? 0,
		tags: finalTags,
		suggested_skills: params.suggested_skills || [],
		commit_id: null,
		changed_files: [],
		metadata: finalMetadata,
		parent_id: resolveParentId(params.parent_id, owner, repo, storage),
		depends_on: resolveDependsOn(params.depends_on, owner, repo, storage)
	};

	storage.tasks.insertTask(task);

	return { task, code: resolvedCode };
}

async function handleCreateSingle(
	params: WriteParams,
	storage: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	const { task } = coreCreate(params, storage);

	// Best-effort vector embedding on create
	await tryVectorEmbedding(task.id, task.title, task.description, vectors);

	// Best-effort KG entity/relation extraction
	try {
		await saveExtractions(`${task.title}\n${task.description ?? ""}`, task.title, task.owner, task.repo, storage);
	} catch (error) {
		logger.warn("[KG-Archivist] NLP extraction failed, task stored without KG enrichment", { error: String(error) });
	}

	// Best-effort KG semantic relations (parent_id→depends_on, decision_refs→inspired_by)
	try {
		await saveTaskRelations(`${task.title}\n${task.description ?? ""}`, task.title, task.owner, task.repo, storage, {
			parentId: task.parent_id,
			decisionRefs: (task.metadata?.decision_refs as string[]) ?? undefined
		});
	} catch (error) {
		logger.warn("[KG-Archivist] Task semantic relations failed, task stored without KG relations", {
			error: String(error)
		});
	}

	return createMcpResponse(
		{
			success: true,
			id: task.id,
			repo: task.repo,
			task_code: task.task_code,
			code: task.task_code,
			phase: task.phase,
			title: task.title,
			status: task.status,
			priority: task.priority,
			depends_on: task.depends_on
		},
		`Created [${task.task_code}] "${task.title}" in repo "${task.repo}" (status: ${task.status}).`,
		{ includeJson: params.json }
	);
}

// ---------------------------------------------------------------------------
// Single UPDATE
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
}> {
	const { owner, repo, id, comment, force } = params;

	// Build the set of updates (exclude identification/control fields)
	const { status, phase, tags, agent, role, model, est_tokens, commit_id, changed_files, ...restUpdates } = params;
	const updates: Record<string, unknown> = { ...restUpdates };
	if (status !== undefined) updates.status = status;
	if (phase !== undefined) updates.phase = phase;
	if (tags !== undefined) updates.tags = tags;
	if (agent !== undefined) updates.agent = agent;
	if (role !== undefined) updates.role = role;
	if (model !== undefined) updates.model = model;
	if (est_tokens !== undefined) updates.est_tokens = est_tokens;
	if (commit_id !== undefined) updates.commit_id = commit_id;
	if (changed_files !== undefined) updates.changed_files = changed_files;

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
			finalUpdates.depends_on = resolveDependsOn(updates.depends_on as string | null | undefined, owner, repo, storage);
		}

		// Phase tag sync
		if (updates.phase !== undefined || updates.tags !== undefined) {
			let currentTags = (updates.tags as string[]) || (existingTask.tags as string[]) || [];
			currentTags = currentTags.filter((t: string) => !t.startsWith("phase:"));
			const finalPhase = updates.phase !== undefined ? (updates.phase as string) : existingTask.phase;
			if (finalPhase) {
				const phaseTag = `phase:${finalPhase}`;
				if (!currentTags.includes(phaseTag)) {
					currentTags.push(phaseTag);
				}
			}
			finalUpdates.tags = currentTags;
		}

		// decision_refs → metadata injection
		if (params.decision_refs !== undefined) {
			const currentMetadata = { ...(existingTask.metadata ?? {}) };
			currentMetadata.decision_refs = params.decision_refs;
			finalUpdates.metadata = currentMetadata;
		}

		// Status timestamp management
		if (updates.status === "completed") {
			finalUpdates.finished_at = now;
			finalUpdates.commit_id = updates.commit_id;
			finalUpdates.changed_files = updates.changed_files;
		} else if (updates.status === "canceled") {
			finalUpdates.canceled_at = now;
		} else if (updates.status === "in_progress" && existingTask.status !== "in_progress") {
			finalUpdates.in_progress_at = now;
		}

		storage.tasks.updateTask(targetId, finalUpdates);

		// Insert comment if status changed or comment provided
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

		// Track completed tasks for later archival
		if (updates.status === "completed" && existingTask.status !== "completed") {
			completedTaskIds.push(targetId);
		}

		// Auto-release claims and expire handoffs on completion/cancellation
		if (isStatusChanging && (updates.status === "completed" || updates.status === "canceled")) {
			releasedClaims += storage.handoffs.releaseClaimsForTask(targetId);
			expiredHandoffs += storage.handoffs.updatePendingHandoffsForTask(targetId, "expired");
		}

		updatedTasks.push({
			id: targetId,
			code: (updates.task_code as string) || existingTask.task_code
		});
		updatedCount++;
	}

	// Best-effort vector embedding + KG extraction for updated tasks (if title/description changed)
	if ((params.title !== undefined || params.description !== undefined) && updatedCount > 0) {
		for (const { id: taskId } of updatedTasks) {
			const task = storage.tasks.getTaskById(taskId);
			if (task) {
				await tryVectorEmbedding(taskId, task.title, task.description, vectors);
				try {
					await saveExtractions(`${task.title}\n${task.description ?? ""}`, task.title, task.owner, task.repo, storage);
				} catch (error) {
					logger.warn("[KG-Archivist] NLP extraction failed for updated task", { error: String(error) });
				}
				try {
					await saveTaskRelations(
						`${task.title}\n${task.description ?? ""}`,
						task.title,
						task.owner,
						task.repo,
						storage,
						{
							parentId: task.parent_id,
							decisionRefs: (task.metadata?.decision_refs as string[]) ?? undefined
						}
					);
				} catch (error) {
					logger.warn("[KG-Archivist] Task semantic relations failed for updated task", {
						error: String(error)
					});
				}
			}
		}
	}

	return {
		updatedCount,
		updatedTasks,
		completedTaskIds,
		releasedClaims,
		expiredHandoffs,
		updatedFields: Object.keys(updates)
	};
}

async function handleUpdate(params: WriteParams, storage: SQLiteStore, vectors: VectorStore): Promise<McpResponse> {
	const { updatedCount, updatedTasks, completedTaskIds, releasedClaims, expiredHandoffs, updatedFields } =
		await coreUpdate(params, storage, vectors);

	const fieldsStr = updatedFields.length > 0 ? updatedFields.join(", ") : "none";
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

	// Archive completed tasks AFTER returning response (vector embedding is slow, non-blocking)
	if (completedTaskIds.length > 0) {
		setImmediate(async () => {
			for (const taskId of completedTaskIds) {
				try {
					await archiveTaskToMemory(taskId, params.repo, storage, vectors);
				} catch (err) {
					logger.error("Failed to archive task to memory", { taskId, error: String(err) });
				}
			}
		});
	}

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
async function handleBulkUpdateByIds(
	params: WriteParams,
	storage: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	const { owner, repo, ids, comment, force } = params;
	if (!ids || ids.length === 0) {
		throw new Error("No task IDs provided for bulk update");
	}

	// Build the set of updates (exclude identification/control fields)
	const { status, phase, tags, agent, role, model, est_tokens, commit_id, changed_files, ...restUpdates } = params;
	const updates: Record<string, unknown> = { ...restUpdates };
	if (status !== undefined) updates.status = status;
	if (phase !== undefined) updates.phase = phase;
	if (tags !== undefined) updates.tags = tags;
	if (agent !== undefined) updates.agent = agent;
	if (role !== undefined) updates.role = role;
	if (model !== undefined) updates.model = model;
	if (est_tokens !== undefined) updates.est_tokens = est_tokens;
	if (commit_id !== undefined) updates.commit_id = commit_id;
	if (changed_files !== undefined) updates.changed_files = changed_files;

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
		if (updates.phase !== undefined || updates.tags !== undefined) {
			let currentTags = (updates.tags as string[]) || (existingTask.tags as string[]) || [];
			currentTags = currentTags.filter((t: string) => !t.startsWith("phase:"));
			const finalPhase = updates.phase !== undefined ? (updates.phase as string) : existingTask.phase;
			if (finalPhase) {
				const phaseTag = `phase:${finalPhase}`;
				if (!currentTags.includes(phaseTag)) {
					currentTags.push(phaseTag);
				}
			}
			finalUpdates.tags = currentTags;
		}

		// decision_refs → metadata injection
		if (params.decision_refs !== undefined) {
			const currentMetadata = { ...(existingTask.metadata ?? {}) };
			currentMetadata.decision_refs = params.decision_refs;
			finalUpdates.metadata = currentMetadata;
		}

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
		if (updates.status === "completed") {
			finalUpdates.finished_at = now;
		} else if (updates.status === "canceled") {
			finalUpdates.canceled_at = now;
		} else if (updates.status === "in_progress" && existingTask.status !== "in_progress") {
			finalUpdates.in_progress_at = now;
		}

		storage.tasks.updateTask(targetId, finalUpdates);

		// Insert comment if status changed or comment provided
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

		// Track completed tasks for later archival
		if (updates.status === "completed" && existingTask.status !== "completed") {
			completedTaskIds.push(targetId);
		}

		// Auto-release claims and expire handoffs on completion/cancellation
		if (isStatusChanging && (updates.status === "completed" || updates.status === "canceled")) {
			releasedClaims += storage.handoffs.releaseClaimsForTask(targetId);
			expiredHandoffs += storage.handoffs.updatePendingHandoffsForTask(targetId, "expired");
		}

		updatedTasks.push({
			id: targetId,
			code: existingTask.task_code
		});
	}

	// Best-effort vector embedding + KG extraction for updated tasks (if title/description changed)
	if ((params.title !== undefined || params.description !== undefined) && updatedTasks.length > 0) {
		for (const { id: taskId } of updatedTasks) {
			const task = storage.tasks.getTaskById(taskId);
			if (task) {
				await tryVectorEmbedding(taskId, task.title, task.description, vectors);
				try {
					await saveExtractions(`${task.title}\n${task.description ?? ""}`, task.title, task.owner, task.repo, storage);
				} catch (error) {
					logger.warn("[KG-Archivist] NLP extraction failed for updated task", { error: String(error) });
				}
				try {
					await saveTaskRelations(
						`${task.title}\n${task.description ?? ""}`,
						task.title,
						task.owner,
						task.repo,
						storage,
						{
							parentId: task.parent_id,
							decisionRefs: (task.metadata?.decision_refs as string[]) ?? undefined
						}
					);
				} catch (error) {
					logger.warn("[KG-Archivist] Task semantic relations failed for updated task", {
						error: String(error)
					});
				}
			}
		}
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

	// Archive completed tasks AFTER returning response
	if (completedTaskIds.length > 0) {
		setImmediate(async () => {
			for (const taskId of completedTaskIds) {
				try {
					await archiveTaskToMemory(taskId, params.repo, storage, vectors);
				} catch (err) {
					logger.error("Failed to archive task to memory", { taskId, error: String(err) });
				}
			}
		});
	}

	return response;
}

// ---------------------------------------------------------------------------
// INTERACTIVE (Elicitation)
// ---------------------------------------------------------------------------

function buildMissingTaskSchema(task: Record<string, unknown>) {
	const properties: Record<string, unknown> = {};
	const required: string[] = [];

	addRequiredStringField(properties, required, task, "repo", {
		title: "Repository",
		description: "Name of the repository for this task.",
		minLength: 1
	});
	addRequiredStringField(properties, required, task, "phase", {
		title: "Phase",
		description: "Project phase or milestone for this task.",
		minLength: 1
	});
	addRequiredStringField(properties, required, task, "title", {
		title: "Title",
		description: "Short task title.",
		minLength: 3,
		maxLength: 100
	});
	addRequiredStringField(properties, required, task, "description", {
		title: "Description",
		description:
			"Detailed description. MUST follow format: 1. Context & Analysis, 2. Step & Implementation, 3. Acceptance & Verification",
		minLength: 1
	});

	if (!task.status) {
		properties.status = {
			type: "string",
			title: "Status",
			description: "Initial task status.",
			enum: ["backlog", "pending"],
			default: "backlog"
		};
	}

	if (task.priority === undefined) {
		properties.priority = {
			type: "integer",
			title: "Priority",
			description: "Task priority from 1 to 5.",
			minimum: 1,
			maximum: 5,
			default: 3
		};
	}

	return {
		type: "object" as const,
		properties,
		required
	};
}

function addRequiredStringField(
	properties: Record<string, unknown>,
	required: string[],
	task: Record<string, unknown>,
	field: string,
	schema: Record<string, unknown>
) {
	if (typeof task[field] === "string" && (task[field] as string).trim()) {
		return;
	}
	properties[field] = {
		type: "string",
		...schema
	};
	required.push(field);
}

async function handleInteractive(
	params: WriteParams,
	storage: SQLiteStore,
	vectors: VectorStore,
	options: TaskWriteOptions
): Promise<McpResponse> {
	if (!options.session?.supportsElicitationForm || !options.elicit) {
		throw new Error(
			"Client does not advertise MCP elicitation form support. Provide all required fields directly: phase, title, description."
		);
	}

	const draft: Record<string, unknown> = {
		...(params as unknown as Record<string, unknown>),
		repo: params.repo || options.session?.repo || ""
	};

	const requestedSchema = buildMissingTaskSchema(draft);
	let completedDraft = draft;

	if (Object.keys(requestedSchema.properties).length > 0) {
		const elicited = extractAcceptedElicitationContent(
			await options.elicit({
				mode: "form",
				message: "Please complete the missing task details to create a new task.",
				requestedSchema
			})
		);

		completedDraft = {
			...draft,
			...elicited
		};
	}

	// Now proceed with create using completed data
	const createParams: WriteParams = {
		...params,
		owner: params.owner || (completedDraft.owner as string) || "",
		repo: params.repo || (completedDraft.repo as string) || "",
		phase: completedDraft.phase as string,
		title: completedDraft.title as string,
		description: completedDraft.description as string,
		status: (completedDraft.status as TaskStatus) || "backlog",
		priority: (completedDraft.priority as number) || 3,
		json: true
	};

	return handleCreateSingle(createParams, storage, vectors);
}

// ---------------------------------------------------------------------------
// BULK — each item infers create vs update independently
// ---------------------------------------------------------------------------

async function handleBulk(params: WriteParams, storage: SQLiteStore, vectors: VectorStore): Promise<McpResponse> {
	const items = params.tasks ?? [];
	const results: Record<string, unknown>[] = [];
	const owner = params.owner;
	const repo = params.repo;

	const initialStats = storage.taskStats.getTaskStats(owner, repo);
	let pendingInRequestCount = 0;
	const codesInRequest = new Set<string>();
	const batchCodes = new Set<string>();

	// Pre-generate UUIDs and build local code→UUID map for cross-reference resolution
	const localCodeMap = new Map<string, string>();
	for (const taskData of items) {
		const tc = (taskData.code as string) || (taskData.id as string) || "";
		if (tc) localCodeMap.set(tc, randomUUID());
		if (!tc) localCodeMap.set("__create_" + Math.random().toString(36).slice(2, 8), randomUUID());
	}

	for (let i = 0; i < items.length; i++) {
		const raw = items[i];
		const mode = inferItemMode(raw);

		try {
			if (mode === "update") {
				// ── Update item ──
				const itemCode = raw.code as string | undefined;
				const itemId = raw.id as string | undefined;

				// Resolve to UUID
				let resolvedId: string | undefined;
				if (itemId && UUID_REGEX.test(itemId)) {
					resolvedId = itemId;
				} else if (itemCode) {
					const found = storage.tasks.getTaskByCode(owner, repo, itemCode);
					if (!found) throw new Error(`Task not found by code: ${itemCode}`);
					resolvedId = found.id;
				} else if (itemId) {
					const found = storage.tasks.getTaskByCode(owner, repo, itemId);
					if (!found) throw new Error(`Task not found by code: ${itemId}`);
					resolvedId = found.id;
				}

				if (!resolvedId) throw new Error("Cannot update: neither 'id' nor 'code' resolved to an existing task");

				const existing = storage.tasks.getTaskById(resolvedId);
				if (!existing) throw new Error(`Task not found: ${resolvedId}`);

				// Build updates
				const updatableFields = [
					"phase",
					"title",
					"description",
					"status",
					"priority",
					"agent",
					"role",
					"tags",
					"metadata",
					"parent_id",
					"depends_on",
					"est_tokens",
					"commit_id",
					"changed_files",
					"decision_refs"
				] as const;

				const itemUpdates: Record<string, unknown> = {};
				for (const field of updatableFields) {
					if (raw[field] !== undefined) {
						itemUpdates[field] = raw[field];
					}
				}

				if (Object.keys(itemUpdates).length === 0) {
					throw new Error("No updatable fields provided for update item");
				}

				// Handle status transition
				if (itemUpdates.status !== undefined && itemUpdates.status !== existing.status) {
					const err = validateStatusTransition(
						existing.status,
						itemUpdates.status as TaskStatus,
						raw.comment as string | undefined,
						raw.force as boolean | undefined,
						itemUpdates.est_tokens as number | undefined
					);
					if (err) throw new Error(err);

					// Children gate for completed
					if (itemUpdates.status === "completed") {
						const children = storage.tasks.getChildrenByParentId(resolvedId);
						const incomplete = children.filter((c) => c.status !== "completed");
						if (incomplete.length > 0) {
							throw new Error(
								`Cannot complete task [${existing.task_code}] — ${incomplete.length} incomplete child task(s)`
							);
						}
					}
				}

				// Phase tag sync
				if (itemUpdates.phase !== undefined || itemUpdates.tags !== undefined) {
					let currentTags = (itemUpdates.tags as string[]) || (existing.tags as string[]) || [];
					currentTags = currentTags.filter((t: string) => !t.startsWith("phase:"));
					const finalPhase = itemUpdates.phase !== undefined ? (itemUpdates.phase as string) : existing.phase;
					if (finalPhase) {
						const phaseTag = `phase:${finalPhase}`;
						if (!currentTags.includes(phaseTag)) currentTags.push(phaseTag);
					}
					itemUpdates.tags = currentTags;
				}

				// decision_refs
				if (raw.decision_refs !== undefined) {
					const meta = { ...(existing.metadata ?? {}) };
					meta.decision_refs = raw.decision_refs;
					itemUpdates.metadata = meta;
				}

				const now = new Date().toISOString();
				if (itemUpdates.status === "completed") {
					itemUpdates.finished_at = now;
				} else if (itemUpdates.status === "canceled") {
					itemUpdates.canceled_at = now;
				} else if (itemUpdates.status === "in_progress" && existing.status !== "in_progress") {
					itemUpdates.in_progress_at = now;
				}

				storage.tasks.updateTask(resolvedId, itemUpdates);

				// Comment insertion
				if (itemUpdates.status !== undefined && itemUpdates.status !== existing.status) {
					storage.taskComments.insertTaskComment({
						id: randomUUID(),
						task_id: resolvedId,
						owner,
						repo,
						comment: (raw.comment as string) || `Status updated to ${itemUpdates.status}`,
						agent: (raw.agent as string) || existing.agent || "unknown",
						role: (raw.role as string) || existing.role || "unknown",
						model: (raw.model as string) || "unknown",
						previous_status: existing.status as TaskStatus,
						next_status: itemUpdates.status as TaskStatus,
						created_at: now
					});
				}

				// Claims/handoffs cleanup
				if (itemUpdates.status === "completed" || itemUpdates.status === "canceled") {
					storage.handoffs.releaseClaimsForTask(resolvedId);
					storage.handoffs.updatePendingHandoffsForTask(resolvedId, "expired");
				}

				// Async archive for completed
				if (itemUpdates.status === "completed" && existing.status !== "completed") {
					setImmediate(async () => {
						try {
							await archiveTaskToMemory(resolvedId, repo, storage, vectors);
						} catch (err) {
							logger.error("Failed to archive task to memory", { taskId: resolvedId, error: String(err) });
						}
					});
				}

				results.push({
					index: i,
					operation: "update",
					success: true,
					id: resolvedId,
					code: existing.task_code,
					updatedFields: Object.keys(itemUpdates)
				});
			} else {
				// ── Create item ──
				const preferredCode = (raw.code as string) || "";
				if (preferredCode && codesInRequest.has(preferredCode)) {
					throw new Error(`Duplicate task_code in request: '${preferredCode}'`);
				}

				const assignedCode = resolveEntityCode(preferredCode || null, owner ?? "", repo, "task", storage, {
					batchCodes
				});

				if (preferredCode && assignedCode !== preferredCode) {
					throw new Error(`Task code '${preferredCode}' already exists`);
				}

				codesInRequest.add(assignedCode);
				batchCodes.add(assignedCode);

				const phase = raw.phase as string;
				const title = raw.title as string;
				const description = raw.description as string;

				if (!phase || !title || !description) {
					throw new Error("Missing required fields for create (phase, title, description)");
				}

				let normalizedStatus = (raw.status as TaskStatus) || "backlog";
				const statusErr = validateBulkStatus(raw.status as string | undefined);
				if (statusErr) throw new Error(statusErr);

				if (normalizedStatus === "pending") {
					if (initialStats.todo + pendingInRequestCount > 10) {
						normalizedStatus = "backlog" as TaskStatus;
					}
				}

				const now = new Date().toISOString();
				const statusTimestamps = deriveTaskStatusTimestamps(normalizedStatus, now);
				const tags = [...((raw.tags as string[]) || [])];
				const phaseTag = `phase:${phase}`;
				if (!tags.includes(phaseTag)) {
					tags.push(phaseTag);
				}

				const taskId = localCodeMap.get(assignedCode) ?? randomUUID();
				localCodeMap.set(assignedCode, taskId);

				const finalMetadata = applyDecisionRefs(
					raw.decision_refs as string[] | undefined,
					raw.metadata as Record<string, unknown> | undefined
				);

				const task: Task = {
					id: taskId,
					owner,
					repo,
					task_code: assignedCode,
					phase,
					title,
					description,
					status: normalizedStatus,
					priority: (raw.priority as TaskPriority) || 3,
					agent: (raw.agent as string) || "unknown",
					role: (raw.role as string) || "unknown",
					doc_path: (raw.doc_path as string) || null,
					created_at: now,
					updated_at: now,
					in_progress_at: statusTimestamps.in_progress_at,
					finished_at: statusTimestamps.finished_at,
					canceled_at: statusTimestamps.canceled_at,
					est_tokens: (raw.est_tokens as number) ?? 0,
					tags,
					suggested_skills: (raw.suggested_skills as string[]) || [],
					commit_id: null,
					changed_files: [],
					metadata: finalMetadata,
					parent_id: resolveParentId(raw.parent_id as string | null | undefined, owner, repo, storage, localCodeMap),
					depends_on: resolveDependsOn(raw.depends_on as string | null | undefined, owner, repo, storage, localCodeMap)
				};

				storage.tasks.insertTask(task);

				// Best-effort vector embedding (fire-and-forget to avoid sequential hang)
				setImmediate(async () => {
					try {
						await tryVectorEmbedding(task.id, task.title, task.description, vectors);
					} catch (err) {
						logger.warn("Failed to generate vector embedding for bulk task", { taskId: task.id, error: String(err) });
					}
				});

				// Best-effort KG extraction (fire-and-forget to avoid sequential NLP overhead)
				setImmediate(async () => {
					try {
						await saveExtractions(
							`${task.title}\n${task.description ?? ""}`,
							task.title,
							task.owner,
							task.repo,
							storage
						);
					} catch (error) {
						logger.warn("[KG-Archivist] NLP extraction failed", { error: String(error) });
					}
					try {
						await saveTaskRelations(
							`${task.title}\n${task.description ?? ""}`,
							task.title,
							task.owner,
							task.repo,
							storage,
							{
								parentId: task.parent_id,
								decisionRefs: (task.metadata?.decision_refs as string[]) ?? undefined
							}
						);
					} catch (error) {
						logger.warn("[KG-Archivist] Task semantic relations failed for bulk task", {
							error: String(error)
						});
					}
				});

				results.push({
					index: i,
					operation: "create",
					success: true,
					id: task.id,
					code: assignedCode,
					title,
					repo
				});

				if (normalizedStatus === "pending") {
					pendingInRequestCount++;
				}
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			results.push({
				index: i,
				operation: mode,
				success: false,
				error: msg
			});
		}
	}

	const succeeded = results.filter((r) => r.success);
	const failed = results.filter((r) => !r.success);
	const allOk = failed.length === 0;

	// If any item failed, the MCP response should indicate error
	// When something fails, return error response so MCP layer correctly signals isError
	if (!allOk) {
		if (items.length === failed.length) {
			// All items failed — throw the first error for clear signal
			throw new Error(failed[0].error as string);
		}
		// Partial failure — return error response with results
		return {
			isError: true,
			content: [
				{
					type: "text",
					text: `Processed ${succeeded.length}/${items.length} in repo "${repo}" (${failed.length} failed). Errors: ${failed.map((r) => `[${r.index}] ${r.error}`).join("; ")}`
				}
			],
			structuredContent: {
				success: false,
				repo,
				total: items.length,
				createdCount: succeeded.length,
				errors: failed.map((r) => ({ index: r.index, error: r.error })),
				results: results.map((r) => {
					const res: Record<string, unknown> = { index: r.index, operation: r.operation, success: r.success };
					if (r.id) res.id = r.id;
					if (r.code) res.code = r.code;
					if (r.title) res.title = r.title;
					if (r.error) res.error = r.error;
					if (r.updatedFields) res.updatedFields = r.updatedFields;
					return res;
				})
			}
		};
	}

	// Build summary text matching test expectations
	const createCount = results.filter((r) => r.operation === "create" && r.success).length;
	const updateCount = results.filter((r) => r.operation === "update" && r.success).length;
	let summaryText: string;
	if (updateCount === 0) {
		summaryText = `Created ${createCount} ${createCount === 1 ? "task" : "tasks"} in repo "${repo}".`;
	} else if (createCount === 0) {
		summaryText = `Updated ${updateCount} ${updateCount === 1 ? "task" : "tasks"} in repo "${repo}".`;
	} else {
		summaryText = `Processed ${createCount} creates + ${updateCount} updates in repo "${repo}".`;
	}

	return createMcpResponse(
		{
			success: true,
			repo,
			total: items.length,
			createdCount: succeeded.length,
			results: results.map((r) => {
				const res: Record<string, unknown> = { index: r.index, operation: r.operation, success: r.success };
				if (r.id) res.id = r.id;
				if (r.code) res.code = r.code;
				if (r.title) res.title = r.title;
				if (r.error) res.error = r.error;
				if (r.updatedFields) res.updatedFields = r.updatedFields;
				return res;
			})
		},
		summaryText,
		{ includeJson: params.json }
	);
}

// ---------------------------------------------------------------------------
// Main handler entry point
// ---------------------------------------------------------------------------

/**
 * Unified task write handler.
 *
 * **Auto-infer logic (in order of precedence):**
 *   1. `tasks: [...]`            → BULK  — each item infers independently
 *   2. `interactive: true`       → INTERACTIVE — elicit missing fields from user (via form)
 *   3. `phase`+`title`+`desc`    → CREATE (optionally with `code`/`task_code` for custom code)
 *   4. `id` or `code` present    → UPDATE (id=UUID, code=string code)
 *
 * **Status state machine:** backlog ↔ pending ↔ in_progress ↔ completed/canceled/blocked
 *   - comment required on status change
 *   - completed: children MUST be completed first (gate)
 *   - completed: auto-release claims + expire linked handoffs
 *   - canceled: auto-release claims + expire handoffs
 *   - Completed tasks are archived to memory (async after response)
 *
 * **Bulk partial execution:** items that fail are skipped, errors returned in response.
 */
export async function handleTaskWrite(
	args: Record<string, unknown>,
	storage: SQLiteStore,
	vectors: VectorStore,
	options: TaskWriteOptions = {}
): Promise<McpResponse> {
	const parsed = TaskWriteSchema.parse(args) as unknown as WriteParams;

	// ── 1. BULK mode ──
	if (parsed.tasks && parsed.tasks.length > 0) {
		return handleBulk(parsed, storage, vectors);
	}

	// ── 2. INTERACTIVE mode ──
	if (parsed.interactive) {
		return handleInteractive(parsed, storage, vectors, options);
	}

	// ── 2b. BULK UPDATE by ids (array of UUIDs) ──
	if (parsed.ids && parsed.ids.length > 0) {
		return handleBulkUpdateByIds(parsed, storage, vectors);
	}

	// ── 3. CREATE mode: phase + title + description (optionally with code/task_code) ──
	// Check CREATE before code-only UPDATE since task_code is now aliased to code
	if (parsed.phase && parsed.title && parsed.description) {
		return handleCreateSingle(parsed, storage, vectors);
	}

	// ── 4. UPDATE mode: id or code present ──
	if (parsed.id || parsed.code) {
		return handleUpdate(parsed, storage, vectors);
	}

	// ── Nothing matched ──
	throw new Error(
		"Could not infer operation. Provide:\n" +
			"  - `phase` + `title` + `description` for CREATE\n" +
			"  - `id` (UUID) or `code` + fields for UPDATE\n" +
			"  - `id` or `code` + `status` for STATUS UPDATE\n" +
			"  - `interactive: true` for guided creation\n" +
			"  - `tasks[]` for BULK create/update"
	);
}
