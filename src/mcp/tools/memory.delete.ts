import { SQLiteStore } from "../storage/sqlite";
import { VectorStore } from "../types";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";
import { logger } from "../utils/logger";
import { MemoryDeleteSchema } from "./schemas";

export async function handleMemoryDelete(
	params: Record<string, unknown>,
	db: SQLiteStore,
	vectors: VectorStore,
	onProgress?: (progress: number, total?: number) => void
): Promise<McpResponse> {
	// Validate input
	const validated = MemoryDeleteSchema.parse(params);
	const { id, ids, code, codes, repo, structured } = validated;

	// Resolve code(s) to id(s)
	const resolvedIds: string[] = [];
	if (ids) resolvedIds.push(...ids);
	if (id) resolvedIds.push(id);
	if (code) {
		const entry = db.memories.getByCode(code);
		if (!entry) throw new Error(`Memory not found: ${code}`);
		resolvedIds.push(entry.id);
	}
	if (codes) {
		for (const c of codes) {
			const entry = db.memories.getByCode(c);
			if (!entry) throw new Error(`Memory not found: ${c}`);
			resolvedIds.push(entry.id);
		}
	}

	if (resolvedIds.length === 0) {
		throw new Error("Either 'id', 'ids', 'code', or 'codes' must be provided for deletion");
	}

	const targetIds = resolvedIds;

	let deletedCount = 0;
	const deletedCodes: string[] = [];
	let lastRepo = repo || "unknown";

	const total = targetIds.length;
	let progress = 0;

	const existingMemories = db.memories.getByIds(targetIds);
	const existingMap = new Map(existingMemories.map((m) => [m.id, m]));
	const validIdsToDelete: string[] = [];

	for (const targetId of targetIds) {
		const existing = existingMap.get(targetId);
		if (existing) {
			lastRepo = existing.scope.repo;
			deletedCodes.push(existing.code || existing.id);
			validIdsToDelete.push(targetId);
		} else if (id) {
			throw new Error(`Memory not found: ${targetId}`);
		}
	}

	if (validIdsToDelete.length > 0) {
		db.memoryArchives.bulkDeleteMemories(validIdsToDelete);
		for (const validId of validIdsToDelete) {
			if (onProgress) {
				onProgress(progress, total);
			}
			await vectors.remove(validId);
			progress++;
		}
		deletedCount = validIdsToDelete.length;
	}

	if (onProgress) {
		onProgress(progress, total);
	}

	logger.info("[Tool] memory.delete", { repo: lastRepo, count: deletedCount });

	return createMcpResponse(
		{
			success: true,
			id: id || undefined,
			ids: ids || undefined,
			repo: lastRepo,
			deletedCount,
			deletedCodes: deletedCount > 10 ? [...deletedCodes.slice(0, 10), "..."] : deletedCodes
		},
		`Deleted ${deletedCount} memory entry(ies) from repo "${lastRepo}".`,
		{
			structuredContentPathHint: "deletedCount",
			includeSerializedStructuredContent: structured
		}
	);
}
