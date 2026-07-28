import { ItemInfer } from "./types";

// ---------------------------------------------------------------------------
// Item mode inference (create vs update per item)
// ---------------------------------------------------------------------------

/**
 * Infers whether a bulk item is a CREATE or UPDATE.
 * - If the item has an `id` (UUID), it's always an UPDATE.
 * - If `code` is set but none of the required CREATE fields (phase, title, description) are present,
 *   it's an UPDATE (e.g., status-only update).
 * - Otherwise (has phase + title + description, with or without code), it's a CREATE.
 */
export function inferItemMode(item: Record<string, unknown>): ItemInfer {
	if (item.id) return "update";
	// If code is present but we lack the mandatory create fields → update
	if (item.code && !item.phase && !item.title && !item.description) return "update";
	return "create";
}
