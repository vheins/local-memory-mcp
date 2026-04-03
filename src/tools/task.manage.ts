import { randomUUID } from "crypto";
import { SQLiteStore } from "../storage/sqlite.js";
import { Task, TaskStatus, TaskPriority } from "../types.js";
import { TaskListSchema, TaskCreateSchema, TaskUpdateSchema, TaskDeleteSchema } from "./schemas.js";

export async function handleTaskList(
  args: any,
  storage: SQLiteStore
) {
  const { repo, status, phase, limit, offset } = TaskListSchema.parse(args);
  
  let tasks;
  if (status) {
    const statuses = status.split(',').map(s => s.trim());
    tasks = storage.getTasksByMultipleStatuses(repo, statuses, limit, offset);
  } else {
    // If no status specified, exclude 'completed' by default to keep context clean.
    const activeStatuses = ['pending', 'in_progress', 'blocked', 'canceled'];
    tasks = storage.getTasksByMultipleStatuses(repo, activeStatuses, limit, offset);
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
  const { repo, task_code, phase, title, description, status, priority, agent, role, doc_path, tags, metadata, parent_id, depends_on } = taskData;

  if (storage.isTaskCodeDuplicate(repo, task_code)) {
    throw new Error(`Duplicate task_code: '${task_code}' already exists in repository '${repo}'`);
  }

  const taskId = randomUUID();
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
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    finished_at: null,
    canceled_at: null,
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

export async function handleTaskUpdate(
  args: any,
  storage: SQLiteStore
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
  }

  // Check for task_code uniqueness if being updated
  if (updates.task_code) {
    if (storage.isTaskCodeDuplicate(repo, updates.task_code, id)) {
      throw new Error(`Duplicate task_code: '${updates.task_code}' already exists in repository '${repo}'`);
    }
  }

  // Handle auto-timestamps for status changes
  const finalUpdates: any = { ...updates };
  if (updates.status === "completed") {
    finalUpdates.finished_at = new Date().toISOString();
  } else if (updates.status === "canceled") {
    finalUpdates.canceled_at = new Date().toISOString();
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

  return { 
    content: [{ 
      type: "text", 
      text: `Task updated: ${id}` 
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
