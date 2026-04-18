import express from "express";
import { randomUUID } from "crypto";
import { db } from "../lib/context.js";
import { jsonApiRes, jsonApiError, getAttributes } from "../lib/jsonApi.js";
import type { Task } from "../../mcp/types/index.js";
import type { IdParams, TaskListQuery } from "../../mcp/interfaces/index.js";

export class TasksController {
	static async list(req: express.Request, res: express.Response) {
		try {
			await db.refresh();
			const query = req.query as unknown as TaskListQuery;
			const { repo, status, search } = query;
			const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
			const pageSize = Math.min(100, Math.max(1, parseInt((req.query.pageSize as string) || "20", 10)));

			if (!repo) return res.status(400).json(jsonApiError("repo is required", 400));

			let tasks;
			let totalItems;

			if (status && (status as string).includes(",")) {
				const statuses = (status as string).split(",");
				tasks = db.tasks.getTasksByMultipleStatuses(
					repo as string,
					statuses,
					pageSize,
					(page - 1) * pageSize,
					search as string
				);
				totalItems = db.tasks.countTasksByMultipleStatuses(repo as string, statuses, search as string);
			} else {
				tasks = db.tasks.getTasksByRepo(
					repo as string,
					status as string,
					pageSize,
					(page - 1) * pageSize,
					search as string
				);
				totalItems = db.tasks.countTasks(repo as string, status as string, search as string);
			}

			const totalPages = Math.ceil(totalItems / pageSize);

			res.json(jsonApiRes(tasks, "task", { meta: { page, pageSize, totalItems, totalPages } }));
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			res.status(500).json(jsonApiError(message));
		}
	}

	static async get(req: express.Request, res: express.Response) {
		try {
			await db.refresh();
			const task = db.tasks.getTaskById(req.params.id as string);
			if (!task) throw new Error("Task not found");
			db.actions.logAction("read", task.repo, { taskId: task.id });
			res.json(jsonApiRes(task, "task"));
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Task not found";
			res.status(404).json(jsonApiError(message, 404));
		}
	}

	static async getByCode(req: express.Request, res: express.Response) {
		try {
			await db.refresh();
			const { repo, task_code } = req.query;
			if (!repo || !task_code) return res.status(400).json(jsonApiError("repo and task_code are required", 400));
			const task = db.tasks.getTaskByCode(repo as string, task_code as string);
			if (!task) return res.status(404).json(jsonApiError("Task not found", 404));
			res.json(jsonApiRes(task, "task"));
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Task not found";
			res.status(404).json(jsonApiError(message, 404));
		}
	}

	static async create(req: express.Request, res: express.Response) {
		try {
			await db.refresh();
			const attributes = getAttributes(req);
			const { repo, task_code, title } = attributes;
			if (!repo || !task_code || !title) return res.status(400).json(jsonApiError("Required fields missing", 400));
			if (db.tasks.isTaskCodeDuplicate(repo, task_code))
				return res.status(400).json(jsonApiError("Duplicate task_code", 400));
			const id = randomUUID();
			await db.withWrite(() => {
				db.tasks.insertTask({
					...attributes,
					id,
					created_at: new Date().toISOString(),
					updated_at: new Date().toISOString()
				} as Task);
				db.actions.logAction("write", repo, { taskId: id });
			});
			res.json(jsonApiRes({ id }, "task"));
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			res.status(500).json(jsonApiError(message));
		}
	}

	static async update(req: express.Request, res: express.Response) {
		try {
			await db.refresh();
			const { id } = req.params as unknown as IdParams;
			const attributes = getAttributes(req);
			const existingTask = db.tasks.getTaskById(id);
			if (!existingTask) return res.status(404).json(jsonApiError("Task not found", 404));

			await db.withWrite(() => {
				db.tasks.updateTask(id, attributes as Partial<Task>);

				if (attributes.status && attributes.status !== existingTask.status) {
					db.actions.logAction("update", existingTask.repo, {
						taskId: id,
						query: `Status changed to ${attributes.status}`
					});
					db.tasks.insertTaskComment({
						id: randomUUID(),
						task_id: id,
						repo: existingTask.repo,
						comment: attributes.comment || `Status updated via dashboard`,
						agent: "dashboard",
						role: "user",
						model: "web-ui",
						previous_status: existingTask.status,
						next_status: attributes.status,
						created_at: new Date().toISOString()
					});
				} else if (attributes.comment) {
					db.tasks.insertTaskComment({
						id: randomUUID(),
						task_id: id,
						repo: existingTask.repo,
						comment: attributes.comment,
						agent: "dashboard",
						role: "user",
						model: "web-ui",
						previous_status: null,
						next_status: null,
						created_at: new Date().toISOString()
					});
				}
			});

			res.json(jsonApiRes({ message: "Updated" }, "status"));
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			res.status(500).json(jsonApiError(message));
		}
	}

	static async delete(req: express.Request, res: express.Response) {
		try {
			await db.refresh();
			const { id } = req.params as unknown as IdParams;
			const task = db.tasks.getTaskById(id);
			if (!task) return res.status(404).json(jsonApiError("Task not found", 404));

			await db.withWrite(() => {
				db.tasks.deleteTask(id);
				db.actions.logAction("delete", task.repo, { taskId: id });
			});
			res.json(jsonApiRes({ message: "Deleted" }, "status"));
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			res.status(500).json(jsonApiError(message));
		}
	}

	static async bulkCreate(req: express.Request, res: express.Response) {
		try {
			await db.refresh();
			const { items, repo } = getAttributes(req);
			if (!Array.isArray(items) || !repo)
				return res.status(400).json(jsonApiError("Invalid payload: requires 'items' array and 'repo'", 400));

			const tasks = items.map((item: Record<string, unknown>) => ({
				...item,
				id: (item.id as string) || randomUUID(),
				repo,
				task_code: (item.task_code as string) || randomUUID().substring(0, 8),
				created_at: (item.created_at as string) || new Date().toISOString(),
				updated_at: (item.updated_at as string) || new Date().toISOString()
			}));

			const count = await db.withWrite(() => {
				const n = db.tasks.bulkInsertTasks(tasks as Task[]);
				db.actions.logAction("write", repo, { query: `Bulk imported ${n} tasks` });
				return n;
			});
			res.json(jsonApiRes({ count }, "status"));
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			res.status(500).json(jsonApiError(message));
		}
	}

	static async getTimeStats(req: express.Request, res: express.Response) {
		try {
			await db.refresh();
			const { repo } = req.query;
			if (!repo) return res.status(400).json(jsonApiError("repo is required", 400));

			const stats = {
				daily: {
					...db.tasks.getTaskTimeStats(repo as string, "daily"),
					history: db.tasks.getTaskComparisonSeries(repo as string, "daily")
				},
				weekly: {
					...db.tasks.getTaskTimeStats(repo as string, "weekly"),
					history: db.tasks.getTaskComparisonSeries(repo as string, "weekly")
				},
				monthly: {
					...db.tasks.getTaskTimeStats(repo as string, "monthly"),
					history: db.tasks.getTaskComparisonSeries(repo as string, "monthly")
				},
				overall: {
					...db.tasks.getTaskTimeStats(repo as string, "overall"),
					history: db.tasks.getTaskComparisonSeries(repo as string, "overall")
				}
			};

			res.json(jsonApiRes(stats, "performance-stats"));
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			res.status(500).json(jsonApiError(message));
		}
	}

	static async updateComment(req: express.Request, res: express.Response) {
		try {
			await db.refresh();
			const { id } = req.params as unknown as IdParams;
			const { comment } = getAttributes(req);
			const existingComment = db.tasks.getTaskCommentById(id);
			if (!existingComment) return res.status(404).json(jsonApiError("Comment not found", 404));

			await db.withWrite(() => db.tasks.updateTaskComment(id, { comment }));
			res.json(jsonApiRes({ message: "Updated" }, "status"));
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			res.status(500).json(jsonApiError(message));
		}
	}

	static async deleteComment(req: express.Request, res: express.Response) {
		try {
			await db.refresh();
			const { id } = req.params as unknown as IdParams;
			await db.withWrite(() => db.tasks.deleteTaskComment(id));
			res.json(jsonApiRes({ message: "Deleted" }, "status"));
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			res.status(500).json(jsonApiError(message));
		}
	}
}
