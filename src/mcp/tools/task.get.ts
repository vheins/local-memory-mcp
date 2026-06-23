import { SQLiteStore } from "../storage/sqlite";
import { createMcpResponse } from "../utils/mcp-response";
import { TaskGetSchema } from "./schemas";

export async function handleTaskGet(args: unknown, storage: SQLiteStore) {
	const validated = TaskGetSchema.parse(args);
	const { owner, repo, id, task_code, structured: isStructuredRequest } = validated;

	let task;
	if (id) {
		task = storage.tasks.getTaskById(id);
	} else if (task_code) {
		task = storage.tasks.getTaskByCode(owner, repo, task_code);
	} else {
		throw new Error("Either id or task_code must be provided");
	}

	if (!task) {
		throw new Error(`Task not found: ${id || task_code} in repo ${repo}`);
	}

	const comments = storage.taskComments.getTaskCommentsByTaskId(task.id);
	const children = storage.tasks.getChildrenByParentId(task.id);
	const depended_by = storage.tasks.getDependedByTaskId(task.id);

	let contentSummary: string | undefined;
	if (!isStructuredRequest) {
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

	const structuredData = {
		...task,
		comments,
		children,
		depended_by
	};

	return createMcpResponse(structuredData, contentSummary || "", {
		contentSummary,
		includeSerializedStructuredContent: isStructuredRequest
	});
}
