import { SQLiteStore } from "../storage/sqlite";
import { createMcpResponse } from "../utils/mcp-response";
import { logger } from "../utils/logger";
import { resolveEntityRef } from "../utils/entity-ref";
import { observationText } from "./kg-archivist";
import { TaskDeleteSchema } from "./schemas";

export async function handleTaskDelete(args: unknown, storage: SQLiteStore) {
	const validated = TaskDeleteSchema.parse(args);
	const { owner, repo, id, code, task_code, ids, codes, task_codes } = validated;

	// Resolve all identifiers to UUIDs
	const resolvedIds: string[] = [];

	// Helper: resolve a single identifier (UUID or task_code) to UUID
	function resolveIdentifier(identifier: string): string {
		return resolveEntityRef(storage, "task", identifier, owner, repo) ?? "";
	}

	// Single identifier: id (UUID or task_code)
	if (id) {
		resolvedIds.push(resolveIdentifier(id));
	}

	// Single code: code (alias for task_code)
	if (code) {
		resolvedIds.push(resolveIdentifier(code));
	}

	// Single task_code
	if (task_code) {
		resolvedIds.push(resolveIdentifier(task_code));
	}

	// Bulk identifiers: ids (array of UUIDs or task_codes)
	if (ids) {
		for (const item of ids) {
			resolvedIds.push(resolveIdentifier(item));
		}
	}

	// Bulk codes: codes (canonical array of string codes)
	if (codes) {
		for (const c of codes) {
			resolvedIds.push(resolveIdentifier(c));
		}
	}

	// Bulk codes: task_codes (backward compat alias for codes)
	if (task_codes) {
		for (const tc of task_codes) {
			resolvedIds.push(resolveIdentifier(tc));
		}
	}

	if (resolvedIds.length === 0) {
		throw new Error(
			"At least one of 'id', 'code', 'task_code', 'ids', 'codes', or 'task_codes' must be provided for deletion"
		);
	}

	// Fetch tasks to verify existence and collect codes for response
	const tasksToDelete = storage.tasks.getTasksByIds(resolvedIds);
	const deletedCodes = tasksToDelete.map((t) => t.task_code);
	const taskMap = new Map(tasksToDelete.map((t) => [t.id, t]));

	// Soft-delete: cancel tasks, remove vectors, release claims, expire handoffs
	// and purge pending embedding-queue jobs. All DB mutations run in ONE
	// transaction — a mid-loop failure rolls back the whole batch (no partial
	// state; a stale queue_jobs row could otherwise re-embed the vector and
	// re-run KG extraction for a canceled task). KG cleanup stays best-effort
	// below.
	const now = new Date().toISOString();
	const observationTexts: { text: string; repo: string }[] = [];

	storage.db
		.transaction(() => {
			for (const targetId of resolvedIds) {
				storage.tasks.updateTask(targetId, {
					status: "canceled",
					canceled_at: now
				});
				// Defense-in-depth (TASK-065 / MEM-473): detach children so no
				// future writer (incl. stale enqueued worker snapshots) re-derives
				// KG relations from this canceled, orphan-swept document.
				storage.tasks.clearChildrenParent(targetId);
				storage.tasks.removeTaskVector(targetId);
				storage.handoffs.releaseClaimsForTask(targetId);
				storage.handoffs.updatePendingHandoffsForTask(targetId, "expired");

				const taskEntry = taskMap.get(targetId);
				if (taskEntry) {
					observationTexts.push({ text: observationText("task", taskEntry.title), repo });
				}
			}

			if (resolvedIds.length > 0) {
				const placeholders = resolvedIds.map(() => "?").join(",");
				storage.db
					.prepare(`DELETE FROM queue_jobs WHERE entity_kind = ? AND entity_id IN (${placeholders})`)
					.run("task", ...resolvedIds);
			}
		})
		.immediate();

	// KG cleanup: best-effort, atomic (single transaction), once per batch —
	// orphans checked via observations UNION relations so relation-referenced
	// entities are KEPT (REFACTOR-KG-006 / TASK-004); observation deletes and
	// the orphan sweep are scoped to the deleted repo(s) (TASK-043) so a
	// repo-A delete never removes repo-B observations/entities.
	try {
		storage.knowledgeGraph.deleteObservationsAndOrphans(observationTexts);
	} catch (kgError) {
		logger.warn("[KG-Cleanup] Failed to clean up KG entities for deleted tasks", {
			error: String(kgError)
		});
	}

	return createMcpResponse(
		{
			success: true,
			id: id || undefined,
			code: code || undefined,
			ids: ids || undefined,
			codes: codes || undefined,
			task_code: task_code || undefined,
			task_codes: task_codes || undefined,
			repo,
			canceledCount: resolvedIds.length,
			canceledCodes: deletedCodes
		},
		`Deleted ${resolvedIds.length} ${resolvedIds.length === 1 ? "task" : "tasks"} from "${repo}"${deletedCodes.length > 0 ? `: ${deletedCodes.join(", ")}` : ""}.`,
		{ includeJson: validated.json }
	);
}
