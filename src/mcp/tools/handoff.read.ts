import { SQLiteStore } from "../storage/sqlite";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";
import { HandoffReadSchema } from "./schemas";

// ---------------------------------------------------------------------------
// Summary builders
// ---------------------------------------------------------------------------

function buildHandoffListSummary(
	repo: string,
	count: number,
	status?: string,
	fromAgent?: string,
	toAgent?: string,
	sampleHandoffs?: Array<{ id: string; from_agent: string; to_agent: string | null; status: string; summary: string }>
) {
	const parts: string[] = [];
	const header = `Found ${count} handoff${count === 1 ? "" : "s"} in repo "${repo}".`;
	parts.push(header);

	if (sampleHandoffs && sampleHandoffs.length > 0) {
		const lines = sampleHandoffs
			.slice(0, 3)
			.map(
				(h) => `  [${h.id.slice(0, 8)}] ${h.from_agent}→${h.to_agent || "?"} (${h.status}): ${h.summary.slice(0, 60)}`
			);
		parts.push("", ...lines);
		if (count > 3) parts.push(`  ... and ${count - 3} more`);
	}

	if (status) {
		parts.push(`  Status filter: ${status}.`);
	}

	if (fromAgent) {
		parts.push(`  From agent: ${fromAgent}.`);
	}

	if (toAgent) {
		parts.push(`  To agent: ${toAgent}.`);
	}

	return parts.join("\n");
}

function buildClaimListSummary(
	repo: string,
	count: number,
	agent?: string,
	activeOnly?: boolean,
	sampleClaims?: Array<{ id: string; task_id: string; agent: string; status?: string }>
) {
	const parts: string[] = [];
	const header = `Found ${count} claim${count === 1 ? "" : "s"} in repo "${repo}".`;
	parts.push(header);

	if (sampleClaims && sampleClaims.length > 0) {
		const lines = sampleClaims
			.slice(0, 3)
			.map(
				(c) =>
					`  [${c.id.slice(0, 8)}] task=${c.task_id?.slice(0, 8) || "?"} agent=${c.agent} (${c.status || "active"})`
			);
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

// ---------------------------------------------------------------------------
// Core operations
// ---------------------------------------------------------------------------

/**
 * DETAIL: Fetch a single handoff by id.
 */
function coreDetail(id: string, json: boolean, storage: SQLiteStore): McpResponse {
	const handoff = storage.handoffs.getHandoffById(id);
	if (!handoff) {
		throw new Error(`Handoff not found: ${id}`);
	}

	const excerpt = handoff.summary.length > 60 ? handoff.summary.slice(0, 60) + "..." : handoff.summary;
	const contentSummary = `Handoff [${id.slice(0, 8)}] "${excerpt}" — ${handoff.from_agent}→${handoff.to_agent || "unassigned"} (${handoff.status})`;

	return createMcpResponse(handoff, contentSummary, {
		contentSummary,
		includeJson: json
	});
}

/**
 * LIST CLAIMS: Return claims with optional agent/active_only filters.
 */
function coreListClaims(
	owner: string,
	repo: string,
	agent: string | undefined,
	activeOnly: boolean,
	limit: number,
	offset: number,
	json: boolean,
	storage: SQLiteStore
): McpResponse {
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

	const structuredData = {
		schema: "claim-list" as const,
		claims: {
			columns: [...COLUMNS],
			rows
		},
		count: rows.length,
		offset
	};

	const contentSummary = buildClaimListSummary(repo, rows.length, agent, activeOnly, claims);

	return createMcpResponse(structuredData, contentSummary, {
		contentSummary,
		includeJson: json
	});
}

/**
 * LIST / SEARCH HANDOFFS: Return handoffs with optional status/from_agent/to_agent filters.
 */
function coreListHandoffs(
	owner: string,
	repo: string,
	status: string | undefined,
	fromAgent: string | undefined,
	toAgent: string | undefined,
	limit: number,
	offset: number,
	json: boolean,
	storage: SQLiteStore
): McpResponse {
	const handoffs = storage.handoffs.listHandoffs({
		owner,
		repo,
		status: status as import("../types").Handoff["status"] | undefined,
		from_agent: fromAgent,
		to_agent: toAgent,
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

	const contentSummary = buildHandoffListSummary(repo, rows.length, status, fromAgent, toAgent, handoffs);

	return createMcpResponse(structuredData, contentSummary, {
		contentSummary,
		includeJson: json
	});
}

/**
 * Validates that owner and repo are non-empty, throwing a descriptive error
 * for list/claim modes that require them.
 */
function requireOwnerRepo(owner: string, repo: string): void {
	if (!owner && !repo) {
		throw new Error(
			"owner and repo are required for listing — provide them explicitly or configure MCP workspace roots"
		);
	}
	if (!owner) {
		throw new Error("owner is required for listing — provide it explicitly or configure MCP workspace roots");
	}
	if (!repo) {
		throw new Error("repo is required for listing — provide it explicitly or configure MCP workspace roots");
	}
}

// ---------------------------------------------------------------------------
// Public entry point — auto-infer operation from field presence
// ---------------------------------------------------------------------------

/**
 * Unified handoff read handler. Replaces handoff-list and claim-list.
 *
 * **Auto-infer logic:**
 * - `id` present → **DETAIL** single handoff (no owner/repo needed)
 * - `claim: true` or `agent` present → **LIST CLAIMS** (was claim-list)
 * - `query` present → **SEARCH** handoffs with filters (was handoff-list)
 * - none → **LIST HANDOFFS** (was handoff-list, no filters)
 */
export async function handleHandoffRead(args: unknown, storage: SQLiteStore): Promise<McpResponse> {
	const validated = HandoffReadSchema.parse(args);
	const { id, claim, query, status, from_agent, to_agent, agent, active_only, limit, offset, owner, repo, json } =
		validated;

	// ── 1. id present → DETAIL ─────────────────────────────────────
	if (id) {
		return coreDetail(id, json, storage);
	}

	// ── 2. claim:true or agent present → LIST CLAIMS ──────────────
	if (claim || agent) {
		requireOwnerRepo(owner, repo);
		return coreListClaims(owner, repo, agent ?? undefined, active_only, limit, offset, json, storage);
	}

	// ── 3. query present → SEARCH handoffs ───────────────────────
	if (query !== undefined) {
		requireOwnerRepo(owner, repo);
		return coreListHandoffs(owner, repo, status, from_agent, to_agent, limit, offset, json, storage);
	}

	// ── 4. Fallback → LIST HANDOFFS (no filters) ─────────────────
	requireOwnerRepo(owner, repo);
	return coreListHandoffs(owner, repo, status, from_agent, to_agent, limit, offset, json, storage);
}
