import { randomUUID } from "crypto";
import { SQLiteStore } from "../storage/sqlite";
import { Task, TaskStatus, TaskPriority, VectorStore } from "../types";
import { inferRepoFromSession } from "../session";
import { extractAcceptedElicitationContent } from "../elicitation";
import { createMcpResponse } from "../utils/mcp-response";
import {
	TaskCreateSchema,
	TaskCreateInteractiveSchema,
	TaskUpdateSchema,
	TaskDeleteSchema,
	TaskListSchema
} from "./schemas";
import { handleMemoryStore } from "./memory.store";

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
				parts.push("- code|status|priority|title");
				for (const t of items) {
					parts.push(`- ${t.task_code}|${t.status}|${t.priority}|${t.title}`);
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

	const comments = storage.tasks.getTaskCommentsByTaskId(taskId);

	let content = `Task: [${task.task_code}] ${task.title}\n`;
	content += `Phase: ${task.phase}\n`;
	content += `Description: ${task.description || "No description"}\n`;

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
				scope: { repo: repo },
				tags: ["task-archive", ...task.tags],
				metadata: metadata
			},
			storage,
			vectors
		);
	} catch (error) {
		console.error("Failed to archive task to memory", error);
	}
}

export async function handleTaskList(args: unknown, storage: SQLiteStore) {
	const validated = TaskListSchema.parse(args);
	const {
		repo,
		status = "backlog,pending,in_progress,blocked",
		phase,
		query,
		limit,
		offset,
		structured: isStructuredRequest
	} = validated;

	let statuses: string[] = [];
	if (status !== "all") {
		statuses = status
			.split(",")
			.map((s: string) => s.trim())
			.filter(Boolean);
	}

	const tasks = storage.tasks.getTasksByMultipleStatuses(repo, statuses, limit, offset, query);
	const filteredTasks = phase ? tasks.filter((t: Task) => t.phase.toLowerCase() === phase.toLowerCase()) : tasks;

	const COLUMNS = ["id", "task_code", "title", "status", "priority", "comments_count"] as const;
	const rows = filteredTasks.map((t: Task & { comments_count?: number }) => [
		t.id,
		t.task_code,
		t.title,
		t.status,
		t.priority,
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
	const { repo, tasks: bulkTasks, ...singleTask } = parsed;

	if (bulkTasks) {
		const createdTasks: string[] = [];
		const now = new Date().toISOString();
		const codesInRequest = new Set<string>();

		for (const taskData of bulkTasks) {
			if (codesInRequest.has(taskData.task_code)) {
				throw new Error(`Duplicate task_code in request: '${taskData.task_code}'`);
			}
			if (storage.tasks.isTaskCodeDuplicate(repo, taskData.task_code)) {
				throw new Error(`Duplicate task_code: '${taskData.task_code}' already exists in repository '${repo}'`);
			}
			codesInRequest.add(taskData.task_code);

			const normalizedStatus = (taskData.status as TaskStatus) || "backlog";
			if (normalizedStatus !== "backlog" && normalizedStatus !== "pending") {
				throw new Error(
					`New tasks must be 'backlog' or 'pending'. Task '${taskData.task_code}' has status '${normalizedStatus}'.`
				);
			}

			if (normalizedStatus === "pending") {
				const stats = storage.tasks.getTaskStats(repo);
				const pendingInRequest = createdTasks.filter((c) => {
					const t = bulkTasks.find((bt) => bt.task_code === c);
					return t?.status === "pending";
				}).length;
				if (stats.todo + pendingInRequest >= 10) {
					throw new Error(
						`Cannot create task '${taskData.task_code}' as 'pending'. Maximum of 10 pending tasks reached.`
					);
				}
			}

			const statusTimestamps = deriveTaskStatusTimestamps(normalizedStatus, now);
			const tags = [...(taskData.tags || [])];
			const phaseTag = `phase:${taskData.phase}`;
			if (!tags.includes(phaseTag)) {
				tags.push(phaseTag);
			}

			const task: Task = {
				id: randomUUID(),
				repo,
				task_code: taskData.task_code,
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
				metadata: (taskData.metadata as Record<string, unknown>) || {},
				parent_id: taskData.parent_id || null,
				depends_on: taskData.depends_on || null
			};
			storage.tasks.insertTask(task);
			createdTasks.push(task.task_code);
		}

		return createMcpResponse(
			{ success: true, repo, createdCount: bulkTasks.length, taskCodes: createdTasks },
			`Created ${bulkTasks.length} tasks in repo "${repo}".`
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
		tags,
		metadata,
		parent_id,
		depends_on,
		est_tokens
	} = singleTask;

	if (!task_code || !phase || !title || !description) {
		throw new Error("Missing required fields for single task creation (task_code, phase, title, description)");
	}

	if (storage.tasks.isTaskCodeDuplicate(repo, task_code)) {
		throw new Error(`Duplicate task_code: '${task_code}' already exists in repository '${repo}'`);
	}

	if (status !== "backlog" && status !== "pending" && status !== undefined) {
		throw new Error("New tasks must be created with status 'backlog' or 'pending'.");
	}

	if (status === "pending") {
		const stats = storage.tasks.getTaskStats(repo);
		if (stats.todo >= 10) {
			throw new Error(`Cannot create task as 'pending'. Maximum of 10 pending tasks reached.`);
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
		repo,
		task_code,
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
		metadata: metadata || {},
		parent_id: parent_id || null,
		depends_on: depends_on || null
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
		`Created task [${task.task_code}] ${task.title} in repo "${task.repo}" with status "${task.status}".`
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
			priority: completedDraft.priority ?? 3
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
	addRequiredStringField(properties, required, task, "task_code", {
		title: "Task Code",
		description: "Unique task code in this repository.",
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
		description: "Detailed description of the task.",
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
	const { repo, id, ids, comment, force, ...updates } = updateData;
	const targetIds = ids || (id ? [id] : []);

	if (targetIds.length === 0) {
		throw new Error("Either 'id' or 'ids' must be provided for update");
	}

	let updatedCount = 0;
	const now = new Date().toISOString();
	const isStatusChangingGlobal = updates.status !== undefined;

	for (const targetId of targetIds) {
		const existingTask = storage.tasks.getTaskById(targetId);
		if (!existingTask) {
			if (id) throw new Error(`Task not found: ${targetId}`);
			continue;
		}

		const isStatusChanging = isStatusChangingGlobal && updates.status !== existingTask.status;

		if (isStatusChanging && !force) {
			if (!comment || comment.trim() === "") {
				throw new Error("comment is required when changing task status");
			}
			
			const isStartable = existingTask.status === "backlog" || existingTask.status === "pending" || existingTask.status === "blocked";
			
			if (isStartable && updates.status === "completed") {
				throw new Error(
					`Cannot transition task ${targetId} from '${existingTask.status}' directly to 'completed'. Must be 'in_progress' first.`
				);
			}
		}

		if (updates.status === "completed" && isStatusChanging && updates.est_tokens === undefined) {
			throw new Error("est_tokens is required when changing task status to completed");
		}

		if (updates.task_code && storage.tasks.isTaskCodeDuplicate(repo, updates.task_code, targetId)) {
			throw new Error(`Duplicate task_code: '${updates.task_code}' already exists`);
		}

		const finalUpdates: Record<string, unknown> = { ...updates };
		
		if (updates.phase !== undefined || updates.tags !== undefined) {
			let currentTags = updates.tags || existingTask.tags || [];
			// Remove any existing phase: tags
			currentTags = currentTags.filter(t => !t.startsWith("phase:"));
			
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

		if (updates.status === "completed") finalUpdates.finished_at = now;
		else if (updates.status === "canceled") finalUpdates.canceled_at = now;
		else if (updates.status === "in_progress" && existingTask.status !== "in_progress")
			finalUpdates.in_progress_at = now;

		storage.tasks.updateTask(targetId, finalUpdates);

		if (comment !== undefined || isStatusChanging) {
			storage.tasks.insertTaskComment({
				id: randomUUID(),
				task_id: targetId,
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
			await archiveTaskToMemory(targetId, repo, storage, vectors);
		}
		updatedCount++;
	}

	return createMcpResponse(
		{
			success: true,
			id: id || undefined,
			ids: ids || undefined,
			repo,
			status: updates.status,
			updatedCount,
			updatedFields: Object.keys(updates)
		},
		`Updated ${updatedCount} task(s) in repo "${repo}".`
	);
}

export async function handleTaskDelete(args: unknown, storage: SQLiteStore) {
	const { repo, id, ids } = TaskDeleteSchema.parse(args);
	const targetIds = ids || (id ? [id] : []);

	if (targetIds.length === 0) {
		throw new Error("Either 'id' or 'ids' must be provided for deletion");
	}

	for (const targetId of targetIds) {
		storage.tasks.deleteTask(targetId);
	}

	return createMcpResponse(
		{
			success: true,
			id: id || undefined,
			ids: ids || undefined,
			repo,
			deletedCount: targetIds.length
		},
		`Deleted ${targetIds.length} task(s) from repo "${repo}".`
	);
}
