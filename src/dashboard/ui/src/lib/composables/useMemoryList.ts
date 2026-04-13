import { get } from "svelte/store";
import {
	memories,
	memoriesTotal,
	memoriesPage,
	memoriesPageSize,
	memoriesSearch,
	memoriesTypeFilter,
	memoriesImportanceMin,
	memoriesImportanceMax,
	memoriesSortBy,
	memoriesSortOrder,
	selectedMemoryIds,
	currentRepo,
	memoriesTotalPages
} from "../stores";
import { api } from "../api";
import { debounce, exportToJSON, exportToCSV } from "../utils";
import type { Memory } from "../stores";

export function createMemoryHandler() {
	let loading = false;

	async function loadMemories(repo: string | null = get(currentRepo)) {
		if (!repo) {
			memories.set([]);
			return;
		}

		loading = true;
		try {
			const data = await api.memories({
				repo,
				type: get(memoriesTypeFilter) || undefined,
				search: get(memoriesSearch) || undefined,
				minImportance: get(memoriesImportanceMin) || undefined,
				maxImportance: get(memoriesImportanceMax) || undefined,
				sortBy: get(memoriesSortBy),
				sortOrder: get(memoriesSortOrder),
				page: get(memoriesPage),
				pageSize: get(memoriesPageSize)
			});
			memories.set(data.memories || []);
			memoriesTotal.set(data.pagination?.totalItems || 0);
		} catch (e) {
			console.error("Failed to load memories:", e);
		} finally {
			loading = false;
		}
	}

	const debouncedSearch = debounce(() => {
		memoriesPage.set(1);
		loadMemories();
	}, 300);

	function onSearchInput() {
		debouncedSearch();
	}

	function onFilterChange() {
		memoriesPage.set(1);
		loadMemories();
	}

	function goToPage(p: number) {
		const totalPages = get(memoriesTotalPages);
		if (p < 1 || p > totalPages) return;
		memoriesPage.set(p);
		loadMemories();
	}

	function toggleSort(col: string) {
		const currentSortBy = get(memoriesSortBy);
		if (currentSortBy === col) {
			memoriesSortOrder.update((o) => (o === "desc" ? "asc" : "desc"));
		} else {
			memoriesSortBy.set(col);
			memoriesSortOrder.set("desc");
		}
		loadMemories();
	}

	function toggleSelect(id: string) {
		selectedMemoryIds.update((ids) => {
			const next = new Set(ids);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	function toggleSelectAll() {
		selectedMemoryIds.update((ids) => {
			const mems = get(memories);
			if (ids.size === mems.length) return new Set();
			return new Set(mems.map((m) => m.id));
		});
	}

	async function handleExport(format: "json" | "csv", repo: string | null = get(currentRepo)) {
		if (!repo) return;
		try {
			const data = await api.export(repo);
			const filename = `${repo.replace("/", "_")}_export`;
			if (format === "json") {
				exportToJSON(data, filename + ".json");
			} else {
				exportToCSV((data.memories as unknown as Record<string, unknown>[]) || [], filename + ".csv");
			}
		} catch (e) {
			console.error("Export failed:", e);
		}
	}

	async function handleDeleteRow(mem: Memory, e?: MouseEvent) {
		if (e) e.stopPropagation();
		if (!confirm(`Delete memory "${mem.title}"?`)) return;
		try {
			await api.deleteMemory(mem.id);
			loadMemories();
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Unknown error";
			alert("Failed to delete: " + message);
		}
	}

	async function handleBulkDelete() {
		const ids = get(selectedMemoryIds);
		if (ids.size === 0) return;
		if (!confirm(`Are you sure you want to delete ${ids.size} memories?`)) return;
		try {
			await api.bulkMemoryAction("delete", Array.from(ids));
			selectedMemoryIds.set(new Set());
			loadMemories();
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Unknown error";
			alert("Failed to delete: " + message);
		}
	}

	async function handleBulkArchive() {
		const ids = get(selectedMemoryIds);
		if (ids.size === 0) return;
		try {
			await api.bulkMemoryAction("archive", Array.from(ids));
			selectedMemoryIds.set(new Set());
			loadMemories();
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Unknown error";
			alert("Failed to archive: " + message);
		}
	}

	return {
		get loading() {
			return loading;
		},
		loadMemories,
		onSearchInput,
		onFilterChange,
		goToPage,
		toggleSort,
		toggleSelect,
		toggleSelectAll,
		handleExport,
		handleDeleteRow,
		handleBulkDelete,
		handleBulkArchive
	};
}
