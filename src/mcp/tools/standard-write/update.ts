/**
 * standard-write/update — single standard update with conflict detection.
 */

import { CodingStandardEntry, VectorStore } from "../../types/index.js";
import { SQLiteStore } from "../../storage/sqlite.js";
import { logger } from "../../utils/logger.js";
import { createMcpResponse, McpResponse } from "../../utils/mcp-response.js";
import { UUID_REGEX } from "../../utils/uuid.js";
import {
	WriteParams,
	resolveStandardParentId,
	buildStandardVectorText,
	saveExtractions,
	saveStandardRelations
} from "./shared.js";

// ── Core update logic — returns plain data, does NOT wrap in McpResponse ──

export async function coreUpdate(
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

		// KG semantic relations (parent_id→extends, similarity→related_to, per REFACTOR-KG-002)
		try {
			await saveStandardRelations(merged, db);
		} catch (error) {
			logger.warn("[KG-Archivist] Standard KG relations failed on update", {
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

// ── Single update handler (returns McpResponse) ─────────────────────────

export async function handleUpdateSingle(
	params: WriteParams,
	db: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
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
