/**
 * standard-write/bulk — bulk standard creation with partial execution.
 */

import { randomUUID } from "crypto";
import { CodingStandardEntry, VectorStore } from "../../types/index.js";
import { SQLiteStore } from "../../storage/sqlite.js";
import { logger } from "../../utils/logger.js";
import { createMcpResponse, McpResponse } from "../../utils/mcp-response.js";
import {
	WriteParams,
	BulkResult,
	resolveStandardParentId,
	toContextSlug,
	buildStandardVectorText,
	generateNextCode,
	saveExtractions,
	saveStandardRelations
} from "./shared.js";

// ── Bulk handler ─────────────────────────────────────────────────────────

export async function handleBulk(params: WriteParams, db: SQLiteStore, vectors: VectorStore): Promise<McpResponse> {
	const items = params.standards ?? [];
	const results: BulkResult[] = [];
	const batchCodes = new Set<string>();
	const standardRepo = params.repo || "__global__";

	for (let i = 0; i < items.length; i++) {
		const raw = items[i] as Record<string, unknown>;

		const std = {
			...raw,
			owner: (raw.owner as string) ?? params.owner,
			repo: (raw.repo as string) ?? params.repo,
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

			// KG semantic relations (parent_id→extends, similarity→related_to, per REFACTOR-KG-002)
			try {
				await saveStandardRelations(entry, db);
			} catch (error) {
				logger.warn("[KG-Archivist] Standard KG relations failed", { error: String(error) });
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
