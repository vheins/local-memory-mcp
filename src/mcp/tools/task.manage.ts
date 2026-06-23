import { randomUUID } from "crypto";
import { SQLiteStore } from "../storage/sqlite";
import { Task, TaskStatus, TaskPriority, VectorStore } from "../types";
import { inferRepoFromSession } from "../session";
import { extractAcceptedElicitationContent } from "../elicitation";
import { createMcpResponse } from "../utils/mcp-response";
import { logger } from "../utils/logger";
import { generateNextCode } from "../utils/code-generator";
import {
	TaskCreateSchema,
	TaskCreateInteractiveSchema,
	TaskUpdateSchema,
	TaskDeleteSchema,
	TaskListSchema
} from "./schemas";
import { handleMemoryStore } from "./memory.store";
import { type TaskCreateInteractiveOptions } from "../interfaces/mcp";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves a parent_id value that is either a UUID or a task_code string.
 * Returns the resolved UUID, or throws if the task cannot be found.
 * An optional localCodeMap is checked first for cross-references within the same batch.
 */
function resolveParentId(
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

function resolveDependsOn(
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

function describeTaskListFilter(status?: string) {
	if (!status) return "active";
	if (status === "all") return "all";

	const labels = status
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean)
		.map((part) => {
			switch (part) {
				case "in_progress":
					return "in progress";
				default:
					return part;
			}
		});

	if (labels.length === 0) return "active";
	if (labels.length === 1) return labels[0];
	if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
	return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

function buildTaskListSummary(
	repo: string,
	count: number,
	status?: string,
	phase?: string,
	search?: string,
	tasksByStatus?: Record<string, Task[]>
) {
	const filterLabel = describeTaskListFilter(status);
	const taskLabel = count === 1 ? "task" : "tasks";
	const parts: string[] = [];

	if (tasksByStatus && Object.keys(tasksByStatus).length > 0) {
		parts.push("Current Available Tasks:");
		for (const [taskStatus, items] of Object.entries(tasksByStatus)) {
			if (items.length > 0) {
				parts.push("");
				parts.push(`${capitalize(taskStatus)}:`);
				parts.push("- code|status|priority|phase|last_updated|title");
				for (const t of items) {
					const lastUpdated = t.updated_at ? t.updated_at.slice(0, 16).replace("T", " ") : "never";
					parts.push(`- ${t.task_code}|${t.status}|${t.priority}|${t.phase}|${lastUpdated}|${t.title}`);
				}
			}
		}
	} else {
		parts.push(`Found ${count} ${filterLabel} ${taskLabel} in repo "${repo}".`);
	}

	if (phase || search) {
		parts.push("");
		if (phase) parts.push(`Phase filter: ${phase}.`);
		if (search) parts.push(`Search filter: "${search}".`);
	}

	parts.push("");
	parts.push("See task-detail with task_code for details.");

	return parts.join("\n").trim();
}

function capitalize(str: string): string {
	return str.charAt(0).toUpperCase() + str.slice(1);
}

function deriveTaskStatusTimestamps(status: TaskStatus, now: string, existingTask?: { status: TaskStatus }) {
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

export async function handleTaskList(args: unknown, storage: SQLiteStore) {
	const validated = TaskListSchema.parse(args);
	const {
		owner,
		repo,
		status = "backlog,pending,in_progress,blocked",
		phase,
		query,
		limit,
		offset,
		structured: isStructuredRequest = false
	} = validated;

	let statuses: string[] = [];
	if (status !== "all") {
		statuses = status
			.split(",")
			.map((s: string) => s.trim())
			.filter(Boolean);
	}

	const tasks = storage.tasks.getTasksByMultipleStatuses(owner, repo, statuses, limit, offset, query);
	const filteredTasks = phase ? tasks.filter((t: Task) => t.phase.toLowerCase() === phase.toLowerCase()) : tasks;

	const COLUMNS = ["id", "task_code", "title", "status", "priority", "updated_at", "comments_count"] as const;
	const rows = filteredTasks.map((t: Task & { comments_count?: number }) => [
		t.id,
		t.task_code,
		t.title,
		t.status,
		t.priority,
		t.updated_at,
		t.comments_count || 0
	]);

	const structuredData = {
		schema: "task-list" as const,
		tasks: {
			columns: [...COLUMNS],
			rows
		},
		count: rows.length,
		offset
	};

	let contentSummary: string | undefined;
	if (!isStructuredRequest) {
		const tasksByStatus: Record<string, Task[]> = {};
		for (const t of filteredTasks) {
			const statusLabel = t.status === "in_progress" ? "In Progress" : capitalize(t.status);
			if (!tasksByStatus[statusLabel]) {
				tasksByStatus[statusLabel] = [];
			}
			tasksByStatus[statusLabel].push(t);
		}
		contentSummary = buildTaskListSummary(repo, rows.length, status, phase, query, tasksByStatus);
	}

	return createMcpResponse(structuredData, contentSummary || "", {
		contentSummary,
		includeSerializedStructuredContent: isStructuredRequest
	});
}

export async function handleTaskCreate(args: unknown, storage: SQLiteStore) {
	const parsed = TaskCreateSchema.parse(args);
	const { owner, repo, tasks: bulkTasks, ...singleTask } = parsed;

	if (bulkTasks) {
		const createdTasks: string[] = [];
		const tasksToInsert: Task[] = [];
		const now = new Date().toISOString();
		const codesInRequest = new Set<string>();

		// First pass: auto-generate sequential codes for tasks missing a task_code
		const batchCodes = new Set<string>();
		for (const taskData of bulkTasks) {
			if (!taskData.task_code) {
				taskData.task_code = generateNextCode(owner ?? "", repo, "task", storage, batchCodes);
			}
			batchCodes.add(taskData.task_code);
		}

		// Batch duplicate check: single query instead of N
		const allCodes = bulkTasks.map((t) => t.task_code as string);
		const existingCodes = storage.tasks.getExistingTaskCodes(owner, repo, allCodes);

		const initialStats = storage.taskStats.getTaskStats(owner, repo);
		let pendingInRequestCount = 0;

		// Pre-generate UUIDs and build local code→UUID map for cross-reference resolution
		const localCodeMap = new Map<string, string>();
		for (const taskData of bulkTasks) {
			localCodeMap.set(taskData.task_code!, randomUUID());
		}

		for (const taskData of bulkTasks) {
			const code = taskData.task_code!;
			if (codesInRequest.has(code)) {
				throw new Error(`Duplicate task_code in request: '${code}'`);
			}
			if (existingCodes.has(code)) {
				throw new Error(`Duplicate task_code: '${code}' already exists in repository '${repo}'`);
			}
			codesInRequest.add(code);

			const normalizedStatus = (taskData.status as TaskStatus) || "backlog";
			if (normalizedStatus !== "backlog" && normalizedStatus !== "pending") {
				throw new Error(`New tasks must be 'backlog' or 'pending'. Task '${code}' has status '${normalizedStatus}'.`);
			}

			if (normalizedStatus === "pending") {
				if (initialStats.todo + pendingInRequestCount >= 10) {
					throw new Error(
						`Cannot create task '${code}' as 'pending'. Maximum of 10 pending tasks reached. Please use status 'backlog' for new tasks instead.`
					);
				}
			}

			const statusTimestamps = deriveTaskStatusTimestamps(normalizedStatus, now);
			const tags = [...(taskData.tags || [])];
			const phaseTag = `phase:${taskData.phase}`;
			if (!tags.includes(phaseTag)) {
				tags.push(phaseTag);
			}

			const taskId = localCodeMap.get(code)!;
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
		status,
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

	// Auto-generate task_code if not provided
	const resolvedCode = task_code || generateNextCode(owner ?? "", repo, "task", storage);

	if (storage.tasks.isTaskCodeDuplicate(owner, repo, resolvedCode)) {
		throw new Error(`Duplicate task_code: '${resolvedCode}' already exists in repository '${repo}'`);
	}

	if (status !== "backlog" && status !== "pending" && status !== undefined) {
		throw new Error("New tasks must be created with status 'backlog' or 'pending'.");
	}

	if (status === "pending") {
		const stats = storage.taskStats.getTaskStats(owner, repo);
		if (stats.todo >= 10) {
			throw new Error(
				`Cannot create task as 'pending'. Maximum of 10 pending tasks reached. Please use status 'backlog' for new tasks instead.`
			);
		}
	}

	const taskId = randomUUID();
	const now = new Date().toISOString();
	const statusTimestamps = deriveTaskStatusTimestamps((status || "backlog") as TaskStatus, now);
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
		status: (status || "backlog") as TaskStatus,
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

export async function handleTaskDelete(args: unknown, storage: SQLiteStore) {
	const validated = TaskDeleteSchema.parse(args);
	const { owner, repo, id, ids, task_code } = validated;

	// Resolve task_code to id if needed
	const resolvedIds: string[] = [];
	if (ids) resolvedIds.push(...ids);
	if (id) resolvedIds.push(id);
	if (task_code) {
		const task = storage.tasks.getTaskByCode(owner, repo, task_code);
		if (!task) throw new Error(`Task not found: ${task_code}`);
		resolvedIds.push(task.id);
	}

	if (resolvedIds.length === 0) {
		throw new Error("Either 'id', 'ids', or 'task_code' must be provided for deletion");
	}

	const targetIds = resolvedIds;

	const tasksToDelete = storage.tasks.getTasksByIds(targetIds);
	const deletedCodes = tasksToDelete.map((t) => t.task_code);

	for (const targetId of targetIds) {
		storage.tasks.deleteTask(targetId);
	}

	const deletedCodesStr = deletedCodes.length > 0 ? `: ${deletedCodes.join(", ")}` : "";
	return createMcpResponse(
		{
			success: true,
			id: id || undefined,
			ids: ids || undefined,
			repo,
			deletedCount: targetIds.length,
			deletedCodes
		},
		`Deleted ${targetIds.length} task(s) from repo "${repo}"${deletedCodesStr}.`,
		{ includeSerializedStructuredContent: validated.structured }
	);
}
