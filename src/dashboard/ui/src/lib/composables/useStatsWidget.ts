import { derived, writable } from "svelte/store";
import { dashboardStats } from "../stores";
import { api } from "../api";
import type { Task } from "../stores";

// We'll use a local store to hold the recent active tasks fetched specifically for the leaderboard
const activeTasksStore = writable<Task[]>([]);

export function createStatsHandler() {
	const memoryStats = derived(dashboardStats, ($s) => {
		if (!$s) return null;
		return $s;
	});

	const taskStats = derived(dashboardStats, ($s) => {
		return $s?.taskStats ?? null;
	});

	// Derived summary for simple display
	const summaryItems = derived(dashboardStats, ($s) => {
		const items = [
			{ label: "Total", val: $s?.total ?? 0, icon: "brain", color: "#6366f1", glow: "rgba(99,102,241,0.12)" },
			{ label: "Facts", val: $s?.byType?.code_fact ?? 0, icon: "code", color: "#10b981", glow: "rgba(16,185,129,0.12)" },
			{ label: "Decisions", val: $s?.byType?.decision ?? 0, icon: "gavel", color: "#f59e0b", glow: "rgba(245,158,11,0.12)" },
			{ label: "Archive", val: $s?.byType?.task_archive ?? 0, icon: "archive", color: "#0ea5e9", glow: "rgba(14,165,233,0.12)" }
		];
		return items;
	});
 
	const byTypeStats = derived(dashboardStats, ($s) => {
		if (!$s?.byType) return [];
		return Object.entries($s.byType).map(([type, count]) => ({
			label: type.replace("_", " "),
			count: count,
			color: getGlowForType(type)
		}));
	});

	function getGlowForType(type: string) {
		const colors: Record<string, string> = {
			code_fact: "#10b981",
			decision: "#f59e0b",
			mistake: "#ef4444",
			pattern: "#a855f7",
			task_archive: "#0ea5e9"
		};
		return colors[type] || "#94a3b8";
	}

	// Derived store for top 5 active tasks (the source is our specific fetch)
	const activeTasks = derived(activeTasksStore, ($tasks) => $tasks);

	// Better strategy: create a helper that the component can trigger
	async function refreshActiveTasks(repo: string) {
		if (!repo) return;
		try {
			const data = await api.tasks({
				repo,
				status: "in_progress,pending",
				pageSize: 5
			});
			activeTasksStore.set(data.tasks || []);
		} catch (err) {
			console.error("Failed to load active tasks for widget:", err);
		}
	}

	return {
		memoryStats,
		taskStats,
		summaryItems,
		byTypeStats,
		activeTasks,
		refreshActiveTasks
	};
}
