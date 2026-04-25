import { randomUUID } from "crypto";
import { StandardStoreSchema } from "./schemas";
import { SQLiteStore } from "../storage/sqlite";
import { CodingStandardEntry, VectorStore } from "../types";
import { logger } from "../utils/logger";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";
import { buildStandardVectorText, toContextSlug } from "./standard.shared";

function generateShortCode(): string {
	const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
	let code = "";
	for (let i = 0; i < 6; i++) {
		code += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return code;
}

export async function handleStandardStore(
	params: Record<string, unknown>,
	db: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	// Validate input
	const validated = StandardStoreSchema.parse(params);

	// --- Similarity conflict check ---
	// Threshold 0.82: stricter than memory-store (0.55) since coding standards
	// tend to be more terse and dense.
	// Exempt when version, language, OR stack differs from the conflicting entry.
	const incomingVersion = validated.version || "1.0.0";
	const incomingLanguage = validated.language ?? null;
	const incomingStack = validated.stack ?? [];
	const conflict = db.standards.checkConflicts(
		validated.content,
		incomingVersion,
		validated.repo,
		incomingLanguage,
		incomingStack,
		0.82
	);

	if (conflict) {
		return createMcpResponse(
			{
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
					"Use 'standard-update' on the existing ID to update it. To store a distinct variant, supply a different 'version', 'language', or non-overlapping 'stack'."
			},
			`Rejected: conflicts with standard "${conflict.title}" (${conflict.id}). Update it via 'standard-update', or differentiate by version / language / stack.`,
			{ structuredContentPathHint: "conflicting_standard" }
		);
	}

	// Create coding standard entry
	const now = new Date().toISOString();

	const entry: CodingStandardEntry = {
		id: randomUUID(),
		code: generateShortCode(),
		title: validated.name,
		content: validated.content,
		parent_id: validated.parent_id || null,
		context: toContextSlug(validated.context || "general"),
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
		code: entry.code,
		title: entry.title,
		stack: entry.stack,
		language: entry.language
	});

	return createMcpResponse(
		{
			success: true,
			standard: entry,
			message: `Coding standard [${entry.code}] "${entry.title}" saved successfully.`
		},
		`Saved coding standard [${entry.code}]: ${entry.title}`,
		{
			structuredContentPathHint: "standard",
			includeSerializedStructuredContent: true
		}
	);
}
