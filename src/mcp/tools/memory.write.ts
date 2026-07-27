import { randomUUID } from "crypto";
import { MemoryWriteSchema, MemoryWriteItemSchema, MemoryTypeSchema } from "./schemas";
import { SQLiteStore } from "../storage/sqlite";
import { VectorStore, MemoryEntry } from "../types";
import { logger } from "../utils/logger";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";
import { resolveEntityCode } from "../utils/code-generator";
import { UUID_REGEX } from "../utils/uuid";
import { saveExtractions } from "./kg-archivist";
import { hasMetadataLikeTitle, resolveMemorySupersedes } from "../utils/memory-utils";

// ── Convenience helpers ──────────────────────────────────────────────────

/**
 * If a `decision_log` block is provided (alongside type="decision"),
 * auto-generates the `content`, sets `importance=4`, and strips the
 * convenience field so the memory entry is clean.
 */
function applyDecisionLog(params: Record<string, unknown>): void {
	const dl = params.decision_log as Record<string, unknown> | undefined;
	if (!dl) return;

	// Validate type must be "decision"
	if (params.type !== "decision") {
		throw new Error(`decision_log requires type="decision", got ${params.type ? `"${params.type}"` : "undefined"}.`);
	}

	const { context, rationale, alternatives, tags: dlTags } = dl;
	const lines: string[] = [];

	const title = (params.title as string) ?? "Untitled";
	lines.push(`Decision: ${title}`);

	if (context) {
		lines.push(`\n## Context\n\n${context}`);
	}
	if (rationale) {
		lines.push(`\n## Rationale\n\n${rationale}`);
	}
	if (Array.isArray(alternatives) && alternatives.length > 0) {
		lines.push(`\n## Alternatives Considered\n\n${(alternatives as string[]).map((a) => `- ${a}`).join("\n")}`);
		lines.push(`\nAlternatives considered: ${(alternatives as string[]).join(", ")}`);
	}

	params.content = lines.join("\n\n");
	params.importance = 4;

	// Merge decision tags into top-level tags if provided
	if (Array.isArray(dlTags) && (dlTags as string[]).length > 0) {
		const existingTags = (params.tags as string[]) ?? [];
		const merged = new Set([...existingTags, ...(dlTags as string[])]);
		params.tags = [...merged];
	}

	// Also inject the "decision" tag if not already present
	const tags = (params.tags as string[]) ?? [];
	if (!tags.includes("decision")) {
		tags.push("decision");
		params.tags = tags;
	}

	delete params.decision_log;
}

/**
 * If a `session_summary` block is provided (alongside type="task_archive"),
 * auto-generates the `title` and `content`, sets `importance=3`, and strips
 * the convenience field so the memory entry is clean.
 */
function applySessionSummary(params: Record<string, unknown>): void {
	const ss = params.session_summary as Record<string, unknown> | undefined;
	if (!ss) return;

	// Validate type must be "task_archive"
	if (params.type !== "task_archive") {
		throw new Error(
			`session_summary requires type="task_archive", got ${params.type ? `"${params.type}"` : "undefined"}.`
		);
	}

	const { summary, key_decisions, next_steps, tags: ssTags } = ss;

	params.title = ((summary as string) ?? "Summary").slice(0, 80);

	const lines: string[] = [`Session Summary:`, ``, `${summary}`];
	if (Array.isArray(key_decisions) && (key_decisions as string[]).length > 0) {
		lines.push(`\n## Key Decisions\n\n${(key_decisions as string[]).map((d) => `- ${d}`).join("\n")}`);
	}
	if (Array.isArray(next_steps) && (next_steps as string[]).length > 0) {
		lines.push(`\n## Next Steps\n\n${(next_steps as string[]).map((n) => `- ${n}`).join("\n")}`);
	}

	params.content = lines.join("\n\n");
	params.importance = 3;

	// Merge session summary tags into top-level tags if provided
	if (Array.isArray(ssTags) && (ssTags as string[]).length > 0) {
		const existingTags = (params.tags as string[]) ?? [];
		const merged = new Set([...existingTags, ...(ssTags as string[])]);
		params.tags = [...merged];
	}

	// Always tag with "session-summary"
	const tags = (params.tags as string[]) ?? [];
	if (!tags.includes("session-summary")) {
		tags.push("session-summary");
		params.tags = tags;
	}

	delete params.session_summary;
}

// ── Mode inference ───────────────────────────────────────────────────────

type WriteMode = "create" | "update" | "acknowledge" | "bulk";

function inferWriteMode(params: Record<string, unknown>): WriteMode {
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

// ── Core: build memory entry for creation ────────────────────────────────

function buildMemoryEntry(
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
		params.ttlDays != null ? new Date(createdAtTime + (params.ttlDays as number) * 86400000).toISOString() : null;

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
		status: "active",
		tags,
		metadata: (params.metadata as Record<string, unknown>) ?? {},
		is_global: (params.is_global as boolean) ?? false
	};
}

// ── Conflict check for create items ──────────────────────────────────────

async function checkCreateConflict(
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
		0.85
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

// ── Single CREATE ────────────────────────────────────────────────────────

async function handleCreate(
	params: Record<string, unknown>,
	db: SQLiteStore,
	vectors: VectorStore,
	json: boolean
): Promise<McpResponse> {
	// Apply convenience helpers before validation
	applyDecisionLog(params);
	applySessionSummary(params);

	const parsed = MemoryWriteSchema.parse(params) as Record<string, unknown>;

	// Title metadata check
	const title = (parsed.title ?? "") as string;
	if (hasMetadataLikeTitle(title)) {
		throw new Error(
			"Title appears to contain metadata. Keep title concise and move agent/role/date details into metadata or dedicated fields."
		);
	}

	const type = parsed.type as string;
	const isTaskArchive = type === "task_archive";
	const scope = (parsed.scope as Record<string, unknown>) ?? {};
	const owner = (parsed.owner as string) ?? (scope.owner as string) ?? "unknown";
	const repo = (parsed.repo as string) ?? (scope.repo as string) ?? "unknown";

	// Check for resolved supersedes to decide
	const resolvedSupersedes = resolveMemorySupersedes(parsed.supersedes as string | null | undefined, db, owner, repo);

	// Conflict check
	const { conflict, response: conflictResponse } = await checkCreateConflict(
		parsed as unknown as Record<string, unknown>,
		db,
		vectors,
		isTaskArchive,
		resolvedSupersedes,
		json
	);
	if (conflict) {
		return conflictResponse!;
	}

	// Archive the superseded memory
	if (resolvedSupersedes) {
		const oldMemory = db.memories.getById(resolvedSupersedes);
		if (oldMemory) {
			db.memories.update(oldMemory.id, { status: "archived" });
		}
	}

	const now = new Date().toISOString();
	const entry = buildMemoryEntry(parsed as unknown as Record<string, unknown>, db, vectors, now);

	db.memories.insert(entry);

	// Vector upsert (non-critical)
	try {
		await vectors.upsert(entry.id, entry.content);
	} catch (error) {
		logger.warn("Failed to generate vector embedding", { error: String(error) });
	}

	// NLP entity extraction (non-critical)
	try {
		await saveExtractions(entry.content, entry.title, entry.scope.owner, entry.scope.repo, db);
	} catch (error) {
		logger.warn("[KG-Archivist] NLP extraction failed, memory stored without KG enrichment", {
			error: String(error)
		});
	}

	return createMcpResponse(
		{
			success: true,
			id: entry.id,
			code: entry.code,
			repo: entry.scope.repo,
			type: entry.type,
			title: entry.title,
			importance: entry.importance
		},
		`Stored [${entry.code}] "${entry.title}" in repo "${entry.scope.repo}".`,
		{
			contentSummary: `Stored [${entry.code}] "${entry.title}" in repo "${entry.scope.repo}".`,
			structuredContentPathHint: "code",
			includeJson: json
		}
	);
}

// ── Single UPDATE ────────────────────────────────────────────────────────

async function handleUpdate(
	params: Record<string, unknown>,
	db: SQLiteStore,
	vectors: VectorStore,
	json: boolean
): Promise<McpResponse> {
	const idOrCode = (params.id ?? params.code) as string | undefined;
	if (!idOrCode) {
		throw new Error("Either id or code must be provided for update");
	}

	// Resolve code/id
	let resolvedId = idOrCode as string;
	if (!UUID_REGEX.test(resolvedId)) {
		const scope = (params.scope as Record<string, unknown>) ?? {};
		const owner = (params.owner as string) ?? (scope.owner as string);
		const repo = (params.repo as string) ?? (scope.repo as string);
		const byCode = db.memories.getByCode(resolvedId, owner, repo);
		if (!byCode) throw new Error(`Memory not found: ${resolvedId}`);
		resolvedId = byCode.id;
	}

	// Check memory exists
	const existing = db.memories.getById(resolvedId);
	if (!existing) {
		throw new Error(`Memory not found: ${resolvedId}`);
	}

	// Repo mismatch check
	const repoFilter = (params.repo as string) ?? ((params.scope as Record<string, unknown>)?.repo as string);
	if (repoFilter && repoFilter !== existing.scope.repo) {
		throw new Error(
			`Repository mismatch: provided repo "${repoFilter}" does not match memory repo "${existing.scope.repo}"`
		);
	}

	// Title metadata check
	const title = params.title as string | undefined;
	if (title !== undefined && hasMetadataLikeTitle(title)) {
		throw new Error(
			"Title appears to contain metadata. Keep title concise and move agent/role/date details into metadata or dedicated fields."
		);
	}

	// Build updates
	const updates: Record<string, unknown> = {};
	const updatableFields = [
		"type",
		"title",
		"content",
		"importance",
		"agent",
		"role",
		"status",
		"supersedes",
		"tags",
		"metadata",
		"is_global",
		"completed_at"
	] as const;

	for (const field of updatableFields) {
		if (params[field] !== undefined) {
			if (field === "type") {
				updates[field] = MemoryTypeSchema.parse(params[field]);
			} else if (field === "supersedes") {
				updates[field] = resolveMemorySupersedes(
					params[field] as string | null | undefined,
					db,
					existing.scope.owner,
					existing.scope.repo
				);
			} else {
				updates[field] = params[field] as string | number | boolean | Record<string, unknown> | string[] | undefined;
			}
		}
	}

	db.memories.update(resolvedId, updates);

	// Update vector if content changed
	if (params.content !== undefined) {
		await vectors.upsert(resolvedId, params.content as string);
	}

	// Log action
	db.actions.logAction("update", existing.scope.owner, existing.scope.repo, { memoryId: resolvedId, resultCount: 1 });
	logger.info("[Tool] memory.write — update", {
		repo: existing.scope.repo,
		id: resolvedId,
		fields: Object.keys(updates)
	});

	return createMcpResponse(
		{
			success: true,
			id: resolvedId,
			code: existing.code,
			repo: existing.scope.repo,
			updatedFields: Object.keys(updates)
		},
		`Updated [${existing.code}] "${existing.title}" in repo "${existing.scope.repo}": fields ${Object.keys(updates).join(", ") || "none"}.`,
		{
			structuredContentPathHint: "updatedFields",
			includeJson: json
		}
	);
}

// ── Single ACKNOWLEDGE ───────────────────────────────────────────────────

async function handleAcknowledge(
	params: Record<string, unknown>,
	db: SQLiteStore,
	json: boolean
): Promise<McpResponse> {
	const idOrCode = (params.id ?? params.code) as string | undefined;
	if (!idOrCode) {
		throw new Error("Either id or code must be provided for acknowledge");
	}

	// Resolve code/id
	let memoryId = idOrCode as string;
	if (!UUID_REGEX.test(memoryId)) {
		const scope = (params.scope as Record<string, unknown>) ?? {};
		const owner = (params.owner as string) ?? (scope.owner as string);
		const repo = (params.repo as string) ?? (scope.repo as string);
		const byCode = db.memories.getByCode(memoryId, owner, repo);
		if (!byCode) throw new Error(`Memory not found: ${memoryId}`);
		memoryId = byCode.id;
	}

	// Check memory exists
	const memory = db.memories.getById(memoryId);
	if (!memory) {
		throw new Error(`Memory with ID ${memoryId} not found.`);
	}

	const status = params.acknowledge as string;
	const applicationContext = params.application_context as string | undefined;

	// Validate acknowledge status value
	const VALID_ACK_STATUSES = ["used", "irrelevant", "contradictory"] as const;
	if (!VALID_ACK_STATUSES.includes(status as (typeof VALID_ACK_STATUSES)[number])) {
		throw new Error(`Invalid acknowledge status "${status}". Must be one of: ${VALID_ACK_STATUSES.join(", ")}`);
	}

	// Update stats based on status
	if (status === "used") {
		db.memories.incrementRecallCount(memory.id);
		logger.info("[Tool] memory.write — acknowledge used", { id: memory.id, context: applicationContext });
	} else if (status === "contradictory") {
		logger.warn("[Tool] memory.write — acknowledge contradiction reported", {
			id: memory.id,
			context: applicationContext
		});
	} else {
		logger.info("[Tool] memory.write — acknowledge irrelevant", { id: memory.id, context: applicationContext });
	}

	return createMcpResponse(
		{
			success: true,
			id: memory.id,
			code: memory.code,
			status
		},
		`Acknowledged [${memory.code}] as "${status}" in repo "${memory.scope.repo}".`,
		{
			structuredContentPathHint: "status",
			includeJson: json
		}
	);
}

// ── BULK ─────────────────────────────────────────────────────────────────

async function handleBulk(
	items: Record<string, unknown>[],
	db: SQLiteStore,
	vectors: VectorStore,
	json: boolean,
	parentParams?: Record<string, unknown>
): Promise<McpResponse> {
	const results: Record<string, unknown>[] = [];
	const errors: { index: number; error: string }[] = [];
	const createdEntries: MemoryEntry[] = [];
	const now = new Date().toISOString();
	const batchCodes = new Set<string>();

	// Session defaults carried from top-level — inherit from parent if not set per-item
	const parentOwner = (parentParams?.owner as string) ?? "";
	const parentRepo = (parentParams?.repo as string) ?? "";
	const defaultOwner = parentOwner;
	const defaultRepo = parentRepo;

	for (let i = 0; i < items.length; i++) {
		try {
			const raw = { ...items[i] };

			// Infer per-item operation
			const itemMode = inferWriteMode(raw);

			switch (itemMode) {
				case "acknowledge": {
					// Acknowledge inline within bulk — run against the DB directly
					const idOrCode = (raw.id ?? raw.code) as string | undefined;
					if (!idOrCode) throw new Error("Either id or code must be provided for acknowledge");

					let memId = idOrCode;
					if (!UUID_REGEX.test(memId)) {
						const scope = (raw.scope as Record<string, unknown>) ?? {};
						const owner = (raw.owner as string) ?? (scope.owner as string);
						const repo = (raw.repo as string) ?? (scope.repo as string);
						const byCode = db.memories.getByCode(memId, owner, repo);
						if (!byCode) throw new Error(`Memory not found: ${memId}`);
						memId = byCode.id;
					}

					const mem = db.memories.getById(memId);
					if (!mem) throw new Error(`Memory with ID ${memId} not found.`);

					const ackStatus = raw.acknowledge as string;
					if (ackStatus === "used") {
						db.memories.incrementRecallCount(mem.id);
					}

					results.push({
						operation: "acknowledge",
						success: true,
						id: mem.id,
						code: mem.code,
						status: ackStatus
					});
					break;
				}

				case "update": {
					// Update inline within bulk
					const idOrCode = (raw.id ?? raw.code) as string | undefined;
					if (!idOrCode) throw new Error("Either id or code must be provided for update");

					let memId = idOrCode;
					if (!UUID_REGEX.test(memId)) {
						const scope = (raw.scope as Record<string, unknown>) ?? {};
						const owner = (raw.owner as string) ?? (scope.owner as string);
						const repo = (raw.repo as string) ?? (scope.repo as string);
						const byCode = db.memories.getByCode(memId, owner, repo);
						if (!byCode) throw new Error(`Memory not found: ${memId}`);
						memId = byCode.id;
					}

					const existing = db.memories.getById(memId);
					if (!existing) throw new Error(`Memory with ID ${memId} not found.`);

					const updates: Record<string, unknown> = {};
					const updatableFields = [
						"type",
						"title",
						"content",
						"importance",
						"agent",
						"role",
						"status",
						"supersedes",
						"tags",
						"metadata",
						"is_global",
						"completed_at"
					] as const;

					for (const field of updatableFields) {
						if (raw[field] !== undefined) {
							if (field === "type") {
								updates[field] = MemoryTypeSchema.parse(raw[field]);
							} else {
								updates[field] = raw[field] as
									string | number | boolean | Record<string, unknown> | string[] | undefined;
							}
						}
					}

					db.memories.update(memId, updates);

					if (raw.content !== undefined) {
						await vectors.upsert(memId, raw.content as string);
					}

					results.push({
						operation: "update",
						success: true,
						id: memId,
						code: existing.code,
						updatedFields: Object.keys(updates)
					});
					break;
				}

				case "create":
				default: {
					// Apply convenience helpers
					applyDecisionLog(raw);
					applySessionSummary(raw);

					// Title metadata check
					const rawTitle = raw.title as string | undefined;
					if (rawTitle && hasMetadataLikeTitle(rawTitle)) {
						throw new Error(
							"Title appears to contain metadata. Keep title concise and move agent/role/date details into metadata or dedicated fields."
						);
					}

					const isTaskArchive = raw.type === "task_archive";

					// Fill scope defaults from item or parent params
					const itemScope = (raw.scope as Record<string, unknown>) ?? {};
					const itemOwner = (raw.owner as string) ?? (itemScope.owner as string) ?? defaultOwner;
					const itemRepo = (raw.repo as string) ?? (itemScope.repo as string) ?? defaultRepo;

					// Propagate owner/repo to the item so buildMemoryEntry picks them up
					if (!raw.owner && defaultOwner) raw.owner = defaultOwner;
					if (!raw.repo && defaultRepo) raw.repo = defaultRepo;
					if (!raw.scope) {
						raw.scope = { owner: defaultOwner || undefined, repo: defaultRepo || undefined };
					} else {
						const scope = raw.scope as Record<string, unknown>;
						if (!scope.owner) scope.owner = defaultOwner || undefined;
						if (!scope.repo) scope.repo = defaultRepo || undefined;
					}

					// Conflict check
					const resolvedS = resolveMemorySupersedes(
						raw.supersedes as string | null | undefined,
						db,
						itemOwner,
						itemRepo
					);
					const { conflict, response: conflictResponse } = await checkCreateConflict(
						raw,
						db,
						vectors,
						isTaskArchive,
						resolvedS,
						json
					);
					if (conflict) {
						throw new Error((conflictResponse!.content?.[0] as { text?: string })?.text ?? "Conflict detected");
					}

					// Archive superseded
					if (resolvedS) {
						const oldMemory = db.memories.getById(resolvedS);
						if (oldMemory) {
							db.memories.update(oldMemory.id, { status: "archived" });
						}
					}

					const entry = buildMemoryEntry(raw, db, vectors, now, batchCodes);
					createdEntries.push(entry);

					results.push({
						operation: "create",
						success: true,
						id: entry.id,
						code: entry.code,
						title: entry.title,
						type: entry.type
					});
					break;
				}
			}
		} catch (error) {
			errors.push({ index: i, error: (error as Error).message });
			logger.warn("[Tool] memory.write — bulk item failed", { index: i, error: String(error) });
		}
	}

	// Batch insert all created entries in a single transaction
	if (createdEntries.length > 0) {
		db.memories.bulkInsertMemories(createdEntries);

		// Non-critical post-insert operations
		for (const entry of createdEntries) {
			try {
				await vectors.upsert(entry.id, entry.content);
			} catch (error) {
				logger.warn("Failed to generate vector embedding", { error: String(error) });
			}

			try {
				await saveExtractions(entry.content, entry.title, entry.scope.owner, entry.scope.repo, db);
			} catch (error) {
				logger.warn("[KG-Archivist] NLP extraction failed", { error: String(error) });
			}
		}
	}

	const successCount = results.length;
	const errorCount = errors.length;

	const summaryParts: string[] = [];
	if (successCount > 0) {
		summaryParts.push(`${successCount} succeeded`);
	}
	if (errorCount > 0) {
		summaryParts.push(`${errorCount} failed`);
	}

	return createMcpResponse(
		{
			success: errorCount === 0,
			total: items.length,
			processed: successCount,
			results,
			...(errorCount > 0 ? { errors } : {})
		},
		`Processed ${successCount}/${items.length}${errorCount > 0 ? ` (${errorCount} failed)` : ""}.`,
		{
			structuredContentPathHint: "results",
			includeJson: json
		}
	);
}

// ── Main handler ─────────────────────────────────────────────────────────

/**
 * Unified memory write handler.
 *
 * **Auto-infer logic:**
 * - `memories[]` present → BULK mode (mixed create/update/acknowledge)
 * - `acknowledge` + (`id` or `code`) → ACKNOWLEDGE
 * - `id` or `code` present → UPDATE
 * - `content` present → CREATE (single)
 *
 * **Convenience features:**
 * - `decision_log` with `type:"decision"` auto-formats content, sets importance=4
 * - `session_summary` with `type:"task_archive"` auto-formats title/content, sets importance=3
 */
export async function handleMemoryWrite(
	params: Record<string, unknown>,
	db: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	const mode = inferWriteMode(params);

	logger.info("[Tool] memory.write — inferred mode", { mode, hasMemories: Array.isArray(params.memories) });

	const json = (params.json as boolean) ?? false;

	switch (mode) {
		case "bulk":
			return handleBulk(params.memories as Record<string, unknown>[], db, vectors, json, params);
		case "acknowledge":
			return handleAcknowledge(params, db, json);
		case "update":
			return handleUpdate(params, db, vectors, json);
		case "create":
		default:
			return handleCreate(params, db, vectors, json);
	}
}
