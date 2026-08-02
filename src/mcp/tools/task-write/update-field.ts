import { SQLiteStore } from "../../storage/sqlite";
import { Task, VectorStore } from "../../types";
import { enqueueTask } from "../../embedding-queue";
import { TaskWriteParams } from "./types";

// ---------------------------------------------------------------------------
// Field-level update logic, validation
// ---------------------------------------------------------------------------

/**
 * Builds the set of updatable fields from params, excluding control fields.
 */
export function buildUpdatesFromParams(params: TaskWriteParams): Record<string, unknown> {
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
	return updates;
}

/**
 * Syncs the `phase:` prefix tag whenever phase or tags are updated.
 * Modifies finalUpdates.tags in place.
 */
export function applyPhaseTagSync(
	updates: Record<string, unknown>,
	existingTask: Task,
	finalUpdates: Record<string, unknown>
): void {
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
}

/**
 * Injects decision_refs into metadata if provided.
 * Modifies finalUpdates.metadata in place.
 */
export function applyDecisionRefsToUpdates(
	params: TaskWriteParams,
	existingTask: Task,
	finalUpdates: Record<string, unknown>
): void {
	if (params.decision_refs !== undefined) {
		const currentMetadata = { ...(existingTask.metadata ?? {}) };
		currentMetadata.decision_refs = params.decision_refs;
		finalUpdates.metadata = currentMetadata;
	}
}

/**
 * Enqueue embedding/KG jobs for updated tasks (if title/description changed).
 * Synchronous LWW upsert — enrichment runs via the outbox worker (TASK-013),
 * off the write-lock critical path. Signature retained for callers; the
 * `vectors` instance is no longer used here.
 */
export async function enrichUpdatedTasks(
	updatedTasks: { id: string }[],
	storage: SQLiteStore,
	_vectors: VectorStore
): Promise<void> {
	for (const { id: taskId } of updatedTasks) {
		const task = storage.tasks.getTaskById(taskId);
		if (task) {
			enqueueTask(storage, task);
		}
	}
}
