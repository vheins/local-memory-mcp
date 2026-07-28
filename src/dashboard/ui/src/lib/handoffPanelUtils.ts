import type { Handoff } from "./interfaces";

/** Count pending handoffs */
export function countPending(handoffs: Handoff[]): number {
	return handoffs.filter((h) => h.status === "pending").length;
}

/** Count resolved handoffs */
export function countResolved(handoffs: Handoff[]): number {
	return handoffs.filter((h) => h.status !== "pending").length;
}

/** Build insight cards data */
export interface InsightCard {
	label: string;
	value: number;
}

export function buildInsightCards(handoffs: Handoff[], claimsCount: number): InsightCard[] {
	return [
		{ label: "Pending", value: countPending(handoffs) },
		{ label: "Resolved", value: countResolved(handoffs) },
		{ label: "Claims", value: claimsCount },
		{ label: "Total", value: handoffs.length }
	];
}

/** Transform an API row to a Handoff */
export function rowToHandoff(columns: string[], row: unknown[], repo: string): Handoff {
	const data = Object.fromEntries(columns.map((column, index) => [column, row[index]])) as Record<string, unknown>;
	return {
		id: String(data.id || ""),
		repo,
		from_agent: String(data.from_agent || ""),
		to_agent: data.to_agent ? String(data.to_agent) : null,
		task_id: data.task_id ? String(data.task_id) : null,
		task_code: data.task_code ? String(data.task_code) : null,
		summary: String(data.summary || ""),
		context:
			data.context && typeof data.context === "object" && !Array.isArray(data.context)
				? (data.context as Record<string, unknown>)
				: {},
		status: String(data.status || "pending") as Handoff["status"],
		created_at: String(data.created_at || ""),
		updated_at: String(data.updated_at || data.created_at || ""),
		expires_at: data.expires_at ? String(data.expires_at) : null
	};
}

/** Extract structured content from MCP tool response */
export function structured<T>(response: unknown): T | null {
	const result = response as import("./interfaces").McpToolResponse<T>;
	return result?.structuredContent ?? null;
}
