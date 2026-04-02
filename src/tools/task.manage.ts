import { randomUUID } from "crypto";
import { SQLiteStore } from "../storage/sqlite.js";
import { Task, TaskStatus, TaskPriority } from "../types.js";
import { TaskManageSchema, TaskListSchema } from "./schemas.js";

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

  return { 
    content: [{ 
      type: "text", 
      text: JSON.stringify(filteredTasks, null, 2) 
    }],
    isError: false
  };
}

export async function handleTaskManage(
  args: any,
  storage: SQLiteStore
) {
  const parsed = TaskManageSchema.parse(args);
  const { action, repo, id, task_code, phase, title, description, status, priority, agent, role, doc_path, tags, metadata, parent_id, depends_on } = parsed;

  switch (action) {
    case "create": {
      if (!title) throw new Error("title is required for task creation");
      if (!task_code) throw new Error("task_code is required for task creation");
      if (!phase) throw new Error("phase is required for task creation");
      if (!description) throw new Error("description is required for task creation");
      if (!status) throw new Error("status is required for task creation");
      
      if (storage.isTaskCodeDuplicate(repo, task_code)) {
        throw new Error(`Duplicate task_code: '${task_code}' already exists in repository '${repo}'`);
      }
      
      const taskId = id || randomUUID();
      const task: Task = {
        id: taskId,
        repo,
        task_code: task_code,
        phase: phase,
        title,
        description: description,
        status: (status as TaskStatus),
        priority: (priority as TaskPriority) || 3,
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
      storage.logAction("write", repo, { taskId: task.id });
      return { 
        content: [{ 
          type: "text", 
          text: `Task created: [${task.task_code}] ${task.title}${depends_on ? ` (depends on ${depends_on})` : ""}` 
        }],
        isError: false
      };
    }
    case "update": {
      if (!id) throw new Error("ID is required for task update");
      const updates: any = {};
      if (task_code !== undefined) {
        if (storage.isTaskCodeDuplicate(repo, task_code, id)) {
          throw new Error(`Duplicate task_code: '${task_code}' already exists in repository '${repo}'`);
        }
        updates.task_code = task_code;
      }
      if (phase !== undefined) updates.phase = phase;
      if (title !== undefined) updates.title = title;
      if (description !== undefined) updates.description = description;
      if (status !== undefined) updates.status = status;
      if (priority !== undefined) updates.priority = (priority as TaskPriority);
      if (agent !== undefined) updates.agent = agent;
      if (role !== undefined) updates.role = role;
      if (doc_path !== undefined) updates.doc_path = doc_path;
      if (tags !== undefined) updates.tags = tags;
      if (metadata !== undefined) updates.metadata = metadata;
      if (parent_id !== undefined) updates.parent_id = parent_id;
      if (depends_on !== undefined) updates.depends_on = depends_on;
      
      if (status === "completed") {
        updates.finished_at = new Date().toISOString();
      } else if (status === "canceled") {
        updates.canceled_at = new Date().toISOString();
      }
      
      storage.updateTask(id, updates);
      storage.logAction("update", repo, { taskId: id });
      return { 
        content: [{ 
          type: "text", 
          text: `Task updated: ${id}` 
        }],
        isError: false
      };
    }
    case "list": {
      const tasks = storage.getTasksByRepo(repo, status);
      return { 
        content: [{ 
          type: "text", 
          text: JSON.stringify(tasks, null, 2) 
        }],
        isError: false
      };
    }
    case "delete": {
      if (!id) throw new Error("ID is required for task deletion");
      storage.deleteTask(id);
      storage.logAction("delete", repo, { taskId: id });
      return { 
        content: [{ 
          type: "text", 
          text: `Task deleted: ${id}` 
        }],
        isError: false
      };
    }
    default:
      throw new Error(`Unsupported action: ${action}`);
  }
}
