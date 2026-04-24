import { randomUUID } from "crypto";
import { StandardStoreSchema } from "./schemas";
import { SQLiteStore } from "../storage/sqlite";
import { CodingStandardEntry, VectorStore } from "../types";
import { logger } from "../utils/logger";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";
import { buildStandardVectorText } from "./standard.shared";

export async function handleStandardStore(
	params: Record<string, unknown>,
	db: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	// Validate input
	const validated = StandardStoreSchema.parse(params);

	// Create coding standard entry
	const now = new Date().toISOString();

	const entry: CodingStandardEntry = {
		id: randomUUID(),
		title: validated.name,
		content: validated.content,
		parent_id: validated.parent_id || null,
		context: validated.context || "general",
		version: validated.version || "1.0.0",
		language: validated.language || null,
		stack: validated.stack || [],
		is_global: validated.is_global !== false,
		repo: validated.repo || null,
		tags: validated.tags || [],
		metadata: validated.metadata,
		created_at: now,
		updated_at: now,
		hit_count: 0,
		last_used_at: null,
		agent: validated.agent || "unknown",
		model: validated.model || "unknown"
	};

	// Insert into database
	db.standards.insert(entry);

	try {
		await vectors.upsert(entry.id, buildStandardVectorText(entry), "standard");
	} catch (error) {
		logger.warn("Failed to generate standard vector embedding", { error: String(error) });
	}

	logger.info("[Tool] standard.store - saved coding standard", {
		standardId: entry.id,
		title: entry.title,
		stack: entry.stack,
		language: entry.language
	});

	return createMcpResponse(
		{
			success: true,
			standard: entry,
			message: `Coding standard "${entry.title}" saved successfully.`
		},
		`Saved coding standard: ${entry.title}`,
		{
			structuredContentPathHint: "standard",
			includeSerializedStructuredContent: true
		}
	);
}
