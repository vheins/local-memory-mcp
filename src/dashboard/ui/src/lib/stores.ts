import { writable, derived, get } from "svelte/store";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RepoMeta {
	repo: string;
	memory_count: number;
	task_count?: number;
	pending_count?: number;
	in_progress_count?: number;
	blocked_count?: number;
	backlog_count?: number;
	last_updated_at?: string;
}

export interface Memory {
	id: string;
	title: string;
	content: string;
	type: string;
	importance: number;
	scope: { repo: string };
	tags?: string[];
	created_at: string;
	updated_at: string;
	ttl_days?: number;
	hit_count?: number;
	last_accessed_at?: string;
	is_global?: boolean;
	status?: string;
	metadata?: Record<string, any>;
}

export interface Task {
	id: string;
	repo: string;
	task_code: string;
	phase: string;
	title: string;
	description: string;
	status: string;
	priority: number;
	agent?: string;
	role?: string;
	created_at: string;
	updated_at: string;
	finished_at?: string;
	in_progress_at?: string;
	est_tokens?: number;
	tags?: string[];
	metadata?: Record<string, any>;
	parent_id?: string;
	depends_on?: string;
	comments?: TaskComment[];
}

export interface TaskComment {
	id: string;
	task_id: string;
	repo: string;
	comment: string;
	agent?: string;
	role?: string;
	model?: string;
	previous_status?: string;
	next_status?: string;
	created_at: string;
}

export interface DashboardStats {
	total: number;
	avgImportance: string;
	totalHitCount: number;
	expiringSoon: number;
	byType: Record<string, number>;
	taskStats?: {
		total: number;
		backlog: number;
		todo: number;
		inProgress: number;
		completed: number;
		blocked: number;
	};
	todayCompleted?: number;
	todayAdded?: number;
	todayProcessed?: number;
	todayTokens?: number;
	todayAvgDuration?: number;
	timeSeries?: Record<string, any>;
	scatterData?: any[];
	topMemories?: any[];
}

export interface RecentAction {
	id: number;
	action: string;
	query?: string;
	response?: string;
	memory_id?: string;
	memory_title?: string;
	memory_type?: string;
	task_id?: string;
	task_title?: string;
	task_code?: string;
	result_count?: number;
	created_at: string;
	burstCount?: number;
}

export interface TaskTimePeriodStats {
	completed: number;
	added: number;
	tokens: number;
	avgDuration: number;
	history: Array<{ label: string; created: number; completed: number }>;
}

export interface TaskTimeStats {
	daily: TaskTimePeriodStats;
	weekly: TaskTimePeriodStats;
	monthly: TaskTimePeriodStats;
	overall: TaskTimePeriodStats;
}

// ─── Stores ─────────────────────────────────────────────────────────────────

// App state
export const theme = writable<"light" | "dark">("light");
export const activeTab = writable<string>("dashboard");
export const isLoading = writable<boolean>(false);

// Repo state
export const availableRepos = writable<RepoMeta[]>([]);
export const currentRepo = writable<string | null>(null);
export const isRepoSidebarCollapsed = writable<boolean>(false);
export const pinnedRepos = writable<string[]>([]);
export const repoSearchQuery = writable<string>("");

// Stats state
export const dashboardStats = writable<DashboardStats | null>(null);
export const taskTimeStats = writable<TaskTimeStats | null>(null);

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
export const recentActionsPage = writable<number>(1);
export const recentActionsPageSize = writable<number>(20);
export const recentActionsTotalItems = writable<number>(0);

// Drawer state
export const drawerMemoryId = writable<string | null>(null);
export const drawerTaskId = writable<string | null>(null);

// Connection status
export interface HealthData {
	connected: boolean;
	uptime: number;
	version: string;
	memoryCount: number;
	dbPath: string;
}
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
	const savedTheme = (localStorage.getItem("theme") || "light") as "light" | "dark";
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
