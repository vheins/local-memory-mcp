/**
 * purgeEntityAndCleanup — the single shared purge + cleanup contract for every
 * delete path (OPT-DRY-03).
 *
 * The three MCP delete tools (memory/standard/task) used to hand-roll the same
 * skeleton: entity delete/cancel → queue_jobs purge → vector removal → KG
 * observation delete + orphan sweep — with per-kind extras (claim release,
 * handoff expiry, child detach for tasks) and byte-identical pieces (the
 * `DELETE FROM queue_jobs WHERE entity_kind = ? AND entity_id IN (...)` txn and
 * the `catch (kgError) { logger.warn('[KG-Cleanup]…') }` block). The dashboard
 * bulk-delete endpoints (tasks/standards) additionally DIVERGED from that
 * contract — hard-deleting rows and skipping all cleanup (OPT-FEAT-04 tester
 * findings, 0b96ad7).
 *
 * This helper is the one place those semantics live: the MCP delete tools
 * (single + bulk, memory/task/standard) and the dashboard delete paths
 * (single + bulk, memory/task/standard — TASK-207) route here so a change to
 * purge/KG semantics lands once. Entity-not-found handling is deliberately
 * NOT part of this contract — each caller implements the OPT-CODE-04 unified
 * policy in its own existence loop (single target → throw; bulk → skip +
 * report via `errors`), because labels and response shapes differ per domain.
 * Code-resolution failures (unresolvable codes) already throw at
 * collectEntityIds (TASK-123) before any caller loop runs.
 *
 * Signature note: the `items` array carries `{ id, title, repo }` instead of
 * separate `ids/titles/repo` args because KG observation cleanup is scoped per
 * item to the entity's OWN repo (TASK-045/043) — a raw-UUID delete can target
 * an entity whose repo differs from the validated repo, and collapsing to one
 * repo would let identical titles cross-delete another repo's graph.
 */

import { SQLiteStore } from "../storage/sqlite";
import { MEMORY_STATUS_ARCHIVED } from "../types";
import { observationText, type KgObservationDomain } from "../tools/kg-archivist/observation-text";
import { logger } from "./logger";
import { chunksOf } from "./chunk";
import { BULK_UPDATE_CHUNK_SIZE } from "./constants";

/**
 * Purge-able domains — deliberately EXCLUDES "codebase": codebase rows are
 * purged by the indexing writer's stale-file sweep (cleanStaleFiles, TASK-293),
 * NOT through this helper. Narrowing via Exclude makes the compiler enforce
 * that intent here, so a future caller can never pass "codebase" into the
 * 3-branch switch below and silently no-op the entity delete (TASK-341).
 */
export type PurgeEntityKind = Exclude<KgObservationDomain, "codebase">;

export interface PurgeEntityItem {
	/** Entity UUID to purge. */
	id: string;
	/**
	 * Entity title — builds the KG observation text. Omit when the row does not
	 * exist (phantom raw UUID) so no KG observation is emitted for it.
	 */
	title?: string;
	/** Repo that owns the entity — scopes the KG observation delete (TASK-045/043). */
	repo?: string;
}

export interface PurgeEntityCleanupOptions {
	/**
	 * Progress callback: fired AFTER the DB transaction commits — once per item
	 * (in order) plus a final call with `progress === total`. Mirrors the
	 * memory-delete contract.
	 */
	onProgress?: (progress: number, total: number) => void;
}

// Exactly 3 members: the compiler rejects a "codebase" key here because
// PurgeEntityKind excludes it (codebase purges go through cleanStaleFiles).
const KIND_PLURALS: Record<PurgeEntityKind, string> = {
	memory: "memories",
	standard: "standards",
	task: "tasks"
};

/**
 * Phase 1 of the purge contract: delete the pending embedding-queue jobs of
 * `items`, in its own transaction.
 *
 * ORDER IS THE SAFETY MECHANISM (FIX-006), and this phase guards all three
 * kinds. `queue_jobs` lives in `memory.db` (core), which is also the file the
 * `memory` mutation writes; task/standard rows live in `tasks.db` /
 * `standards.db` (ADR-012), so for those two the ordering additionally crosses
 * files, and a transaction spanning attached databases is NOT atomic under WAL
 * — the repo records that in `domain-migration.ts` / `derived-db.ts`. For
 * `memory` the row and its job share `memory.db` and each phase runs its own
 * transaction, so the cross-file argument does not apply there; the ordering
 * still matters because it is what keeps the job from outliving its entity.
 * Running this phase FIRST makes the crash residue safe in every kind: should
 * the process die right after it, the entity still exists and simply has no
 * pending job (it stops being re-embedded), whereas the reverse order could
 * leave a job that points at a deleted/canceled row and re-embeds its vector or
 * re-runs KG extraction afterwards (TASK-042 / MEM-427). Never move this after
 * the entity mutation.
 *
 * Idempotent by construction: deleting an already-absent job row is a no-op, so
 * repeating the purge after a later-phase failure converges.
 */
function purgeQueueJobs(db: SQLiteStore, kind: PurgeEntityKind, items: PurgeEntityItem[]): void {
	// Chunked at BULK_UPDATE_CHUNK_SIZE via the shared chunksOf helper — a single
	// un-chunked IN(...) over the whole batch would exceed SQLite's
	// bound-variable limit on select-all bulk deletes and abort the transaction
	// (TASK-139).
	db.db
		.transaction(() => {
			for (const chunk of chunksOf(items, BULK_UPDATE_CHUNK_SIZE)) {
				const placeholders = chunk.map(() => "?").join(",");
				db.db
					.prepare(`DELETE FROM queue_jobs WHERE entity_kind = ? AND entity_id IN (${placeholders})`)
					.run(kind, ...chunk.map((item) => item.id));
			}
		})
		.immediate();
}

/**
 * Runs the full delete contract for a batch of entities of one kind as four
 * ordered phases. No phase relies on a commit that spans two database files.
 *
 * 1. `queue_jobs` purge — FIRST, own transaction ({@link purgeQueueJobs}). The
 *    safe-first order is documented there.
 * 2. Entity mutation — own transaction, per kind: archive memories / hard-delete
 *    standards / cancel tasks with their coordination cleanup (claim release,
 *    handoff expiry, child detach). If this phase fails, phase 1 is NOT rolled
 *    back — it cannot be, the writes live in different files under WAL. That
 *    residue is the harmless one (job gone, entity still present) and phase 1 is
 *    idempotent, so a retry completes the purge. A partially-scanned batch can
 *    roll back its own entity writes, since those share one file group.
 * 3. Derived vector cleanup for tasks and standards — own transaction, in
 *    `codebase.db`. The row is committed before its vector on purpose: a crash
 *    between the phases leaves an orphan vector, which is inert (every vector
 *    read JOINs its parent table), never a row whose vector is missing. That
 *    missing-vector direction is the one semantic search would silently lose
 *    until the capped startup backfill repaired it.
 * 4. KG cleanup — best-effort (never throws), atomic, once per batch, each
 *    (text, repo) pair scoped to the entity's OWN repo so identical titles
 *    across repos never cross-delete (TASK-045/043); orphans are checked via
 *    observations UNION relations so relation-referenced entities are KEPT
 *    (REFACTOR-KG-006 / TASK-004).
 *
 * Archived memories legitimately keep their vector rows — they stay searchable
 * with `includeArchived`.
 *
 * @returns The number of items purged (=== `items.length`).
 */
export function purgeEntityAndCleanup(
	db: SQLiteStore,
	kind: PurgeEntityKind,
	items: PurgeEntityItem[],
	opts?: PurgeEntityCleanupOptions
): number {
	if (items.length === 0) return 0;

	const onProgress = opts?.onProgress;
	const total = items.length;
	const now = new Date().toISOString();

	purgeQueueJobs(db, kind, items);

	db.db
		.transaction(() => {
			switch (kind) {
				case "memory":
					// Soft delete (archive).
					db.memories.bulkUpdateMemories(
						items.map((i) => i.id),
						{ status: MEMORY_STATUS_ARCHIVED }
					);
					break;
				case "standard":
					// Hard delete.
					for (const item of items) {
						db.standards.delete(item.id);
					}
					break;
				case "task":
					// Soft cancel + coordination cleanup: detach children so no
					// stale enqueued worker snapshot re-derives KG relations,
					// release claims and expire linked handoffs
					// (TASK-065 / MEM-473). The task vector is removed in the
					// next phase instead, so this transaction stays inside
					// tasks.db.
					for (const item of items) {
						db.tasks.updateTask(item.id, { status: "canceled", canceled_at: now });
						db.tasks.clearChildrenParent(item.id);
						db.handoffs.releaseClaimsForTask(item.id);
						db.handoffs.updatePendingHandoffsForTask(item.id, "expired");
					}
					break;
			}
		})
		.immediate();

	if (kind === "task") {
		// Phase 3: derived (`codebase.db`) cleanup in its own transaction. A
		// canceled task keeps its vector row until here; that row is reachable
		// (the task still exists), so a crash between the phases is harmless.
		db.db
			.transaction(() => {
				for (const item of items) db.tasks.removeTaskVector(item.id);
			})
			.immediate();
	} else if (kind === "standard") {
		// Phase 3 for standards (FIX-011): the row is already committed in
		// phase 2, so this transaction touches only `codebase.db` and a crash
		// before it leaves an unreachable vector rather than a row with no
		// vector (which semantic search would miss until the startup backfill).
		db.db
			.transaction(() => {
				for (const item of items) db.standards.removeStandardVector(item.id);
			})
			.immediate();
	}

	// Progress (when requested): per item, then a final total call. Fired after
	// the entity mutation commits — the point at which the item is purged.
	if (onProgress) {
		for (let progress = 0; progress < total; progress++) {
			onProgress(progress, total);
		}
		onProgress(total, total);
	}

	// KG cleanup: best-effort, atomic (single transaction), once per batch.
	const observationItems: { text: string; repo: string }[] = [];
	for (const item of items) {
		if (item.title === undefined) continue; // phantom id — nothing to clean in KG
		observationItems.push({ text: observationText(kind, item.title), repo: item.repo ?? "" });
	}

	if (observationItems.length > 0) {
		try {
			db.knowledgeGraph.deleteObservationsAndOrphans(observationItems);
		} catch (kgError) {
			logger.warn(`[KG-Cleanup] Failed to clean up KG entities for deleted ${KIND_PLURALS[kind]}`, {
				error: String(kgError)
			});
		}
	}

	return items.length;
}
