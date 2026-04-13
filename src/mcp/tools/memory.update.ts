import { MemoryUpdateSchema } from "./schemas";
import { SQLiteStore } from "../storage/sqlite";
import { Memory, VectorStore } from "../types";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";
import { logger } from "../utils/logger";

function hasMetadataLikeTitle(title: string): boolean {
	const normalized = title.trim();
	return /^\[[^\]]{0,200}(agent:|role:|model:|\d{4}-\d{2}-\d{2}|source_)[^\]]*\]/i.test(normalized);
}

export async function handleMemoryUpdate(params: Record<string, unknown>, db: SQLiteStore, vectors: VectorStore): Promise<McpResponse> {
	// Validate input
	const validated = MemoryUpdateSchema.parse(params);

	// Check if memory exists
	const existing = db.memories.getById(validated.id);
	if (!existing) {
		throw new Error(`Memory not found: ${validated.id}`);
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
	if (validated.supersedes !== undefined) updates.supersedes = validated.supersedes;
	if (validated.tags !== undefined) updates.tags = validated.tags;
	if (validated.metadata !== undefined) updates.metadata = validated.metadata;
	if (validated.is_global !== undefined) updates.is_global = validated.is_global;
	if (validated.completed_at !== undefined) updates.completed_at = validated.completed_at;

	db.memories.update(validated.id, updates);

	// Update vector if content changed
	if (validated.content !== undefined) {
		await vectors.upsert(validated.id, validated.content);
	}

	// Log the update action
	db.actions.logAction("update", existing.scope.repo, { memoryId: validated.id, resultCount: 1 });
	logger.info("[Tool] memory.update", { repo: existing.scope.repo, id: validated.id, fields: Object.keys(updates) });

	return createMcpResponse(
		{
			success: true,
			id: validated.id,
			repo: existing.scope.repo,
			updatedFields: Object.keys(updates)
		},
		`Updated memory ${validated.id} in repo "${existing.scope.repo}". Fields: ${Object.keys(updates).join(", ") || "none"}.`,
		{
			structuredContentPathHint: "updatedFields",
			includeSerializedStructuredContent: validated.structured,
			resourceLinks: [
				{
					uri: `memory://${validated.id}`,
					name: existing.title || validated.id,
					description: `Updated memory [${existing.code}] in repo ${existing.scope.repo}`,
					mimeType: "application/json",
					annotations: {
						audience: ["assistant"],
						priority: 0.9
					}
				}
			]
		}
	);
}
