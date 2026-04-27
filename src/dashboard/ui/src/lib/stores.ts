import { writable, derived } from "svelte/store";
import type { RepoMeta, Memory, Task, DashboardStats, RecentAction, TaskTimeStats, HealthData } from "./interfaces";
import type { Theme } from "./types";

// ─── Stores ─────────────────────────────────────────────────────────────────

// App state
export const theme = writable<Theme>("light");
export const activeTab = writable<string>("arena");
export const isLoading = writable<boolean>(false);

// Repo state
export const availableRepos = writable<RepoMeta[]>([]);
export const currentRepo = writable<string | null>(null);
export const isRepoSidebarCollapsed = writable<boolean>(false);
export const pinnedRepos = writable<string[]>([]);
export const repoSearchQuery = writable<string>("");

// Stats state
export const dashboardStats = writable<DashboardStats | null>(null);
export const globalDashboardStats = writable<DashboardStats | null>(null);
export const taskTimeStats = writable<TaskTimeStats | null>(null);
export const globalTaskTimeStats = writable<TaskTimeStats | null>(null);

// Memory state
export const memories = writable<Memory[]>([]);
export const memoriesTotal = writable<number>(0);
export const memoriesPage = writable<number>(1);
export const memoriesPageSize = writable<number>(25);
export const memoriesSearch = writable<string>("");
export const memoriesTypeFilter = writable<string>("");
export const memoriesImportanceMin = writable<number | null>(null);
export const memoriesImportanceMax = writable<number | null>(null);
export const memoriesSortBy = writable<string>("updated_at");
export const memoriesSortOrder = writable<string>("desc");
export const selectedMemoryIds = writable<Set<string>>(new Set());

// Task state
export const tasks = writable<Task[]>([]);
export const taskSearch = writable<string>("");
export const taskStatusFilter = writable<string>("");

// Recent actions
export const recentActions = writable<RecentAction[]>([]);
export const recentActionsTotalItems = writable<number>(0);
export const recentActionsPage = writable<number>(1);
export const recentActionsPageSize = writable<number>(25);

// Drawer state
export const drawerTaskId = writable<string | null>(null);

// Connection status
export const healthData = writable<HealthData | null>(null);

// Derived: ordered repos (pinned first)
export const orderedRepos = derived([availableRepos, pinnedRepos, repoSearchQuery], ([$repos, $pinned, $query]) => {
	const filtered = $query ? $repos.filter((r) => r.repo.toLowerCase().includes($query.toLowerCase())) : $repos;
	const pinned = filtered
		.filter((r) => $pinned.includes(r.repo))
		.sort((a, b) => $pinned.indexOf(a.repo) - $pinned.indexOf(b.repo));
	const unpinned = filtered.filter((r) => !$pinned.includes(r.repo));
	return { pinned, unpinned };
});

// Derived: total pages for memories
export const memoriesTotalPages = derived([memoriesTotal, memoriesPageSize], ([$total, $size]) =>
	Math.max(1, Math.ceil($total / $size))
);

// ─── Persistence helpers ─────────────────────────────────────────────────────

export function initPersistedState() {
	// Theme
	const savedTheme = (localStorage.getItem("theme") || "light") as Theme;
	theme.set(savedTheme);
	document.documentElement.classList.toggle("dark", savedTheme === "dark");

	// Sidebar collapsed
	isRepoSidebarCollapsed.set(localStorage.getItem("repoSidebarCollapsed") === "1");

	// Pinned repos
	try {
		const raw = localStorage.getItem("pinnedRepos");
		pinnedRepos.set(raw ? JSON.parse(raw) : []);
	} catch {
		pinnedRepos.set([]);
	}

	// Active tab
	const savedTab = localStorage.getItem("activeTab");
	if (savedTab) activeTab.set(savedTab);

	// Subscribe to persist changes
	theme.subscribe((t) => {
		localStorage.setItem("theme", t);
		document.documentElement.classList.toggle("dark", t === "dark");
	});

	isRepoSidebarCollapsed.subscribe((v) => {
		localStorage.setItem("repoSidebarCollapsed", v ? "1" : "0");
	});

	pinnedRepos.subscribe((v) => {
		localStorage.setItem("pinnedRepos", JSON.stringify(v));
	});

	activeTab.subscribe((v) => {
		localStorage.setItem("activeTab", v);
	});
}

// Re-export types for backward compatibility if needed, but better to update imports
export * from "./interfaces";
export * from "./types";
