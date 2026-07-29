import { SQLiteStore } from "../storage/sqlite";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";
import { HandoffWriteSchema } from "./schemas";
import { UUID_REGEX } from "../utils/uuid";
import { HandoffStatusSchema } from "./schemas/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WriteParams = {
	// CREATE fields
	owner?: string;
	repo?: string;
	from_agent?: string;
	to_agent?: string;
	task_id?: string;
	task_code?: string;
	summary?: string;
	context?: Record<string, unknown>;
	expires_at?: string;

	// UPDATE fields
	id?: string;
	status?: string;

	// Metadata
	json: boolean;
};

// ---------------------------------------------------------------------------
// Core: CREATE handoff
// ---------------------------------------------------------------------------

async function coreCreate(
	params: WriteParams,
	storage: SQLiteStore
): Promise<{ handoff: Record<string, unknown>; contentSummary: string }> {
	if (!params.owner) {
		throw new Error("CREATE requires: owner");
	}
	if (!params.repo) {
		throw new Error("CREATE requires: repo");
	}
	if (!params.from_agent) {
		throw new Error("CREATE requires: from_agent");
	}
	if (!params.summary) {
		throw new Error("CREATE requires: summary");
	}

	// Validate status is not passed for CREATE
	if (params.status) {
		throw new Error("status is not valid for CREATE — use id + status for UPDATE");
	}

	// Transfer-context validation: reject completed-work summaries without
	// a target agent, linked task, or context describing remaining work
	if (
		!params.to_agent &&
		!params.task_id &&
		!params.task_code &&
		!params.context?.next_steps &&
		!params.context?.blockers &&
		!params.context?.remaining_work
	) {
		throw new Error(
			"Handoffs must identify a target agent, linked task, next_steps, blockers, or remaining_work. " +
				"Do not create pending handoffs for completed-work summaries."
		);
	}

	// Resolve task_id from task_code if provided
	let resolvedTaskId = params.task_id ?? null;
	if (resolvedTaskId && !UUID_REGEX.test(resolvedTaskId)) {
		const task = storage.tasks.getTaskByCode(params.owner, params.repo, resolvedTaskId);
		if (!task) {
			throw new Error(`Task not found: ${resolvedTaskId} in repo ${params.repo}`);
		}
		resolvedTaskId = task.id;
	}
	if (!resolvedTaskId && params.task_code) {
		const task = storage.tasks.getTaskByCode(params.owner, params.repo, params.task_code);
		if (!task) {
			throw new Error(`Task not found: ${params.task_code} in repo ${params.repo}`);
		}
		resolvedTaskId = task.id;
	}

	// Mutual exclusion: task_id and task_code
	if (params.task_id && params.task_code) {
		throw new Error("Provide either task_id or task_code, not both");
	}

	const handoff = storage.handoffs.createHandoff({
		owner: params.owner,
		repo: params.repo,
		from_agent: params.from_agent,
		to_agent: params.to_agent ?? null,
		task_id: resolvedTaskId,
		summary: params.summary,
		context: params.context,
		expires_at: params.expires_at ?? null
	});

	const excerpt = handoff.summary.length > 50 ? handoff.summary.slice(0, 50) + "..." : handoff.summary;
	const contentSummary = `Created [${handoff.id.slice(0, 8)}] "${excerpt}" — ${handoff.from_agent}→${handoff.to_agent || "unassigned"} (${handoff.status}) in "${handoff.repo}".`;

	return { handoff: handoff as unknown as Record<string, unknown>, contentSummary };
}

// ---------------------------------------------------------------------------
// Core: UPDATE handoff status
// ---------------------------------------------------------------------------

async function coreUpdate(
	params: WriteParams,
	storage: SQLiteStore
): Promise<{ result: Record<string, unknown>; contentSummary: string }> {
	if (!params.id) {
		throw new Error("UPDATE requires: id");
	}
	if (!params.status) {
		throw new Error("UPDATE requires: status");
	}

	// Validate status value
	const statusResult = HandoffStatusSchema.safeParse(params.status);
	if (!statusResult.success) {
		throw new Error(`Invalid status: "${params.status}". Must be one of: pending, accepted, rejected, expired`);
	}
	const status = statusResult.data;

	const existing = storage.handoffs.getHandoffById(params.id);
	if (!existing) {
		throw new Error(`Handoff not found: ${params.id}`);
	}

	const success = storage.handoffs.updateHandoffStatus(params.id, status);
	if (!success) {
		throw new Error(`Failed to update handoff: ${params.id}`);
	}

	const updated = storage.handoffs.getHandoffById(params.id);
	const result = {
		success,
		id: params.id,
		status,
		handoff: updated
	};
	const excerpt = existing.summary.length > 50 ? existing.summary.slice(0, 50) + "..." : existing.summary;
	const contentSummary = `Updated [${params.id.slice(0, 8)}] "${excerpt}" in "${existing.repo}" — ${existing.status} → ${status}.`;

	return { result, contentSummary };
}

// ---------------------------------------------------------------------------
// Main handler entry point
// ---------------------------------------------------------------------------

export async function handleHandoffWrite(params: Record<string, unknown>, storage: SQLiteStore): Promise<McpResponse> {
	const validated = HandoffWriteSchema.parse(params) as unknown as WriteParams;

	// ── UPDATE mode: id present ──
	if (validated.id) {
		const { result, contentSummary } = await coreUpdate(validated, storage);
		return createMcpResponse(result, contentSummary, {
			contentSummary,
			includeJson: validated.json
		});
	}

	// ── CREATE mode: summary + from_agent present (no id) ──
	if (validated.summary && validated.from_agent) {
		const { handoff, contentSummary } = await coreCreate(validated, storage);
		return createMcpResponse(handoff, contentSummary, {
			contentSummary,
			includeJson: validated.json
		});
	}

	// ── Nothing matched ──
	throw new Error(
		"Could not infer operation. Provide:\n" +
			"  - `summary` + `from_agent` (with `owner`, `repo`) for CREATE\n" +
			"  - `id` + `status` for UPDATE"
	);
}
