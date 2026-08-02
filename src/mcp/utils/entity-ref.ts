import { SQLiteStore } from "../storage/sqlite";
import { UUID_REGEX } from "./uuid";

export type EntityRefKind = "memory" | "standard" | "task";

export interface ResolveEntityRefOptions {
	/**
	 * In-memory code → id map checked before the DB lookup. Used to resolve
	 * cross-references within the same batch (tasks referencing sibling tasks
	 * created in the same request).
	 */
	localMap?: Map<string, string>;
	/**
	 * Overrides the entity label used in the "not found" error message.
	 * Defaults to the kind's canonical label (Memory / Coding standard / Task).
	 */
	label?: string;
}

const ENTITY_LABELS: Record<EntityRefKind, string> = {
	memory: "Memory",
	standard: "Coding standard",
	task: "Task"
};

/**
 * Resolves a value that is either an entity UUID or an entity code to the
 * entity's id.
 *
 * - `null`/`undefined` → returns `null`
 * - a valid UUID → returns it as-is
 * - a code present in `opts.localMap` → returns the mapped id
 * - a code → looks up the entity by code (getByCode) and returns its id
 *
 * @throws If the value is not a UUID and does not resolve to an existing entity.
 */
export function resolveEntityRef(
	storage: SQLiteStore,
	kind: EntityRefKind,
	value: string | null | undefined,
	owner?: string,
	repo?: string,
	opts?: ResolveEntityRefOptions
): string | null {
	if (!value) return null;
	if (UUID_REGEX.test(value)) return value;
	if (opts?.localMap?.has(value)) return opts.localMap.get(value) ?? null;

	let id: string | null = null;
	switch (kind) {
		case "memory":
			id = storage.memories.getByCode(value, owner, repo)?.id ?? null;
			break;
		case "standard":
			id = storage.standards.getByCode(value, owner, repo)?.id ?? null;
			break;
		case "task":
			id = storage.tasks.getTaskByCode(owner ?? "", repo ?? "", value)?.id ?? null;
			break;
	}

	if (!id) throw new Error(`${opts?.label ?? ENTITY_LABELS[kind]} not found: ${value}`);
	return id;
}
