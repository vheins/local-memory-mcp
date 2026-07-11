import { UUID_REGEX } from "../utils/uuid";
import { MemoryUpdateSchema } from "./schemas";
import { SQLiteStore } from "../storage/sqlite";
import { Memory, VectorStore } from "../types";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";
import { logger } from "../utils/logger";

function hasMetadataLikeTitle(title: string): boolean {
	const normalized = title.trim();
	return /^\[[^\]]{0,200}(agent:|role:|model:|\d{4}-\d{2}-\d{2}|source_)[^\]]*\]/i.test(normalized);
}

function resolveMemorySupersedes(
	value: string | null | undefined,
	db: SQLiteStore,
	owner?: string,
	repo?: string
): string | null {
	if (!value) return null;
	if (UUID_REGEX.test(value)) return value;
	const memory = db.memories.getByCode(value, owner, repo);
	if (!memory) throw new Error(`supersedes: memory with code '${value}' not found`);
	return memory.id;
}

export async function handleMemoryUpdate(
	params: Record<string, unknown>,
	db: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	// Validate input
	const validated = MemoryUpdateSchema.parse(params);

	// Resolve code to id if needed
	let resolvedId = validated.id;
	if (resolvedId && !UUID_REGEX.test(resolvedId)) {
		const byCode = db.memories.getByCode(resolvedId, validated.owner, validated.repo);
		if (!byCode) throw new Error(`Memory not found: ${resolvedId}`);
		resolvedId = byCode.id;
	}
	if (!resolvedId && validated.code) {
		const byCode = db.memories.getByCode(validated.code, validated.owner, validated.repo);
		if (!byCode) throw new Error(`Memory not found: ${validated.code}`);
		resolvedId = byCode.id;
	} else if (!resolvedId) {
		throw new Error("Either id or code must be provided");
	}

	// Check if memory exists
	const existing = db.memories.getById(resolvedId);
	if (!existing) {
		throw new Error(`Memory not found: ${resolvedId}`);
	}

	// Repository Mismatch Check: If repo is provided in args, it MUST match the entry's repo
	const repoFilter = params?.repo || (params?.scope as Record<string, unknown>)?.repo;
	if (repoFilter && repoFilter !== existing.scope.repo) {
		throw new Error(
			`Repository mismatch: provided repo "${repoFilter}" does not match memory repo "${existing.scope.repo}"`
		);
	}

	if (validated.title !== undefined && hasMetadataLikeTitle(validated.title)) {
		throw new Error(
			"Title appears to contain metadata. Keep title concise and move agent/role/date details into metadata or dedicated fields."
		);
	}

	// Update in SQLite
	const updates: Partial<Memory> = {};
	if (validated.type !== undefined) updates.type = validated.type;
	if (validated.title !== undefined) updates.title = validated.title;
	if (validated.content !== undefined) updates.content = validated.content;
	if (validated.importance !== undefined) updates.importance = validated.importance;
	if (validated.agent !== undefined) updates.agent = validated.agent;
	if (validated.role !== undefined) updates.role = validated.role;
	if (validated.status !== undefined) updates.status = validated.status;
	if (validated.supersedes !== undefined)
		updates.supersedes = resolveMemorySupersedes(validated.supersedes, db, existing.scope.owner, existing.scope.repo);
	if (validated.tags !== undefined) updates.tags = validated.tags;
	if (validated.metadata !== undefined) updates.metadata = validated.metadata;
	if (validated.is_global !== undefined) updates.is_global = validated.is_global;
	if (validated.completed_at !== undefined) updates.completed_at = validated.completed_at;

	db.memories.update(resolvedId, updates);

	// Update vector if content changed
	if (validated.content !== undefined) {
		await vectors.upsert(resolvedId, validated.content);
	}

	// Log the update action
	db.actions.logAction("update", existing.scope.owner, existing.scope.repo, { memoryId: resolvedId, resultCount: 1 });
	logger.info("[Tool] memory.update", { repo: existing.scope.repo, id: resolvedId, fields: Object.keys(updates) });

	return createMcpResponse(
		{
			success: true,
			id: resolvedId,
			code: existing.code,
			repo: existing.scope.repo,
			updatedFields: Object.keys(updates)
		},
		`Updated memory [${existing.code}] in repo "${existing.scope.repo}". Fields: ${Object.keys(updates).join(", ") || "none"}.`,
		{
			structuredContentPathHint: "updatedFields",
			includeSerializedStructuredContent: validated.structured
		}
	);
}
