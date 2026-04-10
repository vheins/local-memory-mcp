import { randomUUID } from "crypto";
import { SQLiteStore } from "../storage/sqlite.js";
import { Task, TaskStatus, TaskPriority, VectorStore } from "../types.js";
import { createMcpResponse } from "../utils/mcp-response.js";
import { TaskBulkManageSchema } from "./schemas.js";
import { archiveTaskToMemory } from "./task.manage.js";

function deriveTaskStatusTimestamps(status: TaskStatus, now: string) {
  return {
    in_progress_at: status === "in_progress" ? now : null,
    finished_at: status === "completed" ? now : null,
    canceled_at: status === "canceled" ? now : null
  };
}

export async function handleTaskBulkManage(
  args: any,
  storage: SQLiteStore,
  vectors: VectorStore,
  onProgress?: (progress: number, total?: number) => void
) {
  const parsed = TaskBulkManageSchema.parse(args);
  const { action, repo, tasks, ids } = parsed;

  switch (action) {
    case "bulk_create": {
      if (!tasks) throw new Error("tasks array is required for bulk_create");
      const createdTasks: string[] = [];
      const now = new Date().toISOString();
      const codesInRequest = new Set<string>();

      const total = tasks.length;
      let progress = 0;

      for (const taskData of tasks) {
        if (onProgress) {
          onProgress(progress, total);
        }
        
        if (codesInRequest.has(taskData.task_code)) {
          throw new Error(`Duplicate task_code in request: '${taskData.task_code}'`);
        }
        if (storage.isTaskCodeDuplicate(repo, taskData.task_code)) {
          throw new Error(`Duplicate task_code: '${taskData.task_code}' already exists in repository '${repo}'`);
        }
        codesInRequest.add(taskData.task_code);

        const taskId = randomUUID();
        const normalizedStatus = (taskData.status as TaskStatus) || "backlog";

        // New tasks MUST be backlog or pending
        if (normalizedStatus !== "backlog" && normalizedStatus !== "pending") {
          throw new Error(`New tasks must be created with status 'backlog' or 'pending'. Task '${taskData.task_code}' has status '${normalizedStatus}'.`);
        }

        // Max 10 pending tasks validation
        if (normalizedStatus === "pending") {
          const stats = storage.getTaskStats(repo);
          // Count pending tasks in current request that are already processed
          const pendingInRequest = tasks.slice(0, createdTasks.length).filter(t => (t.status || "backlog") === "pending").length;
          if (stats.todo + pendingInRequest >= 10) {
            throw new Error(`Cannot create task '${taskData.task_code}' as 'pending'. Maximum of 10 pending tasks reached in repository '${repo}'. Please use 'backlog' instead.`);
          }
        }

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

        // Archive if created as completed
        if (task.status === "completed") {
          await archiveTaskToMemory(task.id, repo, storage, vectors);
        }
        
        progress++;
      }
      
      if (onProgress) {
        onProgress(progress, total);
      }

      return createMcpResponse(
        {
          success: true,
          action,
          repo,
          createdCount: tasks.length,
          taskCodes: createdTasks,
        },
        `Created ${tasks.length} tasks in repo "${repo}".`,
        {
          structuredContentPathHint: "taskCodes",
          resourceLinks: [
            {
              uri: `tasks://current?repo=${encodeURIComponent(repo)}`,
              name: `Current Tasks (${repo})`,
              description: "Current task snapshot for the repository",
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
    case "bulk_delete": {
      if (!ids) throw new Error("ids array is required for bulk_delete");
      
      const total = ids.length;
      let progress = 0;
      
      for (const id of ids) {
        if (onProgress) {
          onProgress(progress, total);
        }
        storage.deleteTask(id);
        progress++;
      }
      
      if (onProgress) {
        onProgress(progress, total);
      }

      return createMcpResponse(
        {
          success: true,
          action,
          repo,
          deletedCount: ids.length,
          ids,
        },
        `Deleted ${ids.length} tasks from repo "${repo}".`,
        {
          structuredContentPathHint: "ids",
          resourceLinks: [
            {
              uri: `tasks://current?repo=${encodeURIComponent(repo)}`,
              name: `Current Tasks (${repo})`,
              description: "Current task snapshot for the repository after bulk deletion",
              mimeType: "application/json",
              annotations: {
                audience: ["assistant"],
                priority: 0.6,
              },
            },
          ],
        }
      );
    }
    default:
      throw new Error(`Unsupported bulk action: ${action}`);
  }
}
