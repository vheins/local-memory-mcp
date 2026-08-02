import { randomUUID } from "crypto";
import { SQLiteStore } from "../storage/sqlite";
import { buildTableResult, createMcpResponse } from "../utils/mcp-response";
import { parseArgs } from "../utils/mcp-error";
import {
	ClaimListSchema,
	ClaimReleaseSchema,
	HandoffCreateSchema,
	HandoffListSchema,
	HandoffUpdateSchema,
	TaskClaimSchema
} from "./schemas";
import { UUID_REGEX } from "../utils/uuid";
import { extractNextSteps } from "../utils/next-steps";
import { logger } from "../utils/logger";
import { claimCoordinated, listClaimsTable, releaseClaim } from "../utils/coordination";

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
//
// NOTE (OPT-DRY-02): the claim lifecycle ops below (handleTaskClaim /
// handleClaimList / handleClaimRelease) delegate to the shared coordination
// helpers in ../utils/coordination — the single source of truth shared with
// claim.manage.ts. handleHandoffCreate keeps its own lightweight task-link
// resolution because it is OPTIONAL (a handoff may be created without a task
// ref) whereas resolveTaskByRef requires a resolvable task.

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
	// Centralized validation (OPT-CODE-01): throws on failure — the transport
	// catch converts it to the canonical toErrorResponse envelope.
	const validated = parseArgs(HandoffListSchema, args);
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

	const structuredData = buildTableResult(COLUMNS, rows, {
		schema: "handoff-read",
		key: "handoffs",
		count: rows.length,
		offset
	});

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

/**
 * Legacy CLAIM handler — delegates to the shared coordination lifecycle
 * (utils/coordination.ts, OPT-DRY-02), which also serves claim-manage.
 * Kept alive until OPT-CODE-02 / OPT-FEAT-01 remove the dashboard shim.
 */
export async function handleTaskClaim(args: unknown, storage: SQLiteStore) {
	const validated = TaskClaimSchema.parse(args);
	const { owner, repo, task_id, task_code, agent, role, metadata, json } = validated;

	return claimCoordinated(owner, repo, task_id, task_code, agent, role, metadata, json, storage);
}

/**
 * Legacy CLAIM-LIST handler — delegates to the shared coordination table
 * builder with the legacy "claim-list" schema discriminator.
 */
export async function handleClaimList(args: unknown, storage: SQLiteStore) {
	const validated = ClaimListSchema.parse(args);
	const { owner, repo, agent, active_only, limit, offset, json } = validated;

	return listClaimsTable(owner, repo, agent, active_only, limit, offset, "claim-list", json, storage);
}

/**
 * Legacy CLAIM-RELEASE handler — delegates to the shared coordination
 * lifecycle (utils/coordination.ts, OPT-DRY-02).
 */
export async function handleClaimRelease(args: unknown, storage: SQLiteStore) {
	const validated = ClaimReleaseSchema.parse(args);
	const { owner, repo, task_id, task_code, agent, json } = validated;

	return releaseClaim(owner, repo, task_id, task_code, agent, json, storage);
}
