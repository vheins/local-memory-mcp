import { randomUUID } from "crypto";
import { SQLiteStore } from "../storage/sqlite.js";
import { Task, TaskStatus, TaskPriority, VectorStore } from "../types.js";
import { inferRepoFromSession, SessionContext } from "../mcp/session.js";
import {
  ElicitationRequestHandler,
  extractAcceptedElicitationContent,
} from "../mcp/elicitation.js";
import { createMcpResponse } from "../utils/mcp-response.js";
import {
  TaskListSchema,
  TaskCreateSchema,
  TaskCreateInteractiveSchema,
  TaskUpdateSchema,
  TaskDeleteSchema,
} from "./schemas.js";
import { handleMemoryStore } from "./memory.store.js";

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
  const task = storage.getTaskById(taskId);
  if (!task) return;

  const comments = storage.getTaskCommentsByTaskId(taskId);
  
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
    tasks = storage.getTasksByMultipleStatuses(repo, [], limit, offset, search);
  } else if (status) {
    const statuses = status.split(',').map(s => s.trim());
    tasks = storage.getTasksByMultipleStatuses(repo, statuses, limit, offset, search);
  } else {
    // If no status specified, exclude 'completed' by default to keep context clean.
    const activeStatuses = ['backlog', 'pending', 'in_progress', 'blocked', 'canceled'];
    tasks = storage.getTasksByMultipleStatuses(repo, activeStatuses, limit, offset, search);
  }
  
  const filteredTasks = phase 
    ? tasks.filter((t: any) => t.phase.toLowerCase() === phase.toLowerCase()) 
    : tasks;

  // Enhance tasks with their comments/history
  const tasksWithHistory = filteredTasks.map((task: any) => ({
    ...task,
    comments: storage.getTaskCommentsByTaskId(task.id)
  }));

  return { 
    content: [{ 
      type: "text", 
      text: JSON.stringify(tasksWithHistory, null, 2) 
    }],
    isError: false
  };
}

export async function handleTaskCreate(
  args: any,
  storage: SQLiteStore
) {
  const taskData = TaskCreateSchema.parse(args);
  const { repo, task_code, phase, title, description, status, priority, agent, role, doc_path, tags, metadata, parent_id, depends_on, est_tokens } = taskData;

  if (storage.isTaskCodeDuplicate(repo, task_code)) {
    throw new Error(`Duplicate task_code: '${task_code}' already exists in repository '${repo}'`);
  }

  // New tasks MUST be backlog or pending
  if (status !== "backlog" && status !== "pending") {
    throw new Error("New tasks must be created with status 'backlog' or 'pending'.");
  }

  // Max 10 pending tasks validation
  if (status === "pending") {
    const stats = storage.getTaskStats(repo);
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

  storage.insertTask(task);

  return { 
    content: [{ 
      type: "text", 
      text: `Task created: [${task.task_code}] ${task.title}${depends_on ? ` (depends on ${depends_on})` : ""}` 
    }],
    isError: false
  };
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
    result.content[0]?.type === "text" ? result.content[0].text : `Task created: [${parsedTask.task_code}] ${parsedTask.title}`,
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
  const existingTask = storage.getTaskById(id);

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
    if (storage.isTaskCodeDuplicate(repo, updates.task_code, id)) {
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

  storage.updateTask(id, finalUpdates);

  if (comment !== undefined) {
    const isStatusChanging = updates.status !== undefined && updates.status !== existingTask.status;
    storage.insertTaskComment({
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

  return { 
    content: [{ 
      type: "text", 
      text: `Task updated: ${id}${updates.status === "completed" ? " and archived to memory" : ""}` 
    }],
    isError: false
  };
}

export async function handleTaskDelete(
  args: any,
  storage: SQLiteStore
) {
  const { repo, id } = TaskDeleteSchema.parse(args);
  storage.deleteTask(id);

  return { 
    content: [{ 
      type: "text", 
      text: `Task deleted: ${id}` 
    }],
    isError: false
  };
}
