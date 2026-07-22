import { UUID_REGEX } from "../utils/uuid";
import { StandardUpdateSchema } from "./schemas";
import { SQLiteStore } from "../storage/sqlite";
import { CodingStandardEntry, VectorStore } from "../types";
import { logger } from "../utils/logger";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";
import { buildStandardVectorText } from "./standard.shared";

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

export async function handleStandardUpdate(
	params: Record<string, unknown>,
	db: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	const validated = StandardUpdateSchema.parse(params);

	// Resolve code to id if needed
	let resolvedId = validated.id;
	if (resolvedId && !UUID_REGEX.test(resolvedId)) {
		const byCode = db.standards.getByCode(resolvedId, validated.owner, validated.repo);
		if (!byCode) throw new Error(`Coding standard not found: ${resolvedId}`);
		resolvedId = byCode.id;
	}
	if (!resolvedId && validated.code) {
		const byCode = db.standards.getByCode(validated.code, validated.owner, validated.repo);
		if (!byCode) throw new Error(`Coding standard not found: ${validated.code}`);
		resolvedId = byCode.id;
	} else if (!resolvedId) {
		throw new Error("Either id or code must be provided");
	}

	const existing = db.standards.getById(resolvedId);
	if (!existing) {
		throw new Error(`Coding standard not found: ${resolvedId}`);
	}

	const updates: Partial<CodingStandardEntry> = {};
	if (validated.name !== undefined) updates.title = validated.name;
	if (validated.content !== undefined) updates.content = validated.content;
	if (validated.parent_id !== undefined)
		updates.parent_id = resolveStandardParentId(validated.parent_id, db, existing.owner, existing.repo ?? undefined);
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

	db.standards.update(resolvedId, updates);

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
		await vectors.upsert(resolvedId, buildStandardVectorText(merged), "standard");
	}

	logger.info("[Tool] standard.update - updated coding standard", {
		standardId: resolvedId,
		fields: Object.keys(updates)
	});

	return createMcpResponse(
		{
			success: true,
			id: resolvedId,
			code: existing.code,
			updatedFields: Object.keys(updates)
		},
		`Updated [${existing.code}] in repo "${existing.repo || "global"}": fields ${Object.keys(updates).join(", ") || "none"}.`,
		{
			structuredContentPathHint: "updatedFields",
			includeJson: true
		}
	);
}
