import { randomUUID } from "crypto";
import { SQLiteStore } from "../storage/sqlite";
import { buildTableResult, createMcpResponse } from "../utils/mcp-response";
import { ClaimManageSchema } from "./schemas";
import { UUID_REGEX } from "../utils/uuid";
import { TASK_STATUS_IN_PROGRESS } from "../types";

/**
 * Summary builder for claim list results.
 */
function buildClaimListSummary(
	repo: string,
	count: number,
	agent?: string,
	activeOnly?: boolean,
	sampleClaims?: Array<{ task_code?: string | null; agent: string; role: string }>
) {
	const parts: string[] = [`Found ${count} claim${count === 1 ? "" : "s"} in repo "${repo}".`];

	if (sampleClaims && sampleClaims.length > 0) {
		const lines = sampleClaims.slice(0, 3).map((c) => {
			const code = c.task_code || "?";
			return `  [${code}] by ${c.agent} (${c.role || "unknown"})`;
		});
		parts.push("", ...lines);
		if (count > 3) parts.push(`  ... and ${count - 3} more`);
	}

	if (agent) {
		parts.push(`  Agent filter: ${agent}.`);
	}

	if (activeOnly) {
		parts.push("  Showing active claims only.");
	}

	return parts.join("\n");
}

/**
 * Resolves task_id or task_code to a { taskId, taskCode, task } triple.
 * Throws if neither is provided or if the task cannot be found.
 */
function resolveTask(
	owner: string,
	repo: string,
	taskId: string | undefined,
	taskCode: string | undefined,
	storage: SQLiteStore
): { taskId: string; taskCode: string; task: import("../types").Task } {
	let resolvedId = taskId;
	let resolvedCode: string | null = taskCode ?? null;

	// task_code supplied in task_id slot → resolve via code
	if (resolvedId && !UUID_REGEX.test(resolvedId)) {
		const task = storage.tasks.getTaskByCode(owner, repo, resolvedId);
		if (!task) {
			throw new Error(`Task not found: ${resolvedId} in repo ${repo}`);
		}
		resolvedId = task.id;
		resolvedCode = task.task_code;
	}

	// resolvedId is a UUID → fetch by id
	if (resolvedId) {
		const task = storage.tasks.getTaskById(resolvedId);
		if (!task || task.repo !== repo) {
			throw new Error(`Task not found: ${resolvedId} in repo ${repo}`);
		}
		return { taskId: resolvedId, taskCode: resolvedCode ?? task.task_code, task };
	}

	// explicit task_code → resolve
	if (taskCode) {
		const task = storage.tasks.getTaskByCode(owner, repo, taskCode);
		if (!task) {
			throw new Error(`Task not found: ${taskCode} in repo ${repo}`);
		}
		return { taskId: task.id, taskCode: task.task_code, task };
	}

	throw new Error("Either task_id or task_code must be provided");
}

// ── CLAIM ────────────────────────────────────────────────────────────────

async function handleClaimOp(
	owner: string,
	repo: string,
	taskId: string | undefined,
	taskCode: string | undefined,
	agent: string,
	role: string | undefined,
	metadata: Record<string, unknown> | undefined,
	json: boolean,
	storage: SQLiteStore
) {
	const { taskId: resolvedId, taskCode: resolvedCode, task } = resolveTask(owner, repo, taskId, taskCode, storage);

	const claim = storage.handoffs.claimTask({
		owner,
		repo,
		task_id: resolvedId,
		agent,
		role,
		metadata
	});

	if (task.status !== "completed") {
		const now = new Date().toISOString();
		storage.tasks.updateTask(task.id, { status: TASK_STATUS_IN_PROGRESS, in_progress_at: now });
		storage.taskComments.insertTaskComment({
			id: randomUUID(),
			task_id: task.id,
			owner,
			repo,
			comment: `Claimed by ${agent} — auto-promoted to in_progress`,
			agent,
			role: role || "unknown",
			model: "system",
			previous_status: task.status as import("../types").TaskStatus,
			next_status: TASK_STATUS_IN_PROGRESS,
			created_at: now
		});
	}

	const responseData = {
		...claim,
		task_code: resolvedCode
	};

	const contentSummary = `Claimed [${resolvedCode || claim.task_id.slice(0, 8)}] in repo "${claim.repo}": agent=${claim.agent}, role=${claim.role}.`;

	return createMcpResponse(responseData, contentSummary, {
		contentSummary,
		includeJson: json
	});
}

// ── RELEASE ──────────────────────────────────────────────────────────────

async function handleReleaseOp(
	owner: string,
	repo: string,
	taskId: string | undefined,
	taskCode: string | undefined,
	agent: string | undefined,
	json: boolean,
	storage: SQLiteStore
) {
	const { taskId: resolvedId, taskCode: resolvedCode } = resolveTask(owner, repo, taskId, taskCode, storage);

	const success = storage.handoffs.releaseClaim(resolvedId, agent);
	if (!success) {
		throw new Error(`No active claim found for task ${resolvedCode || resolvedId}`);
	}

	const result = {
		success,
		repo,
		task_id: resolvedId,
		task_code: resolvedCode,
		agent: agent ?? null
	};
	const contentSummary = `Released claim for [${resolvedCode || resolvedId.slice(0, 8)}] in repo "${repo}": agent=${agent || "any"}.`;

	return createMcpResponse(result, contentSummary, {
		contentSummary,
		includeJson: json
	});
}

// ── LIST ─────────────────────────────────────────────────────────────────

async function handleListOp(
	owner: string,
	repo: string,
	agent: string | undefined,
	activeOnly: boolean,
	limit: number,
	offset: number,
	json: boolean,
	storage: SQLiteStore
) {
	const claims = storage.handoffs.listClaims({
		owner,
		repo,
		agent,
		active_only: activeOnly,
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

	const structuredData = buildTableResult(COLUMNS, rows, {
		schema: "claim-manage",
		key: "claims",
		count: rows.length,
		offset
	});

	const contentSummary = buildClaimListSummary(repo, rows.length, agent, activeOnly, claims);

	return createMcpResponse(structuredData, contentSummary, {
		contentSummary,
		includeJson: json
	});
}

// ── PUBLIC ENTRY POINT ──────────────────────────────────────────────────

/**
 * Handles all three claim operations in one unified tool.
 *
 * **Auto-infer logic (per ADR-004):**
 * - `release: true` + task_id/task_code → RELEASE (was claim-release)
 * - task_id/task_code + agent → CLAIM (was task-claim, auto-promote + audit)
 * - agent only (no task_id/task_code) → LIST claims by agent
 * - nothing → LIST all active claims
 *
 * All LIST modes support pagination (`limit`, `offset`) and `active_only` filter.
 */
export async function handleClaimManage(args: unknown, storage: SQLiteStore) {
	const validated = ClaimManageSchema.parse(args);
	const { owner, repo, task_id, task_code, agent, role, metadata, release, active_only, limit, offset, json } =
		validated;

	const hasTask = !!(task_id || task_code);

	// ── 1. release:true + task → RELEASE ──────────────────────────
	if (release && hasTask) {
		return handleReleaseOp(owner, repo, task_id, task_code, agent, json, storage);
	}

	// ── 2. task + agent → CLAIM (auto-promote + audit comment) ────
	if (hasTask && agent) {
		return handleClaimOp(owner, repo, task_id, task_code, agent, role, metadata, json, storage);
	}

	// ── 3. task only (no agent) → error ──────────────────────────
	if (hasTask && !agent) {
		throw new Error(
			"CLAIM requires agent. Combine task_id/task_code with agent for CLAIM, " + "or add release:true for RELEASE"
		);
	}

	// ── 4. agent only → LIST claims by agent ─────────────────────
	if (agent && !hasTask) {
		return handleListOp(owner, repo, agent, active_only, limit, offset, json, storage);
	}

	// ── 5. nothing → LIST all active claims ──────────────────────
	return handleListOp(owner, repo, undefined, active_only, limit, offset, json, storage);
}
