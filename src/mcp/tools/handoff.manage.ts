import { randomUUID } from "crypto";
import { SQLiteStore } from "../storage/sqlite";
import { createMcpResponse } from "../utils/mcp-response";
import {
	ClaimListSchema,
	ClaimReleaseSchema,
	HandoffCreateSchema,
	HandoffListSchema,
	HandoffUpdateSchema,
	TaskClaimSchema
} from "./schemas";
import { UUID_REGEX } from "../utils/uuid";
import { TASK_STATUS_IN_PROGRESS } from "../types";
import { extractNextSteps } from "../utils/next-steps";
import { logger } from "../utils/logger";

function buildHandoffListSummary(repo: string, count: number, status?: string, fromAgent?: string, toAgent?: string) {
	const parts = [`Found ${count} handoff${count === 1 ? "" : "s"} in repo "${repo}".`];

	if (status) {
		parts.push(`Status filter: ${status}.`);
	}

	if (fromAgent) {
		parts.push(`From agent: ${fromAgent}.`);
	}

	if (toAgent) {
		parts.push(`To agent: ${toAgent}.`);
	}

	return parts.join("\n");
}

// extractNextSteps imported from ../utils/next-steps

function buildClaimListSummary(repo: string, count: number, agent?: string, activeOnly?: boolean) {
	const parts = [`Found ${count} claim${count === 1 ? "" : "s"} in repo "${repo}".`];

	if (agent) {
		parts.push(`Agent filter: ${agent}.`);
	}

	if (activeOnly) {
		parts.push("Showing active claims only.");
	}

	return parts.join("\n");
}

export async function handleHandoffCreate(args: unknown, storage: SQLiteStore) {
	const validated = HandoffCreateSchema.parse(args);
	const { owner, repo, from_agent, to_agent, task_id, task_code, summary, context, expires_at, json } = validated;

	let resolvedTaskId = task_id ?? null;
	if (resolvedTaskId && !UUID_REGEX.test(resolvedTaskId)) {
		const task = storage.tasks.getTaskByCode(owner, repo, resolvedTaskId);
		if (!task) {
			throw new Error(`Task not found: ${resolvedTaskId} in repo ${repo}`);
		}
		resolvedTaskId = task.id;
	}
	if (!resolvedTaskId && task_code) {
		const task = storage.tasks.getTaskByCode(owner, repo, task_code);
		if (!task) {
			throw new Error(`Task not found: ${task_code} in repo ${repo}`);
		}
		resolvedTaskId = task.id;
	}

	const handoff = storage.handoffs.createHandoff({
		owner: owner,
		repo,
		from_agent,
		to_agent,
		task_id: resolvedTaskId,
		summary,
		context,
		expires_at
	});

	// Auto-comment on linked task for traceability
	if (handoff.task_id) {
		const now = new Date().toISOString();
		const target = handoff.to_agent || "unassigned";
		try {
			storage.taskComments.insertTaskComment({
				id: randomUUID(),
				task_id: handoff.task_id,
				owner,
				repo,
				comment: `Handoff [${handoff.id.slice(0, 8)}] created: ${handoff.from_agent} → ${target} — ${handoff.summary}`,
				agent: handoff.from_agent,
				role: "unknown",
				model: "system",
				previous_status: null,
				next_status: null,
				created_at: now
			});
		} catch (e) {
			logger.error("[Tool] handoff.manage — task comment failed (handoff already committed)", {
				repo,
				handoffId: handoff.id,
				error: String(e)
			});
			storage.actions.logAction("handoff-comment-fail", owner, repo, {
				query: `handoff ${handoff.id.slice(0, 8)} — comment insert failed`
			});
		}
	}

	const contentSummary = `Created handoff [${handoff.id.slice(0, 8)}] in repo "${handoff.repo}": from=${handoff.from_agent}, to=${handoff.to_agent || "unassigned"}, status=${handoff.status}.`;

	return createMcpResponse(handoff, contentSummary, {
		contentSummary,
		includeJson: json
	});
}

export async function handleHandoffList(args: unknown, storage: SQLiteStore) {
	const parsed = HandoffListSchema.safeParse(args);
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
	const { owner, repo, status, from_agent, to_agent, limit, offset, json } = validated;

	const handoffs = storage.handoffs.listHandoffs({
		owner: owner,
		repo,
		status,
		from_agent,
		to_agent,
		limit,
		offset
	});

	const COLUMNS = [
		"id",
		"from_agent",
		"to_agent",
		"task_id",
		"task_code",
		"status",
		"created_at",
		"updated_at",
		"expires_at",
		"summary",
		"context"
	] as const;
	const rows = handoffs.map((handoff) => [
		handoff.id,
		handoff.from_agent,
		handoff.to_agent,
		handoff.task_id,
		handoff.task_code ?? null,
		handoff.status,
		handoff.created_at,
		handoff.updated_at,
		handoff.expires_at,
		handoff.summary,
		handoff.context
	]);

	const structuredData = {
		schema: "handoff-read" as const,
		handoffs: {
			columns: [...COLUMNS],
			rows
		},
		count: rows.length,
		offset
	};

	const contentSummary = buildHandoffListSummary(repo, rows.length, status, from_agent, to_agent);

	return createMcpResponse(structuredData, contentSummary, {
		contentSummary,
		includeJson: json
	});
}

export async function handleHandoffUpdate(args: unknown, storage: SQLiteStore) {
	const validated = HandoffUpdateSchema.parse(args);
	const { id, status, json } = validated;

	const existing = storage.handoffs.getHandoffById(id);
	if (!existing) {
		throw new Error(`Handoff not found: ${id}`);
	}

	const success = storage.handoffs.updateHandoffStatus(id, status);
	if (!success) {
		throw new Error(`Failed to update handoff: ${id}`);
	}

	const updated = storage.handoffs.getHandoffById(id);

	// Auto-comment on status change for traceability
	if (updated?.task_id && status !== existing.status) {
		const now = new Date().toISOString();
		let comment: string;
		if (status === "accepted") {
			const steps = extractNextSteps(existing.context as Record<string, unknown>);
			comment = `Handoff [${id.slice(0, 8)}] accepted by ${updated.to_agent || existing.from_agent}.`;
			if (steps) {
				comment += ` Next steps: ${steps}`;
			}
		} else {
			comment = `Handoff [${id.slice(0, 8)}] ${status}`;
		}
		try {
			storage.taskComments.insertTaskComment({
				id: randomUUID(),
				task_id: updated.task_id,
				owner: updated.owner,
				repo: updated.repo,
				comment,
				agent: existing.from_agent,
				role: "unknown",
				model: "system",
				previous_status: null,
				next_status: null,
				created_at: now
			});
		} catch (e) {
			logger.error("[Tool] handoff.manage — task comment failed (handoff already committed)", {
				repo: updated.repo,
				handoffId: id,
				status,
				error: String(e)
			});
			storage.actions.logAction("handoff-comment-fail", updated.owner, updated.repo, {
				query: `handoff ${id.slice(0, 8)} — status-change comment failed`
			});
		}
	}

	const result = {
		success,
		id,
		status,
		handoff: updated
	};
	const contentSummary = `Updated handoff [${id.slice(0, 8)}] to "${status}" in repo "${existing.repo}".`;

	return createMcpResponse(result, contentSummary, {
		contentSummary,
		includeJson: json
	});
}

export async function handleTaskClaim(args: unknown, storage: SQLiteStore) {
	const validated = TaskClaimSchema.parse(args);
	const { owner, repo, task_id, task_code, agent, role, metadata, json } = validated;

	let taskId = task_id;
	if (taskId && !UUID_REGEX.test(taskId)) {
		const task = storage.tasks.getTaskByCode(owner, repo, taskId);
		if (!task) {
			throw new Error(`Task not found: ${taskId} in repo ${repo}`);
		}
		taskId = task.id;
	}
	let resolvedTaskCode: string;
	let task: import("../types").Task | null;

	if (taskId) {
		task = storage.tasks.getTaskById(taskId);
		if (!task || task.repo !== repo) {
			throw new Error(`Task not found: ${taskId} in repo ${repo}`);
		}
		resolvedTaskCode = task.task_code;
	} else if (task_code) {
		task = storage.tasks.getTaskByCode(owner, repo, task_code);
		if (!task) {
			throw new Error(`Task not found: ${task_code} in repo ${repo}`);
		}
		taskId = task.id;
		resolvedTaskCode = task.task_code;
	} else {
		throw new Error("Either task_id or task_code must be provided");
	}

	const claim = storage.handoffs.claimTask({
		owner: owner,
		repo,
		task_id: taskId!,
		agent,
		role,
		metadata
	});

	if (task && task.status !== "completed") {
		const now = new Date().toISOString();
		storage.tasks.updateTask(task.id, { status: TASK_STATUS_IN_PROGRESS, in_progress_at: now });
		try {
			storage.taskComments.insertTaskComment({
				id: randomUUID(),
				task_id: task.id,
				owner: owner,
				repo,
				comment: `Claimed by ${agent} — auto-promoted to in_progress`,
				agent,
				role: role || "unknown",
				model: "system",
				previous_status: task.status as import("../types").TaskStatus,
				next_status: TASK_STATUS_IN_PROGRESS,
				created_at: now
			});
		} catch (e) {
			logger.error("[Tool] handoff.manage — task comment failed (claim succeeded)", {
				repo,
				taskId: task.id,
				agent,
				error: String(e)
			});
			storage.actions.logAction("handoff-comment-fail", owner, repo, {
				query: `task ${task.task_code} — claim comment failed`
			});
		}
	}

	const responseData = {
		...claim,
		task_code: resolvedTaskCode
	};

	const contentSummary = `Claimed [${resolvedTaskCode || claim.task_id.slice(0, 8)}] in repo "${claim.repo}": agent=${claim.agent}, role=${claim.role}.`;

	return createMcpResponse(responseData, contentSummary, {
		contentSummary,
		includeJson: json
	});
}

export async function handleClaimList(args: unknown, storage: SQLiteStore) {
	const validated = ClaimListSchema.parse(args);
	const { owner, repo, agent, active_only, limit, offset, json } = validated;

	const claims = storage.handoffs.listClaims({
		owner: owner,
		repo,
		agent,
		active_only,
		limit,
		offset
	});

	const COLUMNS = ["id", "task_id", "task_code", "agent", "role", "claimed_at", "released_at", "metadata"] as const;
	const rows = claims.map((claim) => [
		claim.id,
		claim.task_id,
		claim.task_code ?? null,
		claim.agent,
		claim.role,
		claim.claimed_at,
		claim.released_at,
		claim.metadata
	]);

	const structuredData = {
		schema: "claim-list" as const,
		claims: {
			columns: [...COLUMNS],
			rows
		},
		count: rows.length,
		offset
	};

	const contentSummary = buildClaimListSummary(repo, rows.length, agent, active_only);

	return createMcpResponse(structuredData, contentSummary, {
		contentSummary,
		includeJson: json
	});
}

export async function handleClaimRelease(args: unknown, storage: SQLiteStore) {
	const validated = ClaimReleaseSchema.parse(args);
	const { owner, repo, task_id, task_code, agent, json } = validated;

	let resolvedTaskId = task_id;
	if (resolvedTaskId && !UUID_REGEX.test(resolvedTaskId)) {
		const task = storage.tasks.getTaskByCode(owner, repo, resolvedTaskId);
		if (!task) {
			throw new Error(`Task not found: ${resolvedTaskId} in repo ${repo}`);
		}
		resolvedTaskId = task.id;
	}
	let resolvedTaskCode: string | null = task_code ?? null;

	if (resolvedTaskId) {
		const task = storage.tasks.getTaskById(resolvedTaskId);
		if (!task || task.repo !== repo) {
			throw new Error(`Task not found: ${resolvedTaskId} in repo ${repo}`);
		}
		resolvedTaskCode = task.task_code;
	} else if (task_code) {
		const task = storage.tasks.getTaskByCode(owner, repo, task_code);
		if (!task) {
			throw new Error(`Task not found: ${task_code} in repo ${repo}`);
		}
		resolvedTaskId = task.id;
		resolvedTaskCode = task.task_code;
	}

	const success = storage.handoffs.releaseClaim(resolvedTaskId!, agent);
	if (!success) {
		throw new Error(`No active claim found for task ${resolvedTaskCode || resolvedTaskId}`);
	}

	const result = {
		success,
		repo,
		task_id: resolvedTaskId!,
		task_code: resolvedTaskCode,
		agent: agent ?? null
	};
	const contentSummary = `Released claim for [${resolvedTaskCode || resolvedTaskId?.slice(0, 8)}] in repo "${repo}": agent=${agent || "any"}.`;

	return createMcpResponse(result, contentSummary, {
		contentSummary,
		includeJson: json
	});
}
