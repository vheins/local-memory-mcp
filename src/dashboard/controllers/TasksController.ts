import express from "express";
import { randomUUID } from "crypto";
import { db, mcpClient } from "../lib/context";
import { jsonApiRes, handleController, HttpError, parsePageParams, getAttributes } from "../lib/jsonApi";
import type { Task } from "../../mcp/types";
import type { IdParams, TaskListQuery } from "../../mcp/interfaces";

/**
 * Resolves the owner for dashboard task writes.
 *
 * Precedence: explicit `owner` attribute → `DASHBOARD_OWNER` env (acts as the
 * dashboard's session owner) → "" (caller must reject empty).
 *
 * Normalizing owner at write time (instead of persisting "") keeps task
 * lookups single-query: the entity layer no longer needs owner-fallback
 * re-queries for owner-less rows (TASK-038).
 */
function resolveWriteOwner(owner: unknown): string {
	const explicit = typeof owner === "string" ? owner.trim() : "";
	return explicit || process.env.DASHBOARD_OWNER || "";
}

export class TasksController {
	static async list(req: express.Request, res: express.Response) {
		await handleController(req, res, () => {
			const query = req.query as unknown as TaskListQuery;
			const { repo, status, search } = query;
			const { page, pageSize, offset } = parsePageParams(req.query, { defaultPageSize: 20 });

			if (!repo) throw new HttpError(400, "repo is required");

			let tasks;
			let totalItems;

			if (status && (status as string).includes(",")) {
				const statuses = (status as string).split(",");
				tasks = db.tasks.getTasksByMultipleStatuses("", repo as string, statuses, pageSize, offset, search as string);
				totalItems = db.tasks.countTasksByMultipleStatuses("", repo as string, statuses, search as string);
			} else {
				tasks = db.tasks.getTasksByRepo("", repo as string, status as string, pageSize, offset, search as string);
				totalItems = db.tasks.countTasks("", repo as string, status as string, search as string);
			}

			const totalPages = Math.ceil(totalItems / pageSize);

			return jsonApiRes(tasks, "task", { meta: { page, pageSize, totalItems, totalPages } });
		});
	}

	static async get(req: express.Request, res: express.Response) {
		await handleController(req, res, () => {
			const task = db.tasks.getTaskById(req.params.id as string);
			if (!task) throw new HttpError(404, "Task not found");
			db.actions.logAction("read", task.owner || "", task.repo, { taskId: task.id });
			return jsonApiRes(task, "task");
		});
	}

	static async getByCode(req: express.Request, res: express.Response) {
		await handleController(req, res, () => {
			const { repo, task_code } = req.query;
			if (!repo || !task_code) throw new HttpError(400, "repo and task_code are required");
			const task = db.tasks.getTaskByCode("", repo as string, task_code as string);
			if (!task) throw new HttpError(404, "Task not found");
			return jsonApiRes(task, "task");
		});
	}

	static async create(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const attributes = getAttributes(req);
			const { repo, task_code, title } = attributes;
			if (!repo || !task_code || !title) throw new HttpError(400, "Required fields missing");
			// Normalize owner at write time — reject empty instead of persisting ""
			// (owner-less rows force fallback double-queries on every lookup).
			const owner = resolveWriteOwner(attributes.owner);
			if (!owner) throw new HttpError(400, "owner is required (or set DASHBOARD_OWNER)");
			if (db.tasks.isTaskCodeDuplicate(owner, repo, task_code)) throw new HttpError(400, "Duplicate task_code");
			const id = randomUUID();
			await db.withWrite(() => {
				db.tasks.insertTask({
					...attributes,
					owner,
					id,
					created_at: new Date().toISOString(),
					updated_at: new Date().toISOString()
				} as Task);
				db.actions.logAction("write", owner, repo, { taskId: id });
			});
			return jsonApiRes({ id }, "task");
		});
	}

	static async update(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const { id } = req.params as unknown as IdParams;
			const attributes = getAttributes(req);
			const existingTask = db.tasks.getTaskById(id);
			if (!existingTask) throw new HttpError(404, "Task not found");

			if (!mcpClient.isConnected()) await mcpClient.start();

			const toolArgs: Record<string, unknown> = {
				repo: existingTask.repo,
				id,
				agent: "dashboard",
				role: "user",
				model: "web-ui",
				structured: true
			};

			for (const [key, value] of Object.entries(attributes as Record<string, unknown>)) {
				if (value !== undefined) {
					toolArgs[key] = value;
				}
			}

			if (attributes.status && attributes.status !== existingTask.status && !toolArgs.comment) {
				toolArgs.comment = `Status updated via dashboard to ${attributes.status}`;
			}

			if (attributes.status === "completed") {
				if (toolArgs.est_tokens === undefined) {
					toolArgs.est_tokens = existingTask.est_tokens || 0;
				}
				if (toolArgs.commit_id === undefined) {
					if (existingTask.commit_id) {
						toolArgs.commit_id = existingTask.commit_id;
					}
				}
				if (toolArgs.changed_files === undefined) {
					toolArgs.changed_files = existingTask.changed_files || [];
				}
			}

			await mcpClient.callTool("task-update", toolArgs);
			await db.refresh();

			const updatedTask = db.tasks.getTaskById(id);
			if (!updatedTask) {
				throw new HttpError(500, "Task updated but could not be reloaded");
			}

			return jsonApiRes(updatedTask, "task");
		});
	}

	static async delete(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const { id } = req.params as unknown as IdParams;
			const task = db.tasks.getTaskById(id);
			if (!task) throw new HttpError(404, "Task not found");

			await db.withWrite(() => {
				db.tasks.deleteTask(id);
				db.actions.logAction("delete", task.owner || "", task.repo, { taskId: id });
			});
			return jsonApiRes({ message: "Deleted" }, "status");
		});
	}

	static async bulkCreate(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const { items, repo } = getAttributes(req);
			if (!Array.isArray(items) || !repo)
				throw new HttpError(400, "Invalid payload: requires 'items' array and 'repo'");

			const tasks = items.map((item: Record<string, unknown>) => ({
				...item,
				id: (item.id as string) || randomUUID(),
				// Normalize owner at write time — reject empty instead of persisting ""
				owner: resolveWriteOwner(item.owner),
				repo,
				task_code: (item.task_code as string) || randomUUID().substring(0, 8),
				created_at: (item.created_at as string) || new Date().toISOString(),
				updated_at: (item.updated_at as string) || new Date().toISOString()
			}));

			if (tasks.some((t) => !t.owner)) {
				throw new HttpError(400, "owner is required on every item (or set DASHBOARD_OWNER)");
			}

			const count = await db.withWrite(() => {
				const n = db.tasks.bulkInsertTasks(tasks as Task[]);
				db.actions.logAction("write", tasks[0]?.owner ?? "", repo, { query: `Bulk imported ${n} tasks` });
				return n;
			});
			return jsonApiRes({ count }, "status");
		});
	}

	static async getTimeStats(req: express.Request, res: express.Response) {
		await handleController(req, res, () => {
			const { repo } = req.query;
			const targetRepo = typeof repo === "string" && repo.length > 0 ? repo : null;

			const stats = {
				daily: {
					...db.taskStats.getTaskTimeStats("", targetRepo, "daily"),
					history: db.taskStats.getTaskComparisonSeries("", targetRepo, "daily")
				},
				weekly: {
					...db.taskStats.getTaskTimeStats("", targetRepo, "weekly"),
					history: db.taskStats.getTaskComparisonSeries("", targetRepo, "weekly")
				},
				monthly: {
					...db.taskStats.getTaskTimeStats("", targetRepo, "monthly"),
					history: db.taskStats.getTaskComparisonSeries("", targetRepo, "monthly")
				},
				overall: {
					...db.taskStats.getTaskTimeStats("", targetRepo, "overall"),
					history: db.taskStats.getTaskComparisonSeries("", targetRepo, "overall")
				}
			};

			return jsonApiRes(stats, "performance-stats");
		});
	}

	static async updateComment(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const { id } = req.params as unknown as IdParams;
			const { comment } = getAttributes(req);
			const existingComment = db.taskComments.getTaskCommentById(id);
			if (!existingComment) throw new HttpError(404, "Comment not found");

			await db.withWrite(() => db.taskComments.updateTaskComment(id, { comment }));
			return jsonApiRes({ message: "Updated" }, "status");
		});
	}

	static async deleteComment(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const { id } = req.params as unknown as IdParams;
			await db.withWrite(() => db.taskComments.deleteTaskComment(id));
			return jsonApiRes({ message: "Deleted" }, "status");
		});
	}
}
