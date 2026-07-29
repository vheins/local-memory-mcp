import { SQLiteStore } from "../../storage/sqlite";
import { Task } from "../../types";
import { createMcpResponse, McpResponse } from "../../utils/mcp-response";
import { logger } from "../../utils/logger";
import { fetchAggregatedTaskKgContext } from "../kg-archivist/query";
import { capitalize, describeStatusFilter } from "./shared";

// ── LIST mode ─────────────────────────────────────────────────────────────

export async function handleListMode(
	owner: string,
	repo: string,
	status: string | undefined,
	phase: string | undefined,
	limit: number,
	offset: number,
	isJsonRequest: boolean,
	storage: SQLiteStore
): Promise<McpResponse> {
	// Default status filter matches existing task-list behaviour
	const effectiveStatus = status ?? "backlog,in_progress";

	let statuses: string[] = [];
	if (effectiveStatus !== "all") {
		statuses = effectiveStatus
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
	}

	const tasks = storage.tasks.getTasksByMultipleStatuses(owner, repo, statuses, limit, offset);
	const filteredTasks = phase
		? tasks.filter((t: Task) => t.phase && t.phase.toLowerCase() === phase.toLowerCase())
		: tasks;

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

	const structuredData: Record<string, unknown> = {
		schema: "task-read/list",
		tasks: {
			columns: [...COLUMNS],
			rows
		},
		count: rows.length,
		offset
	};

	// Best-effort KG context (REFACTOR-KG-004)
	if (filteredTasks.length > 0) {
		const kgData = fetchAggregatedTaskKgContext(storage, repo, filteredTasks);
		if (kgData) structuredData.kg = kgData;
	}

	let contentSummary: string | undefined;
	if (!isJsonRequest) {
		const statusLabel = describeStatusFilter(effectiveStatus);
		const taskLabel = rows.length === 1 ? "task" : "tasks";

		const parts: string[] = [];

		// Group by status for display
		const tasksByStatus: Record<string, Task[]> = {};
		for (const t of filteredTasks) {
			const statusLabel = t.status === "in_progress" ? "In Progress" : capitalize(t.status);
			if (!tasksByStatus[statusLabel]) {
				tasksByStatus[statusLabel] = [];
			}
			tasksByStatus[statusLabel].push(t);
		}

		if (Object.keys(tasksByStatus).length > 0) {
			const statusBreakdown = Object.entries(tasksByStatus)
				.map(([sts, items]) => `${sts.toLowerCase()}: ${items.length}`)
				.join(" · ");
			parts.push(`Task List — ${rows.length} total in repo "${repo}" (showing ${rows.length})`);
			parts.push(statusBreakdown);
			parts.push("");
			for (const [sts, items] of Object.entries(tasksByStatus)) {
				if (items.length > 0) {
					parts.push("");
					parts.push(`### ${sts}`);
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
			parts.push(`Found ${rows.length} ${statusLabel} ${taskLabel} in repo "${repo}".`);
		}

		if (phase) {
			parts.push("");
			parts.push(`Phase filter: ${phase}.`);
		}

		parts.push("");
		parts.push("See task-detail with task_code for details.");

		contentSummary = parts.join("\n").trim();
	}

	logger.info("[Tool] task-read/list", {
		repo,
		status: effectiveStatus,
		phase,
		count: rows.length,
		offset
	});

	return createMcpResponse(structuredData, contentSummary || "", {
		contentSummary,
		includeJson: isJsonRequest
	});
}
