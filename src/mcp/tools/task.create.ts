import { randomUUID } from "crypto";
import { SQLiteStore } from "../storage/sqlite";
import { Task, TaskStatus, TaskPriority } from "../types";
import { inferRepoFromSession } from "../session";
import { extractAcceptedElicitationContent } from "../elicitation";
import { createMcpResponse } from "../utils/mcp-response";
import { generateNextCode, resolveEntityCode } from "../utils/code-generator";
import { TaskCreateSchema, TaskCreateInteractiveSchema } from "./schemas";
import { type TaskCreateInteractiveOptions } from "../interfaces/mcp";
import { resolveParentId, resolveDependsOn, deriveTaskStatusTimestamps } from "./task.helpers";

export async function handleTaskCreate(args: unknown, storage: SQLiteStore) {
	const parsed = TaskCreateSchema.parse(args);
	const { owner, repo, tasks: bulkTasks, ...singleTask } = parsed;

	if (bulkTasks) {
		const createdTasks: string[] = [];
		const tasksToInsert: Task[] = [];
		const now = new Date().toISOString();
		const codesInRequest = new Set<string>();

		const batchCodes = new Set<string>();

		const initialStats = storage.taskStats.getTaskStats(owner, repo);
		let pendingInRequestCount = 0;

		// Pre-generate UUIDs and build local code→UUID map for cross-reference resolution
		const localCodeMap = new Map<string, string>();
		for (const taskData of bulkTasks) {
			localCodeMap.set(taskData.task_code!, randomUUID());
		}

		for (const taskData of bulkTasks) {
			const code = resolveEntityCode(taskData.task_code ?? null, owner ?? "", repo, "task", storage, { batchCodes });
			if (codesInRequest.has(code)) {
				throw new Error(`Duplicate task_code in request: '${code}'`);
			}
			codesInRequest.add(code);

			let normalizedStatus = (taskData.status as TaskStatus) || "backlog";
			if (normalizedStatus !== "backlog" && normalizedStatus !== "pending") {
				throw new Error(`New tasks must be 'backlog' or 'pending'. Task '${code}' has status '${normalizedStatus}'.`);
			}

			if (normalizedStatus === "pending") {
				if (initialStats.todo + pendingInRequestCount > 10) {
					normalizedStatus = "backlog" as TaskStatus;
				}
			}

			const statusTimestamps = deriveTaskStatusTimestamps(normalizedStatus, now);
			const tags = [...(taskData.tags || [])];
			const phaseTag = `phase:${taskData.phase}`;
			if (!tags.includes(phaseTag)) {
				tags.push(phaseTag);
			}

			const taskId = localCodeMap.get(code) ?? randomUUID();
			// Ensure the resolved code (which may differ from original after dedup) is mapped
			localCodeMap.set(code, taskId);
			const task: Task = {
				id: taskId,
				owner,
				repo,
				task_code: code,
				phase: taskData.phase,
				title: taskData.title,
				description: taskData.description,
				status: normalizedStatus,
				priority: (taskData.priority as TaskPriority) || 3,
				agent: taskData.agent || singleTask.agent || "unknown",
				role: taskData.role || singleTask.role || "unknown",
				doc_path: taskData.doc_path || null,
				created_at: now,
				updated_at: now,
				in_progress_at: statusTimestamps.in_progress_at,
				finished_at: statusTimestamps.finished_at,
				canceled_at: statusTimestamps.canceled_at,
				est_tokens: taskData.est_tokens ?? 0,
				tags: tags,
				suggested_skills: taskData.suggested_skills || [],
				commit_id: null,
				changed_files: [],
				metadata: (taskData.metadata as Record<string, unknown>) || {},
				parent_id: resolveParentId(taskData.parent_id, owner, repo, storage, localCodeMap),
				depends_on: resolveDependsOn(taskData.depends_on, owner, repo, storage, localCodeMap)
			};
			tasksToInsert.push(task);
			createdTasks.push(code);
			if (normalizedStatus === "pending") {
				pendingInRequestCount++;
			}
		}

		storage.tasks.bulkInsertTasks(tasksToInsert);

		const taskCodesStr = createdTasks.length > 0 ? `: ${createdTasks.join(", ")}` : "";
		return createMcpResponse(
			{ success: true, repo, createdCount: bulkTasks.length, taskCodes: createdTasks },
			`Created ${bulkTasks.length} tasks in repo "${repo}"${taskCodesStr}.`,
			{ includeSerializedStructuredContent: (parsed as { structured?: boolean }).structured || false }
		);
	}

	const {
		task_code,
		phase,
		title,
		description,
		status: requestedStatus,
		priority,
		agent,
		role,
		doc_path,
		metadata,
		parent_id,
		depends_on,
		est_tokens
	} = singleTask;

	if (!phase || !title || !description) {
		throw new Error("Missing required fields for single task creation (phase, title, description)");
	}

	let effectiveStatus: TaskStatus = (requestedStatus || "backlog") as TaskStatus;

	// Auto-generate or resolve task_code (with random fallback if duplicate)
	const resolvedCode = resolveEntityCode(task_code, owner ?? "", repo, "task", storage);

	if (requestedStatus !== "backlog" && requestedStatus !== "pending" && requestedStatus !== undefined) {
		throw new Error("New tasks must be created with status 'backlog' or 'pending'.");
	}

	if (requestedStatus === "pending") {
		const stats = storage.taskStats.getTaskStats(owner, repo);
		if (stats.todo > 10) {
			effectiveStatus = "backlog" as TaskStatus;
		}
	}

	const taskId = randomUUID();
	const now = new Date().toISOString();
	const statusTimestamps = deriveTaskStatusTimestamps(effectiveStatus, now);
	const finalTags = [...(singleTask.tags || [])];
	const phaseTag = `phase:${phase}`;
	if (!finalTags.includes(phaseTag)) {
		finalTags.push(phaseTag);
	}

	const task: Task = {
		id: taskId,
		owner,
		repo,
		task_code: resolvedCode,
		phase,
		title,
		description,
		status: effectiveStatus,
		priority: (priority as TaskPriority) || 3,
		agent: agent || "unknown",
		role: role || "unknown",
		doc_path: doc_path || null,
		created_at: now,
		updated_at: now,
		in_progress_at: statusTimestamps.in_progress_at,
		finished_at: statusTimestamps.finished_at,
		canceled_at: statusTimestamps.canceled_at,
		est_tokens: est_tokens ?? 0,
		tags: finalTags,
		suggested_skills: singleTask.suggested_skills || [],
		commit_id: null,
		changed_files: [],
		metadata: metadata || {},
		parent_id: resolveParentId(parent_id, owner, repo, storage),
		depends_on: resolveDependsOn(depends_on, owner, repo, storage)
	};

	storage.tasks.insertTask(task);

	return createMcpResponse(
		{
			success: true,
			id: task.id,
			repo: task.repo,
			task_code: task.task_code,
			phase: task.phase,
			title: task.title,
			status: task.status,
			priority: task.priority,
			depends_on: task.depends_on
		},
		`Created task [${task.task_code}] ${task.title} in repo "${task.repo}" with status "${task.status}".`,
		{ includeSerializedStructuredContent: (parsed as { structured?: boolean }).structured || false }
	);
}

export async function handleTaskCreateInteractive(
	args: unknown,
	storage: SQLiteStore,
	options: TaskCreateInteractiveOptions = {}
) {
	const partialTaskData = TaskCreateInteractiveSchema.parse(args ?? {});
	const inferredRepo = partialTaskData.repo ?? inferRepoFromSession(options.session);
	const draft = {
		...partialTaskData,
		repo: inferredRepo
	};

	const requestedSchema = buildMissingTaskSchema(draft);
	let completedDraft = draft;

	if (Object.keys(requestedSchema.properties).length > 0) {
		if (!options.session?.supportsElicitationForm || !options.elicit) {
			throw new Error("Client does not advertise MCP elicitation form support");
		}

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

	return await handleTaskCreate(
		{
			...completedDraft,
			status: completedDraft.status ?? "backlog",
			priority: completedDraft.priority ?? 3,
			structured: true
		},
		storage
	);
}

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
