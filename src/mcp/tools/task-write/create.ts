import { randomUUID } from "crypto";
import { SQLiteStore } from "../../storage/sqlite";
import { Task, TaskStatus, TaskPriority, VectorStore } from "../../types";
import { createMcpResponse, McpResponse } from "../../utils/mcp-response";
import { logger } from "../../utils/logger";
import { resolveEntityCode } from "../../utils/code-generator";
import { resolveParentId, resolveDependsOn, deriveTaskStatusTimestamps } from "../task.helpers";
import { saveExtractions, saveTaskRelations } from "../kg-archivist";
import { applyDecisionRefs, tryVectorEmbedding } from "./effects";
import { WriteParams } from "./types";

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

export async function handleCreateSingle(
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
		`Created [${task.task_code}] "${task.title}" in "${task.repo}" (phase: ${task.phase}, priority: ${task.priority}, status: ${task.status}).`,
		{ includeJson: params.json }
	);
}
