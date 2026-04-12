import { derived } from "svelte/store";
import { dashboardStats } from "../stores";

const typeColors: Record<string, string> = {
	code_fact: "#a855f7",
	decision: "#3b82f6",
	mistake: "#ef4444",
	pattern: "#10b981",
	agent_handoff: "#f97316",
	agent_registered: "#84cc16",
	file_claim: "#06b6d4",
	task_archive: "#78716c"
};

const typeLabels: Record<string, string> = {
	code_fact: "Code Facts",
	decision: "Decisions",
	mistake: "Mistakes",
	pattern: "Patterns",
	agent_handoff: "Handoffs",
	agent_registered: "Registered",
	file_claim: "Claims",
	task_archive: "Archives"
};

export function createStatsHandler() {
	const summaryItems = derived(dashboardStats, ($stats) => {
		return [
			{
				label: "Total Memories",
				val: $stats?.total ?? "—",
				icon: "layers",
				color: "#0ea5e9",
				glow: "rgba(14,165,233,0.12)"
			},
			{
				label: "Avg Importance",
				val: $stats?.avgImportance ? Number($stats.avgImportance).toFixed(1) : "—",
				icon: "star",
				color: "#f59e0b",
				glow: "rgba(245,158,11,0.12)"
			},
			{
				label: "Total Hits",
				val: $stats?.totalHitCount ?? "—",
				icon: "mouse-pointer-2",
				color: "#10b981",
				glow: "rgba(16,185,129,0.12)"
			},
			{
				label: "Expiring Soon",
				val: $stats?.expiringSoon ?? "—",
				icon: "clock",
				color: "#ef4444",
				glow: "rgba(239,68,68,0.12)"
			}
		];
	});

	const byTypeStats = derived(dashboardStats, ($stats) => {
		if (!$stats?.byType) return [];
		return Object.entries($stats.byType as Record<string, number>)
			.filter(([, count]) => count > 0)
			.map(([type, count]) => ({
				type,
				count,
				color: typeColors[type] || "#64748b",
				label: typeLabels[type] || type
			}));
	});

	return {
		summaryItems,
		byTypeStats
	};
}
