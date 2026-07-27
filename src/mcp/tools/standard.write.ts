import { randomUUID } from "crypto";
import { StandardWriteSchema } from "./schemas";
import { SQLiteStore } from "../storage/sqlite";
import { CodingStandardEntry, VectorStore } from "../types";
import { logger } from "../utils/logger";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";
import { buildStandardVectorText, toContextSlug } from "./standard.shared";
import { UUID_REGEX } from "../utils/uuid";
import { generateNextCode } from "../utils/code-generator";
import { saveExtractions } from "./kg-archivist";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WriteParams = {
	// Common
	owner?: string;
	repo?: string;
	json: boolean;

	// Create fields
	name?: string;
	content?: string;
	parent_id?: string;
	context?: string;
	version?: string;
	language?: string;
	stack?: string[];
	is_global?: boolean;
	tags?: string[];
	metadata?: Record<string, unknown>;
	agent?: string;
	model?: string;

	// Update fields
	id?: string;
	code?: string;

	// Bulk
	standards?: Record<string, unknown>[];
};

type BulkResult = {
	index: number;
	operation: "create" | "update";
	success: boolean;
	id?: string;
	code?: string;
	title?: string;
	error?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveStandardParentId(
	value: string | null | undefined,
	db: SQLiteStore,
	owner?: string,
	repo?: string
): string | null {
	if (!value) return null;
	if (UUID_REGEX.test(value)) return value;
	const standard = db.standards.getByCode(value, owner, repo);
	if (!standard) throw new Error(`parent_id: standard with code '${value}' not found`);
	return standard.id;
}

// ---------------------------------------------------------------------------
// Internal core logic — returns plain data, does NOT wrap in McpResponse
// ---------------------------------------------------------------------------

async function coreCreate(
	params: WriteParams,
	db: SQLiteStore,
	vectors: VectorStore
): Promise<{ id: string; code: string; title: string; repo: string }> {
	if (!params.name || !params.content || !params.tags || !params.metadata) {
		throw new Error("CREATE requires: name, content, tags, metadata");
	}

	const incomingVersion = params.version || "1.0.0";
	const incomingLanguage = params.language ?? null;
	const incomingStack = params.stack ?? [];

	const conflict = db.standards.checkConflicts(
		params.content,
		incomingVersion,
		params.owner!,
		params.repo,
		incomingLanguage,
		incomingStack,
		0.82
	);

	if (conflict) {
		const err = new Error("STANDARD_CONFLICT") as Error & {
			structured: {
				success: false;
				error: string;
				message: string;
				conflicting_standard: Record<string, unknown>;
				instruction: string;
			};
		};
		err.structured = {
			success: false,
			error: "STANDARD_CONFLICT",
			message: `This standard's content is highly similar to an existing standard (ID: ${conflict.id}, similarity: ${(conflict.similarity * 100).toFixed(1)}%).`,
			conflicting_standard: {
				id: conflict.id,
				title: conflict.title,
				version: conflict.version,
				language: conflict.language,
				stack: conflict.stack,
				content: conflict.content
			},
			instruction:
				"Use 'standard-write' with 'id' or 'code' to update the existing standard. To store a distinct variant, supply a different 'version', 'language', or non-overlapping 'stack'."
		};
		err.name = "StandardConflictError";
		throw err;
	}

	const now = new Date().toISOString();
	const standardRepo = params.repo || "__global__";

	const entry: CodingStandardEntry = {
		id: randomUUID(),
		code: generateNextCode(params.owner!, standardRepo, "standard", db),
		title: params.name,
		content: params.content,
		parent_id: resolveStandardParentId(params.parent_id, db, params.owner, params.repo),
		context: toContextSlug(params.context || "general"),
		version: params.version || "1.0.0",
		language: params.language || null,
		stack: params.stack || [],
		is_global: params.is_global === true,
		owner: params.owner!,
		repo: params.repo || null,
		tags: params.tags,
		metadata: params.metadata,
		created_at: now,
		updated_at: now,
		hit_count: 0,
		last_used_at: null,
		agent: params.agent || "unknown",
		model: params.model || "unknown"
	};

	db.standards.insert(entry);

	// Vector embedding
	try {
		await vectors.upsert(entry.id, buildStandardVectorText(entry), "standard");
	} catch (error) {
		logger.warn("Failed to generate standard vector embedding", { error: String(error) });
	}

	// KG auto-population (best-effort, per REFACTOR-KG-001)
	try {
		await saveExtractions(entry.content, entry.title, entry.owner, entry.repo ?? "", db);
	} catch (error) {
		logger.warn("[KG-Archivist] Standard KG extraction failed, saved without KG enrichment", {
			error: String(error)
		});
	}

	return { id: entry.id, code: entry.code!, title: entry.title, repo: entry.repo || "global" };
}

async function coreUpdate(
	params: WriteParams,
	db: SQLiteStore,
	vectors: VectorStore
): Promise<{ id: string; code: string; title: string; repo: string; updatedFields: string[] }> {
	// Resolve code to id if needed
	let resolvedId = params.id;
	if (resolvedId && !UUID_REGEX.test(resolvedId)) {
		const byCode = db.standards.getByCode(resolvedId, params.owner, params.repo);
		if (!byCode) throw new Error(`Coding standard not found: ${resolvedId}`);
		resolvedId = byCode.id;
	}
	if (!resolvedId && params.code) {
		const byCode = db.standards.getByCode(params.code, params.owner, params.repo);
		if (!byCode) throw new Error(`Coding standard not found: ${params.code}`);
		resolvedId = byCode.id;
	} else if (!resolvedId) {
		throw new Error("Either id or code must be provided");
	}

	const existing = db.standards.getById(resolvedId);
	if (!existing) {
		throw new Error(`Coding standard not found: ${resolvedId}`);
	}

	// Conflict detection on content change (also in update mode, per ADR-003)
	if (params.content !== undefined && params.content !== existing.content) {
		const conflict = db.standards.checkConflicts(
			params.content,
			params.version || existing.version,
			params.owner || existing.owner,
			(params.repo || existing.repo) ?? undefined,
			params.language ?? existing.language,
			params.stack ?? existing.stack,
			0.82
		);
		if (conflict && conflict.id !== existing.id) {
			const err = new Error("STANDARD_CONFLICT") as Error & {
				structured: {
					success: false;
					error: string;
					message: string;
					conflicting_standard: Record<string, unknown>;
					instruction: string;
				};
			};
			err.structured = {
				success: false,
				error: "STANDARD_CONFLICT",
				message: `This updated standard content conflicts with an existing standard (ID: ${conflict.id}, similarity: ${(conflict.similarity * 100).toFixed(1)}%).`,
				conflicting_standard: {
					id: conflict.id,
					title: conflict.title,
					version: conflict.version,
					language: conflict.language,
					stack: conflict.stack,
					content: conflict.content
				},
				instruction: "Differentiate by 'version', 'language', or non-overlapping 'stack' to avoid conflict."
			};
			err.name = "StandardConflictError";
			throw err;
		}
	}

	const updates: Partial<CodingStandardEntry> = {};
	if (params.name !== undefined) updates.title = params.name;
	if (params.content !== undefined) updates.content = params.content;
	if (params.parent_id !== undefined)
		updates.parent_id = resolveStandardParentId(params.parent_id, db, existing.owner, existing.repo ?? undefined);
	if (params.context !== undefined) updates.context = params.context;
	if (params.version !== undefined) updates.version = params.version;
	if (params.language !== undefined) updates.language = params.language;
	if (params.stack !== undefined) updates.stack = params.stack;
	if (params.repo !== undefined) updates.repo = params.repo;
	if (params.is_global !== undefined) updates.is_global = params.is_global;
	if (params.tags !== undefined) updates.tags = params.tags;
	if (params.metadata !== undefined) updates.metadata = params.metadata;
	if (params.agent !== undefined) updates.agent = params.agent;
	if (params.model !== undefined) updates.model = params.model;

	db.standards.update(resolvedId, updates);

	const merged: CodingStandardEntry = {
		...existing,
		...updates,
		updated_at: new Date().toISOString()
	};

	// Re-upsert vector on content or semantic field change
	const contentRelatedFields = [
		params.name,
		params.content,
		params.context,
		params.version,
		params.language,
		params.stack,
		params.tags,
		params.metadata
	];
	if (contentRelatedFields.some((f) => f !== undefined)) {
		try {
			await vectors.upsert(resolvedId, buildStandardVectorText(merged), "standard");
		} catch (error) {
			logger.warn("Failed to update standard vector embedding", { error: String(error) });
		}
	}

	// KG auto-population on content or name change (best-effort, per REFACTOR-KG-001)
	if (params.content !== undefined || params.name !== undefined) {
		try {
			await saveExtractions(merged.content, merged.title, merged.owner, merged.repo ?? "", db);
		} catch (error) {
			logger.warn("[KG-Archivist] Standard KG extraction failed on update", {
				error: String(error)
			});
		}
	}

	logger.info("[Tool] standard.write — update", {
		standardId: resolvedId,
		fields: Object.keys(updates)
	});

	return {
		id: resolvedId,
		code: existing.code ?? "",
		title: existing.title,
		repo: existing.repo || "global",
		updatedFields: Object.keys(updates)
	};
}

// ---------------------------------------------------------------------------
// Single operation handlers (return McpResponse)
// ---------------------------------------------------------------------------

async function handleCreateSingle(params: WriteParams, db: SQLiteStore, vectors: VectorStore): Promise<McpResponse> {
	try {
		const data = await coreCreate(params, db, vectors);
		return createMcpResponse(
			{
				success: true,
				standard: data,
				message: `Coding standard [${data.code}] "${data.title}" saved successfully.`
			},
			`Stored [${data.code}] "${data.title}" in repo "${data.repo}".`,
			{
				structuredContentPathHint: "standard",
				includeJson: params.json
			}
		);
	} catch (err: unknown) {
		const conflictErr = err as Error & { structured?: Record<string, unknown> };
		if (conflictErr.structured) {
			return createMcpResponse(conflictErr.structured, `Rejected: conflicts with existing standard.`, {
				includeJson: params.json
			});
		}
		throw err;
	}
}

async function handleUpdateSingle(params: WriteParams, db: SQLiteStore, vectors: VectorStore): Promise<McpResponse> {
	try {
		const data = await coreUpdate(params, db, vectors);
		return createMcpResponse(
			{
				success: true,
				id: data.id,
				code: data.code,
				updatedFields: data.updatedFields
			},
			`Updated [${data.code}] "${data.title}" in repo "${data.repo}": fields ${data.updatedFields.join(", ") || "none"}.`,
			{
				structuredContentPathHint: "updatedFields",
				includeJson: params.json
			}
		);
	} catch (err: unknown) {
		const conflictErr = err as Error & { structured?: Record<string, unknown> };
		if (conflictErr.structured) {
			return createMcpResponse(conflictErr.structured, `Rejected: update conflicts with existing standard.`, {
				includeJson: params.json
			});
		}
		throw err;
	}
}

// ---------------------------------------------------------------------------
// Bulk operation handler
// ---------------------------------------------------------------------------

async function handleBulk(params: WriteParams, db: SQLiteStore, vectors: VectorStore): Promise<McpResponse> {
	const items = params.standards ?? [];
	const results: BulkResult[] = [];
	const batchCodes = new Set<string>();
	const standardRepo = params.repo || "__global__";

	for (let i = 0; i < items.length; i++) {
		const raw = items[i] as Record<string, unknown>;

		const std = {
			...raw,
			owner: (raw.owner as string) ?? params.owner,
			repo: params.repo, // propagate top-level repo to each item (bug fix)
			json: params.json
		} as unknown as WriteParams;

		try {
			const incomingVersion = (std.version as string) || "1.0.0";
			const incomingLanguage = (std.language as string) ?? null;
			const incomingStack = (std.stack as string[]) ?? [];

			const conflict = db.standards.checkConflicts(
				std.content!,
				incomingVersion,
				params.owner!,
				params.repo,
				incomingLanguage,
				incomingStack,
				0.82
			);

			if (conflict) {
				results.push({
					index: i,
					operation: "create",
					success: false,
					error: `Conflicts with standard "${conflict.title}" (v${conflict.version}, similarity: ${(conflict.similarity * 100).toFixed(1)}%)`
				});
				continue;
			}

			const now = new Date().toISOString();
			const code = generateNextCode(params.owner!, standardRepo, "standard", db, batchCodes);
			batchCodes.add(code);

			const entry: CodingStandardEntry = {
				id: randomUUID(),
				code,
				title: std.name!,
				content: std.content!,
				parent_id: resolveStandardParentId(std.parent_id as string | undefined, db, params.owner, params.repo),
				context: toContextSlug((std.context as string) || "general"),
				version: (std.version as string) || "1.0.0",
				language: (std.language as string) || null,
				stack: (std.stack as string[]) || [],
				// Bug fix: was hardcoded `null` — now propagates validated.repo
				is_global: (std.is_global as boolean) === true,
				owner: params.owner!,
				repo: params.repo || null,
				tags: (std.tags as string[]) || [],
				metadata: (std.metadata as Record<string, unknown>) || {},
				created_at: now,
				updated_at: now,
				hit_count: 0,
				last_used_at: null,
				agent: (std.agent as string) || "unknown",
				model: (std.model as string) || "unknown"
			};

			db.standards.insert(entry);

			// Vector upsert
			try {
				await vectors.upsert(entry.id, buildStandardVectorText(entry), "standard");
			} catch (error) {
				logger.warn("Failed to generate standard vector embedding", { error: String(error) });
			}

			// KG auto-population (best-effort)
			try {
				await saveExtractions(entry.content, entry.title, entry.owner, entry.repo ?? "", db);
			} catch (error) {
				logger.warn("[KG-Archivist] Standard KG extraction failed", { error: String(error) });
			}

			results.push({ index: i, operation: "create", success: true, id: entry.id, code, title: std.name });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			results.push({ index: i, operation: "create", success: false, error: msg });
		}
	}

	const succeeded = results.filter((r) => r.success);
	const failed = results.filter((r) => !r.success);
	const allOk = failed.length === 0;

	return createMcpResponse(
		{
			success: allOk,
			total: items.length,
			processed: succeeded.length,
			...(failed.length > 0 ? { errors: failed.map((r) => ({ index: r.index, error: r.error })) } : {}),
			results: results.map((r) => ({
				index: r.index,
				operation: r.operation,
				success: r.success,
				...(r.id ? { id: r.id } : {}),
				...(r.code ? { code: r.code } : {}),
				...(r.title ? { title: r.title } : {}),
				...(r.error ? { error: r.error } : {})
			}))
		},
		`Processed ${succeeded.length}/${items.length} items${failed.length > 0 ? ` (${failed.length} failed)` : ""}.`,
		{ includeJson: params.json }
	);
}

// ---------------------------------------------------------------------------
// Main handler entry point
// ---------------------------------------------------------------------------

export async function handleStandardWrite(
	params: Record<string, unknown>,
	db: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	const validated = StandardWriteSchema.parse(params) as unknown as WriteParams;

	// ── Bulk mode ──
	if (validated.standards && validated.standards.length > 0) {
		return handleBulk(validated, db, vectors);
	}

	// ── Update mode: id or code + any fields ──
	if (validated.id || validated.code) {
		return handleUpdateSingle(validated, db, vectors);
	}

	// ── Create mode: content present (no id/code) ──
	if (validated.content && validated.name) {
		return handleCreateSingle(validated, db, vectors);
	}

	// ── Nothing matched ──
	throw new Error(
		"Could not infer operation. Provide:\n" +
			"  - `standards[]` for BULK CREATE\n" +
			"  - `name` + `content` + `tags` + `metadata` for single CREATE\n" +
			"  - `id`/`code` + fields for UPDATE"
	);
}
