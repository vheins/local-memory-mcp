import { randomUUID } from "crypto";
import { SQLiteStore } from "../../storage/sqlite";
import { VectorStore, MemoryEntry, MEMORY_STATUS_ACTIVE } from "../../types";
import type { McpResponse } from "../../utils/mcp-response";
import { createMcpErrorResponse } from "../../utils/mcp-error";
import { resolveEntityCode } from "../../utils/code-generator";
import { resolveMemorySupersedes } from "../../utils/memory-utils";
import { MEMORY_CONFLICT_THRESHOLD, TTL_MS_PER_DAY } from "../../utils/constants";
import type { MemoryWriteItemInput } from "../schemas/index";

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

/**
 * Builds a `MemoryEntry` from a schema-validated write item (OPT-CODE-03).
 *
 * The param is typed as {@link MemoryWriteItemInput} (z.infer of
 * `MemoryWriteItemSchema`) instead of `Record<string, unknown>`, so field
 * reads are statically typed — no `as` casts per field.
 *
 * Four fields keep a narrow compile-time cast because the schema marks them
 * optional (the schema is shared with the update/acknowledge modes) while the
 * entity type and the memories table expect non-null:
 * - `type`     → `type TEXT NOT NULL`.
 * - `content`  → `content TEXT NOT NULL`.
 * - `importance` → `importance INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 5)`.
 *   All three: an absent value flows through the entry unchanged and the
 *   insert fails with SQLITE_CONSTRAINT — the exact pre-refactor outcome for a
 *   create missing a required column.
 * - `title`    → `title TEXT` (nullable): an absent value flows through and is
 *   stored as NULL (insert binds `entry.title || null`).
 *
 * The casts are type-level only; the runtime values pass through verbatim, so
 * behavior is byte-identical to the pre-refactor `Record<string, unknown>` code.
 */
export function buildMemoryEntry(
	params: MemoryWriteItemInput,
	db: SQLiteStore,
	vectors: VectorStore,
	now: string,
	batchCodes?: Set<string>
): MemoryEntry {
	const scope = params.scope;
	const owner = params.owner ?? scope?.owner ?? "unknown";
	const repo = params.repo ?? scope?.repo ?? "unknown";
	const fullScope = {
		owner,
		repo,
		branch: scope?.branch,
		folder: scope?.folder,
		language: scope?.language
	};

	const createdAtTime = new Date(now).getTime();
	const expires_at =
		params.ttlDays != null ? new Date(createdAtTime + params.ttlDays * TTL_MS_PER_DAY).toISOString() : null;

	const resolvedSupersedes = resolveMemorySupersedes(params.supersedes, db, owner, repo);

	const tags = [...(params.tags ?? [])];
	if (fullScope.language && !tags.includes(fullScope.language.toLowerCase())) {
		tags.push(fullScope.language.toLowerCase());
	}

	const code = resolveEntityCode(params.code || null, owner, repo, "memory", db, { batchCodes });

	return {
		id: randomUUID(),
		code,
		// Narrow field casts — see the JSDoc above for the schema-vs-table contract.
		type: params.type as MemoryEntry["type"],
		title: params.title as string,
		content: params.content as string,
		importance: params.importance as number,
		agent: params.agent ?? "unknown",
		role: params.role ?? "unknown",
		model: params.model ?? "unknown",
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
		metadata: params.metadata ?? {},
		is_global: params.is_global ?? false
	};
}

// ── Conflict check for create items ──────────────────────────────────────

export async function checkCreateConflict(
	params: MemoryWriteItemInput,
	db: SQLiteStore,
	vectors: VectorStore,
	isTaskArchive: boolean,
	resolvedSupersedes: string | null
): Promise<{ conflict: boolean; response?: McpResponse }> {
	if (resolvedSupersedes || isTaskArchive) {
		return { conflict: false };
	}

	const owner = params.owner ?? params.scope?.owner ?? "unknown";
	const repo = params.repo ?? params.scope?.repo ?? "unknown";

	// `content` is schema-optional but checkConflicts requires a string. The cast
	// is type-level only — it passes `params.content` (possibly undefined) through
	// unchanged, exactly as the pre-refactor code did. An empty/absent content
	// yields no similarity match (no false conflict), and a create without content
	// still fails later at the `content TEXT NOT NULL` insert.
	const conflict = await db.memoryVectors.checkConflicts(
		params.content as string,
		owner,
		repo,
		params.type ?? "unknown",
		vectors,
		MEMORY_CONFLICT_THRESHOLD
	);

	if (conflict) {
		return {
			conflict: true,
			response: createMcpErrorResponse({
				code: "MEMORY_CONFLICT",
				message: `Rejected due to conflict: "${conflict.title}" (${conflict.id.slice(0, 8)}...). Hint: Use 'id' for update, 'id'+'acknowledge' for acknowledge, or 'supersedes' if replacing.`,
				retryable: false,
				details: {
					conflicting_memory: { id: conflict.id, title: conflict.title, content: conflict.content },
					instruction:
						"Provide 'id' for update, 'id'+'acknowledge' for acknowledge, or 'supersedes' if this new memory replaces it."
				}
			})
		};
	}

	return { conflict: false };
}
