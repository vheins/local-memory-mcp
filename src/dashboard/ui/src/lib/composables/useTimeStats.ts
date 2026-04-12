import { writable, derived } from "svelte/store";
import { taskTimeStats } from "../stores";

export type Period = "daily" | "weekly" | "monthly" | "overall";

export const TIME_PERIODS: { key: Period; label: string }[] = [
	{ key: "daily", label: "Today" },
	{ key: "weekly", label: "Week" },
	{ key: "monthly", label: "Month" },
	{ key: "overall", label: "All" }
];

export function createTimeStatsHandler() {
	const activePeriod = writable<Period>("daily");

	const periodData = derived([taskTimeStats, activePeriod], ([$stats, $period]) => $stats?.[$period]);

	const history = derived(
		periodData,
		($data) => ($data?.history || []) as Array<{ label: string; created: number; completed: number }>
	);

	const maxVal = derived(history, ($history) =>
		Math.max(1, ...$history.map((h) => Math.max(h.created || 0, h.completed || 0)))
	);

	return {
		activePeriod,
		periodData,
		history,
		maxVal,
		setActivePeriod: (p: Period) => activePeriod.set(p)
	};
}
