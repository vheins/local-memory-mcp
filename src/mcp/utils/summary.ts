/**
 * Shared grouped content-summary renderer used by the three search engines
 * (memory-read by type, task-read by status, standard-read by scope).
 *
 * Shape (identical across engines):
 *   **{groupLabel} ({count})**
 *   #{rank} {formatted line}
 *   ... +N more in this group
 *   <blank>
 *   {footer}
 */

export interface GroupedSummaryOptions<T> {
	/** Items to group and render (already paginated). */
	items: T[];
	/** Extracts the group key for an item. */
	getGroup: (item: T, index: number) => string;
	/** Comparator for group keys (enum order, custom scope order, ...). */
	groupOrder: (a: string, b: string) => number;
	/** Max visible lines per group — a constant or a per-group-key function. */
	cap?: number | ((groupKey: string) => number);
	/** Optional label transform for the group header (defaults to raw key). */
	formatGroupLabel?: (groupKey: string) => string;
	/** Formats one visible item line (receives the global 1-based rank). */
	formatLine: (item: T, rank: number) => string;
	/** Trailing hint appended after the last group. */
	footer: string;
}

export function renderGroupedSummary<T>(options: GroupedSummaryOptions<T>): string {
	const { items, getGroup, groupOrder, cap = 5, formatGroupLabel, formatLine, footer } = options;

	const grouped = new Map<string, { item: T; rank: number }[]>();
	items.forEach((item, i) => {
		const groupKey = getGroup(item, i);
		if (!grouped.has(groupKey)) grouped.set(groupKey, []);
		grouped.get(groupKey)!.push({ item, rank: i + 1 });
	});

	const sortedKeys = [...grouped.keys()].sort(groupOrder);
	const parts: string[] = [];

	for (const key of sortedKeys) {
		const entries = grouped.get(key)!;
		const groupCap = typeof cap === "function" ? cap(key) : cap;
		const visible = entries.slice(0, groupCap);
		const hidden = entries.length - visible.length;
		const label = formatGroupLabel ? formatGroupLabel(key) : key;
		parts.push(`**${label} (${entries.length})**`);
		for (const { item, rank } of visible) {
			parts.push(formatLine(item, rank));
		}
		if (hidden > 0) parts.push(`... +${hidden} more in this group`);
		parts.push("");
	}

	parts.push(footer);
	return parts.join("\n");
}

/**
 * Builds a comparator that orders group keys by their position in `order`,
 * with unknown keys sorted last (alphabetically among themselves). Shared by
 * the memory (type order) and task (status order) renderers.
 */
export function enumOrderComparator(order: string[]): (a: string, b: string) => number {
	return (a, b) => {
		const ai = order.indexOf(a);
		const bi = order.indexOf(b);
		if (ai === -1 && bi === -1) return a.localeCompare(b);
		if (ai === -1) return 1;
		if (bi === -1) return -1;
		return ai - bi;
	};
}
