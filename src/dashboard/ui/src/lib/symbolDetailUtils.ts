export const KIND_ICONS: Record<string, string> = {
	function: "zap",
	class: "layers",
	interface: "terminal",
	type: "hash",
	enum: "list",
	variable: "database"
};

export const KIND_LABELS: Record<string, string> = {
	function: "Function",
	class: "Class",
	interface: "Interface",
	type: "Type",
	enum: "Enum",
	variable: "Variable"
};

/** Get the icon name for a symbol kind */
export function getKindIcon(kind: string): string {
	return KIND_ICONS[kind] || "code";
}

/** Get the display label for a symbol kind */
export function getKindLabel(kind: string): string {
	return KIND_LABELS[kind] || "Symbol";
}

/** Build a location text string from filePath, line, and column */
export function buildLocationText(filePath?: string, line?: number, column?: number): string | null {
	if (!filePath) return null;
	let loc = filePath;
	if (line != null) {
		loc += `:${line}`;
		if (column != null) {
			loc += `:${column}`;
		}
	}
	return loc;
}

/** Group TraceReference[] by filePath */
export function groupRefsByFile<T extends { filePath: string }>(refs: T[]): Map<string, T[]> {
	const map = new Map<string, T[]>();
	for (const ref of refs) {
		const existing = map.get(ref.filePath);
		if (existing) {
			existing.push(ref);
		} else {
			map.set(ref.filePath, [ref]);
		}
	}
	return map;
}
