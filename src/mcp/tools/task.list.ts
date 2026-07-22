import { SQLiteStore } from "../storage/sqlite";
import { Task } from "../types";
import { createMcpResponse } from "../utils/mcp-response";
import { TaskListSchema } from "./schemas";
import { ZodError } from "zod";

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
				parts.push(`### ${capitalize(taskStatus)}`);
				parts.push("");
				parts.push("| code | status | priority | phase | last_updated | title |");
				parts.push("|------|--------|----------|-------|--------------|-------|");
				for (const t of items) {
					const lastUpdated = t.updated_at ? t.updated_at.slice(0, 16).replace("T", " ") : "never";
					parts.push(`| ${t.task_code} | ${t.status} | ${t.priority} | ${t.phase} | ${lastUpdated} | ${t.title} |`);
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

export async function handleTaskList(args: unknown, storage: SQLiteStore) {
	const parsed = TaskListSchema.safeParse(args);
	if (!parsed.success) {
		const missing = parsed.error.issues
			.filter((i) => i.path.some((p) => p === "owner" || p === "repo"))
			.map((i) => i.message)
			.filter(Boolean);
		const msg =
			missing.length > 0
				? `Missing required fields: ${missing.join("; ")}. Pass owner/repo explicitly or configure MCP workspace roots so they can be auto-inferred.`
				: `Validation error: ${parsed.error.message}`;
		return { content: [{ type: "text" as const, text: msg }], isError: true };
	}
	const validated = parsed.data;
	const { owner, repo, status, phase, query, limit, offset, json: isJsonRequest = false } = validated;

	let statuses: string[] = [];
	if (status !== "all") {
		statuses = status
			.split(",")
			.map((s: string) => s.trim())
			.filter(Boolean);
	}

	const tasks = storage.tasks.getTasksByMultipleStatuses(owner, repo, statuses, limit, offset, query);
	const filteredTasks = phase ? tasks.filter((t: Task) => t.phase.toLowerCase() === phase.toLowerCase()) : tasks;

	const COLUMNS = ["id", "task_code", "title", "status", "priority", "updated_at", "comments_count"] as const;
	const rows = filteredTasks.map((t: Task & { comments_count?: number }) => [
		t.id,
		t.task_code,
		t.title,
		t.status,
		t.priority,
		t.updated_at,
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
	if (!isJsonRequest) {
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
		includeJson: isJsonRequest
	});
}
