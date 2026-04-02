import { randomUUID } from "crypto";
import { SQLiteStore } from "../storage/sqlite.js";
import { Task, TaskStatus, TaskPriority } from "../types.js";
import { TaskBulkManageSchema } from "./schemas.js";

export async function handleTaskBulkManage(
  args: any,
  storage: SQLiteStore
) {
  const parsed = TaskBulkManageSchema.parse(args);
  const { action, repo, tasks } = parsed;

  switch (action) {
    case "bulk_create": {
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
        const task: Task = {
          id: taskId,
          repo,
          task_code: taskData.task_code,
          phase: taskData.phase || 'implementation',
          title: taskData.title,
          description: taskData.description || "",
          status: (taskData.status as TaskStatus) || "pending",
          priority: (taskData.priority as TaskPriority) || 3,
          agent: taskData.agent || 'unknown',
          role: taskData.role || 'unknown',
          doc_path: taskData.doc_path || null,
          created_at: now,
          updated_at: now,
          finished_at: null,
          canceled_at: null,
          tags: taskData.tags || [],
          metadata: taskData.metadata || {},
          parent_id: taskData.parent_id || null,
          depends_on: taskData.depends_on || null
        };
        storage.insertTask(task);
        createdTasks.push(task.task_code);
      }

      storage.logAction("write", repo, { resultCount: tasks.length, query: "Bulk Create" });
      
      return { 
        content: [{ 
          type: "text", 
          text: `Successfully created ${tasks.length} tasks: ${createdTasks.join(', ')}` 
        }],
        isError: false
      };
    }
    default:
      throw new Error(`Unsupported bulk action: ${action}`);
  }
}
