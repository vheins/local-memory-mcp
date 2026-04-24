import { StandardUpdateSchema } from "./schemas";
import { SQLiteStore } from "../storage/sqlite";
import { CodingStandardEntry, VectorStore } from "../types";
import { logger } from "../utils/logger";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";
import { buildStandardVectorText } from "./standard.shared";

export async function handleStandardUpdate(
	params: Record<string, unknown>,
	db: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	const validated = StandardUpdateSchema.parse(params);

	const existing = db.standards.getById(validated.id);
	if (!existing) {
		throw new Error(`Coding standard not found: ${validated.id}`);
	}

	const updates: Partial<CodingStandardEntry> = {};
	if (validated.name !== undefined) updates.title = validated.name;
	if (validated.content !== undefined) updates.content = validated.content;
	if (validated.parent_id !== undefined) updates.parent_id = validated.parent_id;
	if (validated.context !== undefined) updates.context = validated.context;
	if (validated.version !== undefined) updates.version = validated.version;
	if (validated.language !== undefined) updates.language = validated.language;
	if (validated.stack !== undefined) updates.stack = validated.stack;
	if (validated.repo !== undefined) updates.repo = validated.repo;
	if (validated.is_global !== undefined) updates.is_global = validated.is_global;
	if (validated.tags !== undefined) updates.tags = validated.tags;
	if (validated.metadata !== undefined) updates.metadata = validated.metadata;
	if (validated.agent !== undefined) updates.agent = validated.agent;
	if (validated.model !== undefined) updates.model = validated.model;

	db.standards.update(validated.id, updates);

	const merged: CodingStandardEntry = {
		...existing,
		...updates,
		updated_at: new Date().toISOString()
	};

	if (
		validated.name !== undefined ||
		validated.content !== undefined ||
		validated.context !== undefined ||
		validated.version !== undefined ||
		validated.language !== undefined ||
		validated.stack !== undefined ||
		validated.tags !== undefined ||
		validated.metadata !== undefined
	) {
		await vectors.upsert(validated.id, buildStandardVectorText(merged), "standard");
	}

	logger.info("[Tool] standard.update - updated coding standard", {
		standardId: validated.id,
		fields: Object.keys(updates)
	});

	return createMcpResponse(
		{
			success: true,
			id: validated.id,
			updatedFields: Object.keys(updates)
		},
		`Updated coding standard ${validated.id}. Fields: ${Object.keys(updates).join(", ") || "none"}.`,
		{
			structuredContentPathHint: "updatedFields",
			includeSerializedStructuredContent: true
		}
	);
}
