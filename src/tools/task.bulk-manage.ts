import { randomUUID } from "crypto";
import { SQLiteStore } from "../storage/sqlite.js";
import { Task, TaskStatus, TaskPriority } from "../types.js";
import { TaskBulkManageSchema } from "./schemas.js";

function deriveTaskStatusTimestamps(status: TaskStatus, now: string) {
  return {
    in_progress_at: status === "in_progress" ? now : null,
    finished_at: status === "completed" ? now : null,
    canceled_at: status === "canceled" ? now : null
  };
}

export async function handleTaskBulkManage(
  args: any,
  storage: SQLiteStore
) {
  const parsed = TaskBulkManageSchema.parse(args);
  const { action, repo, tasks, ids } = parsed;

  switch (action) {
    case "bulk_create": {
      if (!tasks) throw new Error("tasks array is required for bulk_create");
      const createdTasks: string[] = [];
      const now = new Date().toISOString();
      const codesInRequest = new Set<string>();

      for (const taskData of tasks) {
        if (codesInRequest.has(taskData.task_code)) {
          throw new Error(`Duplicate task_code in request: '${taskData.task_code}'`);
        }
        if (storage.isTaskCodeDuplicate(repo, taskData.task_code)) {
          throw new Error(`Duplicate task_code: '${taskData.task_code}' already exists in repository '${repo}'`);
        }
        codesInRequest.add(taskData.task_code);

        const taskId = randomUUID();
        const normalizedStatus = (taskData.status as TaskStatus) || "pending";
        const statusTimestamps = deriveTaskStatusTimestamps(normalizedStatus, now);
        const task: Task = {
          id: taskId,
          repo,
          task_code: taskData.task_code,
          phase: taskData.phase || 'implementation',
          title: taskData.title,
          description: taskData.description || "",
          status: normalizedStatus,
          priority: (taskData.priority as TaskPriority) || 3,
          agent: taskData.agent || 'unknown',
          role: taskData.role || 'unknown',
          doc_path: taskData.doc_path || null,
          created_at: now,
          updated_at: now,
          in_progress_at: statusTimestamps.in_progress_at,
          finished_at: statusTimestamps.finished_at,
          canceled_at: statusTimestamps.canceled_at,
          est_tokens: taskData.est_tokens ?? 0,
          tags: taskData.tags || [],
          metadata: taskData.metadata || {},
          parent_id: taskData.parent_id || null,
          depends_on: taskData.depends_on || null
        };
        storage.insertTask(task);
        createdTasks.push(task.task_code);
      }

      return { 
        content: [{ 
          type: "text", 
          text: `Successfully created ${tasks.length} tasks: ${createdTasks.join(', ')}` 
        }],
        isError: false
      };
    }
    case "bulk_delete": {
      if (!ids) throw new Error("ids array is required for bulk_delete");
      
      for (const id of ids) {
        storage.deleteTask(id);
      }

      return { 
        content: [{ 
          type: "text", 
          text: `Successfully deleted ${ids.length} tasks.` 
        }],
        isError: false
      };
    }
    default:
      throw new Error(`Unsupported bulk action: ${action}`);
  }
}
