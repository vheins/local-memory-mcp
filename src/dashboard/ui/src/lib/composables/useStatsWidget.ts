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
	const taskStats = derived(dashboardStats, ($stats) => {
		if (!$stats?.taskStats || !Array.isArray($stats.taskStats)) return null;
		
		const stats: Record<string, number> = {
			total: 0,
			backlog: 0,
			pending: 0,
			in_progress: 0,
			completed: 0,
			blocked: 0,
			canceled: 0
		};

		($stats.taskStats as any[]).forEach(item => {
			if (item.status && typeof item.count === 'number') {
				stats[item.status] = item.count;
				stats.total += item.count;
			}
		});

		return stats;
	});

	const summaryItems = derived([dashboardStats, taskStats], ([$stats, $taskStats]) => {
		const memoryTotal = ($stats?.memoryStats as any[] | undefined)?.reduce((acc, curr) => acc + (curr.count || 0), 0) ?? 0;
		return [
			{
				label: "Total Memories",
				val: memoryTotal || "—",
				icon: "layers",
				color: "#0ea5e9",
				glow: "rgba(14,165,233,0.12)"
			},
			{
				label: "Active Tasks",
				val: ($taskStats?.in_progress ?? 0) + ($taskStats?.pending ?? 0) || "—",
				icon: "zap",
				color: "#a855f7",
				glow: "rgba(168,85,247,0.12)"
			},
			{
				label: "Completed",
				val: $taskStats?.completed ?? "—",
				icon: "circle-check",
				color: "#10b981",
				glow: "rgba(16,185,129,0.12)"
			},
			{
				label: "Backlog",
				val: $taskStats?.backlog ?? "—",
				icon: "inbox",
				color: "#64748b",
				glow: "rgba(100,116,139,0.12)"
			}
		];
	});

	const byTypeStats = derived(dashboardStats, ($stats) => {
		if (!$stats?.memoryStats || !Array.isArray($stats.memoryStats)) return [];
		return ($stats.memoryStats as any[])
			.filter((item) => item.count > 0)
			.map((item) => ({
				type: item.type,
				count: item.count,
				color: typeColors[item.type] || "#64748b",
				label: typeLabels[item.type] || item.type
			}));
	});

	return {
		summaryItems,
		byTypeStats,
		taskStats
	};
}
