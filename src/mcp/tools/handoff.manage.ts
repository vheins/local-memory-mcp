import { SQLiteStore } from "../storage/sqlite";
import { createMcpResponse } from "../utils/mcp-response";
import { HandoffCreateSchema, HandoffListSchema, TaskClaimSchema } from "./schemas";

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

export async function handleHandoffCreate(args: unknown, storage: SQLiteStore) {
	const validated = HandoffCreateSchema.parse(args);
	const { repo, from_agent, to_agent, task_id, task_code, summary, context, expires_at, structured } = validated;

	let resolvedTaskId = task_id ?? null;
	if (!resolvedTaskId && task_code) {
		const task = storage.tasks.getTaskByCode(repo, task_code);
		if (!task) {
			throw new Error(`Task not found: ${task_code} in repo ${repo}`);
		}
		resolvedTaskId = task.id;
	}

	const handoff = storage.handoffs.createHandoff({
		repo,
		from_agent,
		to_agent,
		task_id: resolvedTaskId,
		summary,
		context,
		expires_at
	});

	const contentSummary = [
		`Created handoff ${handoff.id}.`,
		`Repo: ${handoff.repo}`,
		`From: ${handoff.from_agent}`,
		`To: ${handoff.to_agent || "unassigned"}`,
		`Status: ${handoff.status}`,
		`Task ID: ${handoff.task_id || "-"}`,
		`Summary: ${handoff.summary}`
	].join("\n");

	return createMcpResponse(handoff, contentSummary, {
		contentSummary,
		includeSerializedStructuredContent: structured
	});
}

export async function handleHandoffList(args: unknown, storage: SQLiteStore) {
	const validated = HandoffListSchema.parse(args);
	const { repo, status, from_agent, to_agent, limit, offset, structured } = validated;

	const handoffs = storage.handoffs.listHandoffs({
		repo,
		status,
		from_agent,
		to_agent,
		limit,
		offset
	});

	const COLUMNS = ["id", "from_agent", "to_agent", "task_id", "status", "created_at", "summary"] as const;
	const rows = handoffs.map((handoff) => [
		handoff.id,
		handoff.from_agent,
		handoff.to_agent,
		handoff.task_id,
		handoff.status,
		handoff.created_at,
		handoff.summary
	]);

	const structuredData = {
		schema: "handoff-list" as const,
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
		includeSerializedStructuredContent: structured
	});
}

export async function handleTaskClaim(args: unknown, storage: SQLiteStore) {
	const validated = TaskClaimSchema.parse(args);
	const { repo, task_id, task_code, agent, role, metadata, structured } = validated;

	let taskId = task_id;
	let resolvedTaskCode: string;

	if (taskId) {
		const task = storage.tasks.getTaskById(taskId);
		if (!task || task.repo !== repo) {
			throw new Error(`Task not found: ${taskId} in repo ${repo}`);
		}
		resolvedTaskCode = task.task_code;
	} else if (task_code) {
		const task = storage.tasks.getTaskByCode(repo, task_code);
		if (!task) {
			throw new Error(`Task not found: ${task_code} in repo ${repo}`);
		}
		taskId = task.id;
		resolvedTaskCode = task.task_code;
	} else {
		throw new Error("Either task_id or task_code must be provided");
	}

	const claim = storage.handoffs.claimTask({
		repo,
		task_id: taskId!,
		agent,
		role,
		metadata
	});

	const responseData = {
		...claim,
		task_code: resolvedTaskCode
	};

	const contentSummary = [
		`Claimed task ${resolvedTaskCode || claim.task_id}.`,
		`Repo: ${claim.repo}`,
		`Task ID: ${claim.task_id}`,
		`Agent: ${claim.agent}`,
		`Role: ${claim.role}`,
		`Claimed At: ${claim.claimed_at}`
	].join("\n");

	const response = createMcpResponse(responseData, contentSummary, {
		contentSummary,
		includeSerializedStructuredContent: structured
	});

	if (structured) {
		response.structuredContent = responseData;
	}

	return response;
}
