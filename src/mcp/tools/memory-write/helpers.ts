import { randomUUID } from "crypto";
import { SQLiteStore } from "../../storage/sqlite";
import { VectorStore, MemoryEntry, MEMORY_STATUS_ACTIVE } from "../../types";
import { createMcpResponse, McpResponse } from "../../utils/mcp-response";
import { resolveEntityCode } from "../../utils/code-generator";
import { resolveMemorySupersedes } from "../../utils/memory-utils";
import { MEMORY_CONFLICT_THRESHOLD, TTL_MS_PER_DAY } from "../../utils/constants";

// ── Mode inference ───────────────────────────────────────────────────────

export type WriteMode = "create" | "update" | "acknowledge" | "bulk";

export function inferWriteMode(params: Record<string, unknown>): WriteMode {
	if (params.memories !== undefined && Array.isArray(params.memories)) {
		return "bulk";
	}
	if (params.acknowledge !== undefined && (params.id !== undefined || params.code !== undefined)) {
		return "acknowledge";
	}
	if (params.id !== undefined || params.code !== undefined) {
		return "update";
	}
	return "create";
}

// ── Decision fields convenience ──────────────────────────────────────────

/**
 * If flat decision fields (`context`, `rationale`, `alternatives`) are
 * provided alongside type="decision", auto-generates the `content`,
 * sets `importance=4`, and strips the convenience fields so the memory
 * entry is clean.
 */
export function applyDecisionFields(params: Record<string, unknown>): void {
	const context = params.context as string | undefined;
	const rationale = params.rationale as string | undefined;
	const alternatives = params.alternatives as string[] | undefined;

	if (!context && !rationale && !alternatives) return;

	// Validate type must be "decision"
	if (params.type !== "decision") {
		throw new Error(
			`context/rationale/alternatives require type="decision", got ${params.type ? `"${params.type}"` : "undefined"}.`
		);
	}

	const lines: string[] = [];

	if (context) {
		lines.push(`## Context\n\n${context}`);
	}
	if (rationale) {
		lines.push(`## Rationale\n\n${rationale}`);
	}
	if (Array.isArray(alternatives) && alternatives.length > 0) {
		lines.push(`## Alternatives\n\n${(alternatives as string[]).map((a) => `- ${a}`).join("\n")}`);
	}

	params.content = lines.join("\n\n");
	params.importance = 4;

	// Inject the "decision" tag if not already present
	const tags = (params.tags as string[]) ?? [];
	if (!tags.includes("decision")) {
		tags.push("decision");
		params.tags = tags;
	}

	// Strip the flat fields so the memory entry is clean
	delete params.context;
	delete params.rationale;
	delete params.alternatives;
}

// ── Session fields convenience ───────────────────────────────────────────

/**
 * If flat session fields (`key_decisions`, `next_steps`) are provided
 * alongside type="task_archive", auto-generates the `content`, sets
 * `importance=3`, and strips the convenience fields so the memory entry
 * is clean.
 */
export function applySessionFields(params: Record<string, unknown>): void {
	const keyDecisions = params.key_decisions as string[] | undefined;
	const nextSteps = params.next_steps as string[] | undefined;

	if (!keyDecisions && !nextSteps) return;

	// Validate type must be "task_archive"
	if (params.type !== "task_archive") {
		throw new Error(
			`key_decisions/next_steps require type="task_archive", got ${params.type ? `"${params.type}"` : "undefined"}.`
		);
	}

	const lines: string[] = [];

	if (Array.isArray(keyDecisions) && keyDecisions.length > 0) {
		lines.push(`## Key Decisions\n\n${keyDecisions.map((d) => `- ${d}`).join("\n")}`);
	}
	if (Array.isArray(nextSteps) && nextSteps.length > 0) {
		lines.push(`## Next Steps\n\n${nextSteps.map((n) => `- ${n}`).join("\n")}`);
	}

	params.content = lines.join("\n\n");
	params.importance = 3;

	// Always tag with "session-summary"
	const tags = (params.tags as string[]) ?? [];
	if (!tags.includes("session-summary")) {
		tags.push("session-summary");
		params.tags = tags;
	}

	// Strip the flat fields so the memory entry is clean
	delete params.key_decisions;
	delete params.next_steps;
}

// ── Memory entry builder ─────────────────────────────────────────────────

export function buildMemoryEntry(
	params: Record<string, unknown>,
	db: SQLiteStore,
	vectors: VectorStore,
	now: string,
	batchCodes?: Set<string>
): MemoryEntry {
	const scope = (params.scope as Record<string, unknown>) ?? {};
	const owner = (params.owner as string) ?? (scope.owner as string) ?? "unknown";
	const repo = (params.repo as string) ?? (scope.repo as string) ?? "unknown";
	const fullScope = {
		owner,
		repo,
		branch: (scope.branch as string) ?? undefined,
		folder: (scope.folder as string) ?? undefined,
		language: (scope.language as string) ?? undefined
	};

	const createdAtTime = new Date(now).getTime();
	const expires_at =
		params.ttlDays != null ? new Date(createdAtTime + (params.ttlDays as number) * TTL_MS_PER_DAY).toISOString() : null;

	const resolvedSupersedes = resolveMemorySupersedes(params.supersedes as string | null | undefined, db, owner, repo);

	const tags = [...((params.tags as string[]) ?? [])];
	if (fullScope.language && !tags.includes(fullScope.language.toLowerCase())) {
		tags.push(fullScope.language.toLowerCase());
	}

	const code = resolveEntityCode((params.code as string) || null, owner, repo, "memory", db, { batchCodes });

	return {
		id: randomUUID(),
		code,
		type: params.type as MemoryEntry["type"],
		title: params.title as string,
		content: params.content as string,
		importance: params.importance as number,
		agent: (params.agent as string) ?? "unknown",
		role: (params.role as string) ?? "unknown",
		model: (params.model as string) ?? "unknown",
		scope: fullScope,
		created_at: now,
		updated_at: now,
		completed_at: null,
		hit_count: 0,
		recall_count: 0,
		last_used_at: null,
		expires_at,
		supersedes: resolvedSupersedes,
		status: MEMORY_STATUS_ACTIVE,
		tags,
		metadata: (params.metadata as Record<string, unknown>) ?? {},
		is_global: (params.is_global as boolean) ?? false
	};
}

// ── Conflict check for create items ──────────────────────────────────────

export async function checkCreateConflict(
	params: Record<string, unknown>,
	db: SQLiteStore,
	vectors: VectorStore,
	isTaskArchive: boolean,
	resolvedSupersedes: string | null,
	json?: boolean
): Promise<{ conflict: boolean; response?: McpResponse }> {
	if (resolvedSupersedes || isTaskArchive) {
		return { conflict: false };
	}

	const scope = (params.scope as Record<string, unknown>) ?? {};
	const owner = (params.owner as string) ?? (scope.owner as string) ?? "unknown";
	const repo = (params.repo as string) ?? (scope.repo as string) ?? "unknown";

	const conflict = await db.memoryVectors.checkConflicts(
		params.content as string,
		owner,
		repo,
		params.type as string,
		vectors,
		MEMORY_CONFLICT_THRESHOLD
	);

	if (conflict) {
		return {
			conflict: true,
			response: createMcpResponse(
				{
					success: false,
					error: "MEMORY_CONFLICT",
					message: `This memory content overlaps significantly with an existing memory (ID: ${conflict.id}).`,
					conflicting_memory: { id: conflict.id, title: conflict.title, content: conflict.content },
					instruction:
						"Provide 'id' for update, 'id'+'acknowledge' for acknowledge, or 'supersedes' if this new memory replaces it."
				},
				`Rejected due to conflict: "${conflict.title}" (${conflict.id.slice(0, 8)}...). Hint: Use 'id' for update, 'id'+'acknowledge' for acknowledge, or 'supersedes' if replacing.`,
				{ includeJson: json }
			)
		};
	}

	return { conflict: false };
}
