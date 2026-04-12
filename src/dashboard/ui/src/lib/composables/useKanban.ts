import { writable, get } from "svelte/store";
import { onMount, onDestroy } from "svelte";
import { api } from "../api";
import { currentRepo, taskSearch } from "../stores";
import type { Task } from "../stores";
import { exportToJSON, exportToCSV } from "../utils";

export interface KanbanState {
	loadingCols: Set<string>;
	pagination: Record<string, { page: number; pageSize: number; hasMore: boolean }>;
	columnTasks: Record<string, Task[]>;
	draggedTask: Task | null;
	sourceCol: string | null;
	dragOverCol: string | null;
}

export const COLUMNS: { status: string; label: string; bg: string; border: string; icon: string; color: string }[] = [
	{
		status: "backlog",
		label: "Backlog",
		bg: "rgba(100,116,139,0.07)",
		border: "rgba(100,116,139,0.18)",
		icon: "archive",
		color: "#64748b"
	},
	{
		status: "pending",
		label: "To Do",
		bg: "rgba(14,165,233,0.06)",
		border: "rgba(14,165,233,0.18)",
		icon: "circle-dot",
		color: "#0ea5e9"
	},
	{
		status: "in_progress",
		label: "In Progress",
		bg: "rgba(168,85,247,0.07)",
		border: "rgba(168,85,247,0.18)",
		icon: "zap",
		color: "#a855f7"
	},
	{
		status: "completed",
		label: "Completed",
		bg: "rgba(16,185,129,0.06)",
		border: "rgba(16,185,129,0.18)",
		icon: "circle-check",
		color: "#10b981"
	}
];

export function createKanbanHandler() {
	const initialPagination: Record<string, { page: number; pageSize: number; hasMore: boolean }> = {};
	const initialColumnTasks: Record<string, Task[]> = {};

	COLUMNS.forEach((c) => {
		initialPagination[c.status] = { page: 1, pageSize: 20, hasMore: true };
		initialColumnTasks[c.status] = [];
	});

	const initialState: KanbanState = {
		loadingCols: new Set(),
		pagination: initialPagination,
		columnTasks: initialColumnTasks,
		draggedTask: null,
		sourceCol: null,
		dragOverCol: null
	};

	const { subscribe, update } = writable<KanbanState>(initialState);

	async function loadColumn(repo: string, status: string, search: string) {
		const state = get({ subscribe });
		if (state.loadingCols.has(status)) return;

		update((s) => {
			const next = new Set(s.loadingCols);
			next.add(status);
			return { ...s, loadingCols: next };
		});

		const p = state.pagination[status];
		try {
			const data = await api.tasks({
				repo,
				status,
				search,
				page: p.page,
				pageSize: p.pageSize
			});

			update((s) => {
				const nextTasks = p.page === 1 ? data.tasks || [] : [...(s.columnTasks[status] || []), ...(data.tasks || [])];

				return {
					...s,
					columnTasks: { ...s.columnTasks, [status]: nextTasks },
					pagination: {
						...s.pagination,
						[status]: { ...p, hasMore: (data.tasks?.length || 0) >= p.pageSize }
					}
				};
			});
		} catch (e) {
			console.error(`Failed to load ${status}:`, e);
		} finally {
			update((s) => {
				const next = new Set(s.loadingCols);
				next.delete(status);
				return { ...s, loadingCols: next };
			});
		}
	}

	async function loadTasks(repo: string, search: string) {
		if (!repo) return;

		update((s) => {
			const nextPagination = { ...s.pagination };
			const nextColumnTasks = { ...s.columnTasks };
			COLUMNS.forEach((c) => {
				nextPagination[c.status] = { page: 1, pageSize: 20, hasMore: true };
				nextColumnTasks[c.status] = [];
			});
			return { ...s, pagination: nextPagination, columnTasks: nextColumnTasks };
		});

		await Promise.all(COLUMNS.map((c) => loadColumn(repo, c.status, search)));
	}

	async function loadMore(status: string) {
		const repo = get(currentRepo);
		const search = get(taskSearch);
		if (!repo) return;

		update((s) => ({
			...s,
			pagination: {
				...s.pagination,
				[status]: { ...s.pagination[status], page: s.pagination[status].page + 1 }
			}
		}));

		await loadColumn(repo, status, search);
	}

	function handleDragStart(e: DragEvent, task: Task, colStatus: string) {
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = "move";
			e.dataTransfer.setData("text/plain", task.id);
		}
		update((s) => ({ ...s, draggedTask: task, sourceCol: colStatus }));
	}

	function handleDragOver(e: DragEvent, colStatus: string) {
		e.preventDefault();
		if (e.dataTransfer) {
			e.dataTransfer.dropEffect = "move";
		}
		const state = get({ subscribe });
		if (!state.draggedTask || state.sourceCol === colStatus) return;
		update((s) => ({ ...s, dragOverCol: colStatus }));
	}

	function handleDragLeave(colStatus: string) {
		update((s) => {
			if (s.dragOverCol === colStatus) return { ...s, dragOverCol: null };
			return s;
		});
	}

	async function handleDrop(targetCol: string) {
		const repo = get(currentRepo);
		const search = get(taskSearch);
		const state = get({ subscribe });
		const { draggedTask, sourceCol } = state;

		update((s) => ({ ...s, dragOverCol: null, draggedTask: null, sourceCol: null }));

		if (!draggedTask || !sourceCol || sourceCol === targetCol) return;

		// Optimistic update
		update((s) => {
			const nextCols = { ...s.columnTasks };
			nextCols[sourceCol] = nextCols[sourceCol].filter((t) => t.id !== draggedTask.id);
			const updatedTask = { ...draggedTask, status: targetCol };
			nextCols[targetCol] = [updatedTask, ...(nextCols[targetCol] || [])];
			return { ...s, columnTasks: nextCols };
		});

		try {
			await api.updateTask(draggedTask.id, { status: targetCol });
		} catch (err) {
			console.error("Failed to move task:", err);
			if (repo) loadTasks(repo, search);
		}
	}

	async function handleExport(format: "json" | "csv") {
		const repo = get(currentRepo);
		if (!repo) return;
		try {
			const data = await api.export(repo);
			const filename = `${repo.replace(/\//g, "_")}_tasks_export`;
			if (format === "json") {
				exportToJSON(data.tasks || [], filename + ".json");
			} else {
				exportToCSV(data.tasks || [], filename + ".csv");
			}
		} catch (err: any) {
			alert("Export failed: " + err.message);
		}
	}

	// Centralized Initialization & Subscription
	onMount(() => {
		let initializing = true;
		const unsubRepo = currentRepo.subscribe((repo) => {
			const search = get(taskSearch);
			if (repo) loadTasks(repo, search);
		});

		// Instead of using input event inside html, subscribe to search directly
		let searchTimeout: any;
		const unsubSearch = taskSearch.subscribe((search) => {
			if (initializing) return;
			const r = get(currentRepo);
			if (r) {
				clearTimeout(searchTimeout);
				searchTimeout = setTimeout(() => {
					loadTasks(r, search);
				}, 150);
			}
		});

		initializing = false;

		return () => {
			unsubRepo();
			unsubSearch();
			clearTimeout(searchTimeout);
		};
	});

	return {
		subscribe,
		loadTasks,
		loadMore,
		handleDragStart,
		handleDragOver,
		handleDragLeave,
		handleDrop,
		handleExport
	};
}
