import { randomUUID } from "crypto";
import { SQLiteStore } from "../storage/sqlite.js";
import { Task, TaskStatus, TaskPriority, VectorStore } from "../types.js";
import { inferRepoFromSession, SessionContext } from "../session.js";
import {
  ElicitationRequestHandler,
  extractAcceptedElicitationContent,
} from "../elicitation.js";
import { createMcpResponse } from "../utils/mcp-response.js";
import {
  TaskListSchema,
  TaskCreateSchema,
  TaskCreateInteractiveSchema,
  TaskUpdateSchema,
  TaskDeleteSchema,
  TaskActiveSchema,
  TaskSearchSchema,
} from "./schemas.js";
import { handleMemoryStore } from "./memory.store.js";

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
  stats?: { todo?: number; inProgress?: number }
) {
  const filterLabel = describeTaskListFilter(status);
  const taskLabel = count === 1 ? "task" : "tasks";
  const parts = [`Found ${count} ${filterLabel} ${taskLabel} in repo "${repo}".`];

  if (phase) {
    parts.push(`Phase filter: ${phase}.`);
  }

  if (search) {
    parts.push(`Search filter: "${search}".`);
  }

  parts.push(`Pending: ${stats?.todo ?? 0}.`);
  parts.push(`In progress: ${stats?.inProgress ?? 0}.`);
  parts.push(`Use task-detail with Task ID or task_code to read full details.`);

  return parts.join(" ");
}

function deriveTaskStatusTimestamps(
  status: TaskStatus,
  now: string,
  existingTask?: { status: TaskStatus }
) {
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

export async function archiveTaskToMemory(
  taskId: string,
  repo: string,
  storage: SQLiteStore,
  vectors: VectorStore
) {
  const task = storage.tasks.getTaskById(taskId);
  if (!task) return;

  const comments = storage.tasks.getTaskCommentsByTaskId(taskId);
  
  let content = `Task: [${task.task_code}] ${task.title}\n`;
  content += `Phase: ${task.phase}\n`;
  content += `Description: ${task.description || "No description"}\n`;
  
  if (comments && comments.length > 0) {
    content += `\nComments & History:\n`;
    // Reverse comments to show in chronological order for the archive
    const chronComments = [...comments].reverse();
    for (const c of chronComments) {
      const statusInfo = c.next_status ? ` (Status: ${c.previous_status} -> ${c.next_status})` : "";
      content += `- [${c.created_at}] ${c.agent}${statusInfo}: ${c.comment}\n`;
    }
  }

  // Use the task metadata if available
  const metadata = {
    task_id: taskId,
    task_code: task.task_code,
    original_metadata: task.metadata
  };

  const title = `Completed Task: ${task.title}`;
  const truncatedTitle = title.length > 100 ? title.substring(0, 97) + "..." : title;

  try {
    await handleMemoryStore({
      type: "task_archive",
      title: truncatedTitle,
      content: content,
      importance: Math.min(5, task.priority + 1), // Slightly higher importance for archived tasks
      agent: task.agent || "system",
      role: task.role || "unknown",
      model: "system",
      scope: { repo: repo },
      tags: ["task-archive", ...task.tags],
      metadata: metadata
    }, storage, vectors);
  } catch (error) {
    // console.error is fine here, or use logger if available
    console.error("Failed to archive task to memory", error);
  }
}


export async function handleTaskList(
  args: any,
  storage: SQLiteStore
) {
  const { repo, status, phase, search, limit, offset } = TaskListSchema.parse(args);
  
  let tasks;
  if (status === 'all') {
    tasks = storage.tasks.getTasksByMultipleStatuses(repo, [], limit, offset, search);
  } else if (status) {
    const statuses = status.split(',').map(s => s.trim());
    tasks = storage.tasks.getTasksByMultipleStatuses(repo, statuses, limit, offset, search);
  } else {
    // If no status specified, exclude 'completed' by default to keep context clean.
    const activeStatuses = ['backlog', 'pending', 'in_progress', 'blocked', 'canceled'];
    tasks = storage.tasks.getTasksByMultipleStatuses(repo, activeStatuses, limit, offset, search);
  }
  
  const filteredTasks = phase 
    ? tasks.filter((t: any) => t.phase.toLowerCase() === phase.toLowerCase()) 
    : tasks;

  const COLUMNS = ["id", "task_code", "title", "status", "priority", "comments_count"] as const;
  const rows = filteredTasks.map((t: any) => [t.id, t.task_code, t.title, t.status, t.priority, t.comments_count || 0]);

  const structured = {
    schema: "task-list" as const,
    tasks: {
      columns: [...COLUMNS],
      rows,
    },
    count: rows.length,
    offset,
  };

  const taskList = filteredTasks.map((t: any) => `[${t.task_code}] ${t.title} (ID: ${t.id})`).join(", ");
  const taskStats = storage.tasks.getTaskStats(repo);
  let summary = buildTaskListSummary(
    repo,
    rows.length,
    status,
    phase,
    search,
    taskStats
  );
  if (rows.length > 0) {
    summary += ` Tasks: ${taskList}`;
  }

  return createMcpResponse(
    structured,
    summary,
    {
      contentSummary: summary,
      includeSerializedStructuredContent: false,
    }
  );
}

export async function handleTaskActive(
  args: any,
  storage: SQLiteStore
) {
  const { repo, status, limit } = TaskActiveSchema.parse(args);

  let tasks: any[];
  let resolvedStatus: string;

  if (status) {
    // Explicit status filter
    tasks = storage.tasks.getTasksByMultipleStatuses(repo, [status], limit, 0);
    resolvedStatus = status;
  } else {
    // Default: in_progress first, fallback to pending
    tasks = storage.tasks.getTasksByMultipleStatuses(repo, ["in_progress"], limit, 0);
    resolvedStatus = "in_progress";
    if (tasks.length === 0) {
      tasks = storage.tasks.getTasksByMultipleStatuses(repo, ["pending"], limit, 0);
      resolvedStatus = "pending";
    }
  }

  const COLUMNS = ["id", "task_code", "title", "status", "priority", "comments_count"] as const;
  const rows = tasks.map((t: any) => [t.id, t.task_code, t.title, t.status, t.priority, t.comments_count || 0]);

  const structured = {
    schema: "task-active" as const,
    tasks: {
      columns: [...COLUMNS],
      rows,
    },
    count: rows.length,
  };

  const taskList = tasks.map(t => `[${t.task_code}] ${t.title} (ID: ${t.id})`).join(", ");
  const filterDesc = status ? `status=${status}` : `active (${resolvedStatus})`;
  const summary = rows.length > 0
    ? `${rows.length} task(s) [${filterDesc}] in "${repo}": ${taskList}. Use task-detail for full details.`
    : `No ${filterDesc} tasks in "${repo}". Use task-list for broader search.`;

  return createMcpResponse(
    structured,
    summary,
    { contentSummary: summary, includeSerializedStructuredContent: false }
  );
}

export async function handleTaskSearch(
  args: any,
  storage: SQLiteStore
) {
  const { repo, query, status, limit, offset } = TaskSearchSchema.parse(args);

  // Map status: default to 'all' statuses when not provided
  let statuses: string[];
  if (!status) {
    statuses = []; // empty = all statuses in getTasksByMultipleStatuses
  } else {
    statuses = status.split(',').map((s: string) => s.trim()).filter(Boolean);
  }

  const tasks = storage.tasks.getTasksByMultipleStatuses(repo, statuses, limit, offset, query);

  const COLUMNS = ["id", "task_code", "title", "status", "priority", "comments_count"] as const;
  const rows = tasks.map((t: any) => [t.id, t.task_code, t.title, t.status, t.priority, t.comments_count || 0]);

  const structured = {
    schema: "task-search" as const,
    query,
    tasks: {
      columns: [...COLUMNS],
      rows,
    },
    count: rows.length,
    offset,
  };

  const taskList = tasks.map((t: any) => `[${t.task_code}] ${t.title} (ID: ${t.id})`).join(", ");
  const statusLabel = status || "all";
  const summary = rows.length > 0
    ? `${rows.length} task(s) matching "${query}" [status: ${statusLabel}] in "${repo}": ${taskList}. Use task-detail for full details.`
    : `No tasks matching "${query}" [status: ${statusLabel}] in "${repo}".`;

  return createMcpResponse(
    structured,
    summary,
    { contentSummary: summary, includeSerializedStructuredContent: false }
  );
}

export async function handleTaskCreate(
  args: any,
  storage: SQLiteStore
) {
  const taskData = TaskCreateSchema.parse(args);
  const { repo, task_code, phase, title, description, status, priority, agent, role, doc_path, tags, metadata, parent_id, depends_on, est_tokens } = taskData;

  if (storage.tasks.isTaskCodeDuplicate(repo, task_code)) {
    throw new Error(`Duplicate task_code: '${task_code}' already exists in repository '${repo}'`);
  }

  // New tasks MUST be backlog or pending
  if (status !== "backlog" && status !== "pending") {
    throw new Error("New tasks must be created with status 'backlog' or 'pending'.");
  }

  // Max 10 pending tasks validation
  if (status === "pending") {
    const stats = storage.tasks.getTaskStats(repo);
    if (stats.todo >= 10) {
      throw new Error(`Cannot create task as 'pending'. Maximum of 10 pending tasks reached in repository '${repo}'. Please use 'backlog' instead.`);
    }
  }

  const taskId = randomUUID();
  const now = new Date().toISOString();
  const statusTimestamps = deriveTaskStatusTimestamps(status as TaskStatus, now);
  const task: Task = {
    id: taskId,
    repo,
    task_code,
    phase,
    title,
    description,
    status: status as TaskStatus,
    priority: priority as TaskPriority,
    agent: agent || 'unknown',
    role: role || 'unknown',
    doc_path: doc_path || null,
    created_at: now,
    updated_at: now,
    in_progress_at: statusTimestamps.in_progress_at,
    finished_at: statusTimestamps.finished_at,
    canceled_at: statusTimestamps.canceled_at,
    est_tokens: est_tokens ?? 0,
    tags: tags || [],
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
      depends_on: task.depends_on,
    },
    `Created task [${task.task_code}] ${task.title} in repo "${task.repo}" with status "${task.status}".`,
    {
      structuredContentPathHint: "task_code",
      resourceLinks: [
        {
          uri: `tasks://tasks?repo=${encodeURIComponent(task.repo)}`,
          name: `Task Index (${task.repo})`,
          description: "Repository task index",
          mimeType: "application/json",
          annotations: {
            audience: ["assistant"],
            priority: 0.8,
          },
        },
      ],
    }
  );
}

type TaskCreateInteractiveOptions = {
  session?: SessionContext;
  elicit?: ElicitationRequestHandler;
};

export async function handleTaskCreateInteractive(
  args: any,
  storage: SQLiteStore,
  options: TaskCreateInteractiveOptions = {},
) {
  const partialTaskData = TaskCreateInteractiveSchema.parse(args ?? {});
  const inferredRepo = partialTaskData.repo ?? inferRepoFromSession(options.session);
  const draft = {
    ...partialTaskData,
    repo: inferredRepo,
  };

  const requestedSchema = buildMissingTaskSchema(draft);
  let completedDraft = draft;

  if (Object.keys(requestedSchema.properties).length > 0) {
    if (!options.session?.supportsElicitationForm || !options.elicit) {
      throw new Error("Client does not advertise MCP elicitation form support");
    }

    const elicited = extractAcceptedElicitationContent(await options.elicit({
      mode: "form",
      message: "Lengkapi data task yang belum ada untuk membuat task baru.",
      requestedSchema,
    }));

    completedDraft = {
      ...draft,
      ...elicited,
    };
  }

  const result = await handleTaskCreate({
    ...completedDraft,
    status: completedDraft.status ?? "backlog",
    priority: completedDraft.priority ?? 3,
  }, storage);

  const parsedTask = TaskCreateSchema.parse({
    ...completedDraft,
    status: completedDraft.status ?? "backlog",
    priority: completedDraft.priority ?? 3,
  });

  return createMcpResponse(
    {
      repo: parsedTask.repo,
      task_code: parsedTask.task_code,
      phase: parsedTask.phase,
      title: parsedTask.title,
      status: parsedTask.status,
      priority: parsedTask.priority,
    },
    `Created task [${parsedTask.task_code}] ${parsedTask.title} in repo "${parsedTask.repo}" with status "${parsedTask.status}".`,
    {
      structuredContentPathHint: "task_code",
    }
  );
}

function buildMissingTaskSchema(task: Record<string, any>) {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  addRequiredStringField(properties, required, task, "repo", {
    title: "Repository",
    description: "Nama repository untuk task ini.",
    minLength: 1,
  });
  addRequiredStringField(properties, required, task, "task_code", {
    title: "Task Code",
    description: "Kode task yang unik di repository ini.",
    minLength: 1,
  });
  addRequiredStringField(properties, required, task, "phase", {
    title: "Phase",
    description: "Fase kerja atau milestone task.",
    minLength: 1,
  });
  addRequiredStringField(properties, required, task, "title", {
    title: "Title",
    description: "Judul singkat task.",
    minLength: 3,
    maxLength: 100,
  });
  addRequiredStringField(properties, required, task, "description", {
    title: "Description",
    description: "Deskripsi task yang cukup jelas untuk dikerjakan.",
    minLength: 1,
  });

  if (!task.status) {
    properties.status = {
      type: "string",
      title: "Status",
      description: "Status awal task.",
      enum: ["backlog", "pending"],
      default: "backlog",
    };
  }

  if (task.priority === undefined) {
    properties.priority = {
      type: "integer",
      title: "Priority",
      description: "Prioritas task dari 1 sampai 5.",
      minimum: 1,
      maximum: 5,
      default: 3,
    };
  }

  return {
    type: "object" as const,
    properties,
    required,
  };
}

function addRequiredStringField(
  properties: Record<string, unknown>,
  required: string[],
  task: Record<string, any>,
  field: string,
  schema: Record<string, unknown>,
) {
  if (typeof task[field] === "string" && task[field].trim()) {
    return;
  }

  properties[field] = {
    type: "string",
    ...schema,
  };
  required.push(field);
}

export async function handleTaskUpdate(
  args: any,
  storage: SQLiteStore,
  vectors: VectorStore
) {
  const updateData = TaskUpdateSchema.parse(args);
  const { repo, id, comment, ...updates } = updateData;
  const existingTask = storage.tasks.getTaskById(id);

  if (!existingTask) {
    throw new Error(`Task not found: ${id}`);
  }

  // Enforce mandatory comment if status is changing
  if (updates.status !== undefined && updates.status !== existingTask.status) {
    if (comment === undefined || comment.trim() === "") {
      throw new Error("comment is required when changing task status");
    }

    // Workflow transition validation
    if (existingTask.status === "backlog" && updates.status === "completed") {
      throw new Error("Cannot transition directly from 'backlog' to 'completed'. Task must be 'in_progress' first.");
    }

    if (existingTask.status === "pending" && updates.status === "completed") {
      throw new Error("Cannot transition directly from 'pending' to 'completed'. Task must be 'in_progress' first.");
    }

    if (existingTask.status === "blocked" && updates.status === "completed") {
      throw new Error("Cannot transition directly from 'blocked' to 'completed'. Task must be 'in_progress' first.");
    }
  }

  if (updates.status === "completed" && updates.status !== existingTask.status && updates.est_tokens === undefined) {
    throw new Error("est_tokens is required when changing task status to completed");
  }

  // Check for task_code uniqueness if being updated
  if (updates.task_code) {
    if (storage.tasks.isTaskCodeDuplicate(repo, updates.task_code, id)) {
      throw new Error(`Duplicate task_code: '${updates.task_code}' already exists in repository '${repo}'`);
    }
  }

  // Handle auto-timestamps for status changes
  const finalUpdates: any = { ...updates };
  const now = new Date().toISOString();
  if (updates.status === "completed") {
    finalUpdates.finished_at = now;
  } else if (updates.status === "canceled") {
    finalUpdates.canceled_at = now;
  } else if (updates.status === "in_progress" && existingTask.status !== "in_progress") {
    finalUpdates.in_progress_at = now;
  }

  storage.tasks.updateTask(id, finalUpdates);

  if (comment !== undefined) {
    const isStatusChanging = updates.status !== undefined && updates.status !== existingTask.status;
    storage.tasks.insertTaskComment({
      id: randomUUID(),
      task_id: id,
      repo,
      comment,
      agent: updates.agent || existingTask.agent || "unknown",
      role: updates.role || existingTask.role || "unknown",
      model: updates.model || "unknown",
      previous_status: isStatusChanging ? existingTask.status : null,
      next_status: isStatusChanging ? updates.status : null,
      created_at: new Date().toISOString()
    });
  }

  // Archive to memory if completed
  if (updates.status === "completed" && existingTask.status !== "completed") {
    await archiveTaskToMemory(id, repo, storage, vectors);
  }

  return createMcpResponse(
    {
      success: true,
      id,
      repo,
      status: updates.status ?? existingTask.status,
      archivedToMemory: updates.status === "completed" && existingTask.status !== "completed",
      updatedFields: Object.keys(finalUpdates),
    },
    `Updated task ${id} in repo "${repo}" to status "${updates.status ?? existingTask.status}".${updates.status === "completed" ? " Archived to memory." : ""}`,
    {
      structuredContentPathHint: "updatedFields",
    }
  );
}

export async function handleTaskDelete(
  args: any,
  storage: SQLiteStore
) {
  const { repo, id } = TaskDeleteSchema.parse(args);
  storage.tasks.deleteTask(id);

  return createMcpResponse(
    {
      success: true,
      id,
      repo,
    },
    `Deleted task ${id} from repo "${repo}".`,
    {
      structuredContentPathHint: "id",
    }
  );
}
