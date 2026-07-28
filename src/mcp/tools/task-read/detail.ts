import { SQLiteStore } from "../../storage/sqlite";
import { Task } from "../../types";
import { createMcpResponse, McpResponse } from "../../utils/mcp-response";
import { UUID_REGEX } from "../../utils/uuid";
import { logger } from "../../utils/logger";
import { fetchTaskKgContext, fetchAggregatedTaskKgContext } from "../kg-archivist/query";

// ── DETAIL mode ───────────────────────────────────────────────────────────

export async function handleDetailMode(
	owner: string,
	repo: string,
	id: string | undefined,
	code: string | undefined,
	ids: string[] | undefined,
	codes: string[] | undefined,
	isJsonRequest: boolean,
	storage: SQLiteStore
): Promise<McpResponse> {
	// ── Single detail ──
	if (id || code) {
		const identifier = id || code!;
		let task: Task | null;
		if (id) {
			task = UUID_REGEX.test(id) ? storage.tasks.getTaskById(id) : storage.tasks.getTaskByCode(owner, repo, id);
		} else {
			task = storage.tasks.getTaskByCode(owner, repo, code!);
		}

		if (!task) {
			throw new Error(`Task not found: ${identifier} in repo ${repo}`);
		}

		const comments = storage.taskComments.getTaskCommentsByTaskId(task.id);
		const children = storage.tasks.getChildrenByParentId(task.id);
		const depended_by = storage.tasks.getDependedByTaskId(task.id);

		let contentSummary: string | undefined;
		if (!isJsonRequest) {
			const lines: string[] = [
				`Task: ${task.title}`,
				`Code: ${task.task_code}`,
				`Repo: ${task.repo}`,
				`Status: ${task.status}`,
				`Priority: ${task.priority}`,
				`ID: ${task.id}`
			];

			if (task.phase) lines.push(`Phase: ${task.phase}`);
			if (task.parent_code) lines.push(`Parent: ${task.parent_code} (${task.parent_id || ""})`);
			if (task.depends_on_code) lines.push(`Depends On: ${task.depends_on_code} (${task.depends_on || ""})`);
			if (task.doc_path) lines.push(`Doc Path: ${task.doc_path}`);
			if (task.description) lines.push(`Description: ${task.description}`);
			if (task.tags && task.tags.length > 0) lines.push(`Tags: ${task.tags.join(", ")}`);
			if (task.suggested_skills && task.suggested_skills.length > 0)
				lines.push(`Suggested Skills: ${task.suggested_skills.join(", ")}`);
			if (task.est_tokens) lines.push(`Est Tokens: ${task.est_tokens}`);
			if (task.commit_id) lines.push(`Commit: ${task.commit_id}`);
			if (task.changed_files && task.changed_files.length > 0)
				lines.push(`Changed Files: ${task.changed_files.join(", ")}`);
			if (task.metadata) lines.push(`Metadata: ${JSON.stringify(task.metadata)}`);
			if (task.comments_count !== undefined) lines.push(`Comments: ${task.comments_count}`);
			if (task.coordination) {
				if (task.coordination.active_claim_count > 0) {
					lines.push(
						`Claim: ${task.coordination.active_claim_agent || "?"} (${task.coordination.active_claim_role || ""}) since ${task.coordination.active_claim_claimed_at || ""}`
					);
				}
				if (task.coordination.pending_handoff_count > 0) {
					lines.push(
						`Handoff: ${task.coordination.pending_handoff_summary || ""} → ${task.coordination.pending_handoff_to_agent || "?"}`
					);
				}
			}
			lines.push(`Created: ${task.created_at}`);
			if (task.updated_at) lines.push(`Updated: ${task.updated_at}`);
			if (task.in_progress_at) lines.push(`Started: ${task.in_progress_at}`);
			if (task.finished_at) lines.push(`Finished: ${task.finished_at}`);
			if (task.canceled_at) lines.push(`Canceled: ${task.canceled_at}`);

			if (children.length > 0) {
				lines.push("", "--- Children ---");
				for (const c of children) {
					lines.push(`- ${c.task_code}: ${c.title} (${c.status})`);
				}
			}

			if (depended_by.length > 0) {
				lines.push("", "--- Depended By ---");
				for (const d of depended_by) {
					lines.push(`- ${d.task_code}: ${d.title} (${d.status})`);
				}
			}

			if (comments.length > 0) {
				lines.push("", "--- History ---");
				for (const c of comments) {
					const statusChange =
						c.previous_status || c.next_status ? ` [${c.previous_status || "?"} → ${c.next_status || "?"}]` : "";
					const agentInfo = c.agent ? ` (${c.agent})` : "";
					lines.push(`- ${c.created_at}${statusChange}${agentInfo}: ${c.comment}`);
				}
			}
			contentSummary = lines.join("\n");
		}

		// Best-effort KG context fetch based on task title + description
		const kgContext = fetchTaskKgContext(storage, repo, task.title, task.description || "");

		const data: Record<string, unknown> = {
			...task,
			comments,
			children,
			depended_by
		};
		if (kgContext) data.kg = kgContext;

		return createMcpResponse(data, contentSummary || "", {
			contentSummary,
			includeJson: isJsonRequest
		});
	}

	// ── Bulk detail ──
	let tasks: Task[] = [];
	if (ids) {
		tasks = storage.tasks.getTasksByIds(ids);
	} else if (codes) {
		for (const code of codes) {
			const t = storage.tasks.getTaskByCode(owner, repo, code);
			if (t) tasks.push(t);
		}
	}

	if (tasks.length === 0) {
		throw new Error("No tasks found for the provided identifiers");
	}

	// Enrich each task with comments, children, depended_by
	const enriched = tasks.map((t) => {
		const comments = storage.taskComments.getTaskCommentsByTaskId(t.id);
		const children = storage.tasks.getChildrenByParentId(t.id);
		const depended_by = storage.tasks.getDependedByTaskId(t.id);
		return { ...t, comments, children, depended_by };
	});

	// Best-effort aggregated KG context from all task titles + descriptions
	const combinedTitle = enriched.map((t) => t.title).join(" ");
	const combinedDesc = enriched
		.map((t) => t.description || "")
		.filter(Boolean)
		.join(" ");
	const kgContext = fetchTaskKgContext(storage, repo, combinedTitle, combinedDesc);

	let contentSummary: string | undefined;
	if (!isJsonRequest) {
		contentSummary = `Found ${enriched.length} tasks in repo "${repo}".`;
	}

	logger.info("[Tool] task-read/detail", {
		repo,
		count: enriched.length,
		bulk: !(id || code)
	});

	const data: Record<string, unknown> = {
		schema: "task-read/detail" as const,
		count: enriched.length,
		tasks: enriched
	};
	if (kgContext) data.kg = kgContext;

	return createMcpResponse(data, contentSummary || `Found ${enriched.length} tasks.`, {
		contentSummary,
		includeJson: isJsonRequest
	});
}
