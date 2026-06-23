import { SQLiteStore } from "../storage/sqlite";

export type EntityType = "task" | "memory" | "standard";

const ENTITY_CONFIG: Record<EntityType, { prefix: string; table: string; column: string }> = {
	task: { prefix: "TASK", table: "tasks", column: "task_code" },
	memory: { prefix: "MEM", table: "memories", column: "code" },
	standard: { prefix: "STD", table: "coding_standards", column: "code" }
};

/**
 * Generates the next sequential code for an entity type within a repo.
 * Pattern: {PREFIX}-{NNN} (e.g., TASK-001, MEM-042, STD-999)
 * Scoped per-owner per-repo. The optional batchCodes Set accounts for codes
 * generated in the same batch but not yet persisted.
 */
export function generateNextCode(
	owner: string,
	repo: string,
	entityType: EntityType,
	storage: SQLiteStore,
	batchCodes?: Set<string>
): string {
	const config = ENTITY_CONFIG[entityType];
	const pattern = `${config.prefix}-%`;
	const offset = config.prefix.length + 2;

	const row = storage.db
		.prepare(
			`
    SELECT MAX(CAST(SUBSTR(${config.column}, ?) AS INTEGER)) as max_seq
    FROM ${config.table}
    WHERE owner = ? AND repo = ? AND ${config.column} LIKE ?
  `
		)
		.get(offset, owner, repo, pattern) as { max_seq: number | null };

	let nextSeq = (row?.max_seq ?? 0) + 1;

	if (batchCodes) {
		for (const code of batchCodes) {
			if (code.startsWith(`${config.prefix}-`)) {
				const num = parseInt(code.slice(config.prefix.length + 1), 10);
				if (!isNaN(num) && num >= nextSeq) {
					nextSeq = num + 1;
				}
			}
		}
	}

	return `${config.prefix}-${String(nextSeq).padStart(3, "0")}`;
}
