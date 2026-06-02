import { randomUUID } from "crypto";
import { StandardStoreSchema } from "./schemas";
import { SQLiteStore } from "../storage/sqlite";
import { CodingStandardEntry, VectorStore } from "../types";
import { logger } from "../utils/logger";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";
import { buildStandardVectorText, toContextSlug } from "./standard.shared";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function generateShortCode(): string {
	const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
	let code = "";
	for (let i = 0; i < 6; i++) {
		code += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return code;
}

function resolveStandardParentId(value: string | null | undefined, db: SQLiteStore): string | null {
	if (!value) return null;
	if (UUID_REGEX.test(value)) return value;
	const standard = db.standards.getByCode(value);
	if (!standard) throw new Error(`parent_id: standard with code '${value}' not found`);
	return standard.id;
}

async function storeSingleStandard(
	params: {
		name: string;
		content: string;
		parent_id?: string;
		context?: string;
		version?: string;
		language?: string;
		stack?: string[];
		repo?: string;
		is_global?: boolean;
		tags: string[];
		metadata: Record<string, unknown>;
		agent?: string;
		model?: string;
		structured: boolean;
	},
	db: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	const incomingVersion = params.version || "1.0.0";
	const incomingLanguage = params.language ?? null;
	const incomingStack = params.stack ?? [];
	const conflict = db.standards.checkConflicts(
		params.content,
		incomingVersion,
		params.repo,
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
			`Rejected: conflicts with standard "${conflict.title}" (v${conflict.version}, ${conflict.language || "any"}) [${conflict.id.slice(0, 8)}...]. Update via 'standard-update', or differentiate by version / language / stack.`
		);
	}

	const now = new Date().toISOString();

	const entry: CodingStandardEntry = {
		id: randomUUID(),
		code: generateShortCode(),
		title: params.name,
		content: params.content,
		parent_id: resolveStandardParentId(params.parent_id, db),
		context: toContextSlug(params.context || "general"),
		version: params.version || "1.0.0",
		language: params.language || null,
		stack: params.stack || [],
		is_global: params.is_global !== false,
		repo: params.repo || null,
		tags: params.tags || [],
		metadata: params.metadata,
		created_at: now,
		updated_at: now,
		hit_count: 0,
		last_used_at: null,
		agent: params.agent || "unknown",
		model: params.model || "unknown"
	};

	db.standards.insert(entry);

	try {
		await vectors.upsert(entry.id, buildStandardVectorText(entry), "standard");
	} catch (error) {
		logger.warn("Failed to generate standard vector embedding", { error: String(error) });
	}

	return createMcpResponse(
		{
			success: true,
			standard: entry,
			message: `Coding standard [${entry.code}] "${entry.title}" saved successfully.`
		},
		`Saved coding standard [${entry.code}]: ${entry.title}`,
		{
			structuredContentPathHint: "standard",
			includeSerializedStructuredContent: params.structured
		}
	);
}

export async function handleStandardStore(
	params: Record<string, unknown>,
	db: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	const validated = StandardStoreSchema.parse(params);

	// Bulk mode
	if (validated.standards) {
		const storedCodes: string[] = [];
		for (const std of validated.standards) {
			const result = await storeSingleStandard(
				{
					...std,
					structured: validated.structured
				},
				db,
				vectors
			);
			if (result.isError) return result;
			const data = result.structuredContent as { standard?: { code?: string } };
			if (data?.standard?.code) storedCodes.push(data.standard.code);
		}
		const codesStr = storedCodes.length > 0 ? `: ${storedCodes.join(", ")}` : "";
		return createMcpResponse(
			{ success: true, createdCount: validated.standards.length, codes: storedCodes },
			`Saved ${validated.standards.length} coding standards${codesStr}.`,
			{ includeSerializedStructuredContent: validated.structured }
		);
	}

	// Single mode
	return storeSingleStandard(
		{
			name: validated.name!,
			content: validated.content!,
			parent_id: validated.parent_id,
			context: validated.context,
			version: validated.version,
			language: validated.language,
			stack: validated.stack,
			repo: validated.repo,
			is_global: validated.is_global,
			tags: validated.tags!,
			metadata: validated.metadata!,
			agent: validated.agent,
			model: validated.model,
			structured: validated.structured
		},
		db,
		vectors
	);
}
