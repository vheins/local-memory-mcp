import { SQLiteStore } from "../storage/sqlite";
import { VectorStore } from "../types";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";
import { logger } from "../utils/logger";
import { resolveEntityRef } from "../utils/entity-ref";
import { observationText } from "./kg-archivist";
import { StandardDeleteSchema } from "./schemas";

export async function handleStandardDelete(
	params: Record<string, unknown>,
	db: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	const validated = StandardDeleteSchema.parse(params);
	const { id, ids, code, codes, owner, repo, json } = validated;

	// Resolve all identifiers to UUIDs
	const resolvedIds: string[] = [];

	// Helper: resolve a single identifier (UUID or code) to UUID
	function resolveIdentifier(identifier: string): string {
		return resolveEntityRef(db, "standard", identifier, owner, repo) ?? "";
	}

	// Single identifier: id (UUID or code — auto-inferred)
	if (id) {
		resolvedIds.push(resolveIdentifier(id));
	}

	// Single code
	if (code) {
		resolvedIds.push(resolveIdentifier(code));
	}

	// Bulk identifiers: ids (array of UUIDs or codes — auto-inferred per item)
	if (ids) {
		for (const item of ids) {
			resolvedIds.push(resolveIdentifier(item));
		}
	}

	// Bulk codes
	if (codes) {
		for (const c of codes) {
			resolvedIds.push(resolveIdentifier(c));
		}
	}

	// Fetch standards to verify existence and collect metadata for response
	const existingStandards = db.standards.getByIds(resolvedIds);
	const standardMap = new Map(existingStandards.map((s) => [s.id, s]));
	const deletedTitles: string[] = [];
	const deletedCodes: string[] = [];
	const validIdsToDelete: string[] = [];

	let lastRepo = repo || "unknown";
	const deleteErrors: { identifier: string; error: string }[] = [];
	const isBulk = (ids && ids.length > 1) || (codes && codes.length > 1);

	for (const targetId of resolvedIds) {
		const existing = standardMap.get(targetId);
		if (existing) {
			lastRepo = existing.repo || (existing.is_global ? "global" : lastRepo);
			deletedTitles.push(existing.title);
			if (existing.code) deletedCodes.push(existing.code);
			validIdsToDelete.push(targetId);
		} else if (isBulk) {
			deleteErrors.push({ identifier: targetId, error: "Coding standard not found" });
		} else {
			throw new Error(`Coding standard not found: ${targetId}`);
		}
	}

	let deletedCount = 0;

	if (validIdsToDelete.length > 0) {
		// Hard-delete standards + purge pending embedding-queue jobs in ONE
		// transaction — a stale queue_jobs row could otherwise re-embed the
		// vector and re-run KG extraction for a deleted standard
		// (TASK-042 / MEM-427).
		db.db
			.transaction(() => {
				for (const validId of validIdsToDelete) {
					db.standards.delete(validId);
				}
				const placeholders = validIdsToDelete.map(() => "?").join(",");
				db.db
					.prepare(`DELETE FROM queue_jobs WHERE entity_kind = ? AND entity_id IN (${placeholders})`)
					.run("standard", ...validIdsToDelete);
			})
			.immediate();

		// Collect observation texts for batch KG cleanup (once per batch, not per
		// item) — each (text, repo) pair is scoped to the standard's own repo so
		// identical titles across repos never cross-delete (TASK-045/043).
		const observationTexts: { text: string; repo: string }[] = [];

		for (const validId of validIdsToDelete) {
			// Remove vector embedding
			await vectors.remove(validId, "standard");

			const standardEntry = standardMap.get(validId);
			if (standardEntry) {
				observationTexts.push({
					text: observationText("standard", standardEntry.title),
					repo: standardEntry.repo ?? ""
				});
			}
		}

		// KG cleanup: best-effort, atomic (single transaction), once per batch —
		// orphans checked via observations UNION relations so relation-referenced
		// entities are KEPT (REFACTOR-KG-006 / TASK-004); observation deletes +
		// orphan sweep scoped to the touched repo(s) (TASK-043).
		try {
			db.knowledgeGraph.deleteObservationsAndOrphans(observationTexts);
		} catch (kgError) {
			logger.warn("[KG-Cleanup] Failed to clean up KG entities for deleted standards", {
				error: String(kgError)
			});
		}

		deletedCount = validIdsToDelete.length;
	}

	const allOk = deleteErrors.length === 0;

	logger.info("[Tool] standard.delete", {
		repo: lastRepo,
		count: deletedCount,
		...(deleteErrors.length > 0 ? { errors: deleteErrors.length } : {})
	});

	const codeSample =
		deletedCodes.length <= 3
			? deletedCodes.join(", ")
			: `${deletedCodes.slice(0, 3).join(", ")}, ... (${deletedCodes.length} total)`;

	const responseData: Record<string, unknown> = {
		success: allOk,
		id: id || undefined,
		ids: ids || undefined,
		repo: lastRepo,
		deletedCount,
		deletedCodes: deletedCodes.length > 10 ? [...deletedCodes.slice(0, 10), "..."] : deletedCodes,
		deletedTitles: deletedTitles.length > 10 ? [...deletedTitles.slice(0, 10), "..."] : deletedTitles
	};

	if (deleteErrors.length > 0) {
		responseData.errors = deleteErrors;
		responseData.totalAttempted = resolvedIds.length;
	}

	return createMcpResponse(
		responseData,
		`Deleted ${deletedCount} ${deletedCount === 1 ? "standard" : "standards"} from "${lastRepo}"${deletedCodes.length > 0 ? `: ${codeSample}` : ""}${deleteErrors.length > 0 ? ` (${deleteErrors.length} failed)` : ""}.`,
		{
			includeJson: json
		}
	);
}
