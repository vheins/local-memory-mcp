import { writable, get } from "svelte/store";
import { api } from "../api";
import { availableRepos } from "../stores";
import type { Task, TaskClaim, Handoff, HandoffListResult, McpToolResponse } from "../interfaces";
import { buildArenaScene } from "../arena/arenaTransform";
import type { ArenaScene, ArenaLayoutConfig } from "../arena/arenaTypes";
import { eventCoordinator } from "../arena/arenaEventCoordinator";
import { arenaStateManager } from "../arena/arenaStateManager";
import { createVisibilityPoller } from "../arena/createVisibilityPoller";

export interface ArenaData {
	scene: ArenaScene | null;
	loading: boolean;
	error: string | null;
	lastUpdated: number;
	repoCount: number;
}

function structured<T>(response: unknown): T | null {
	const r = response as McpToolResponse<T>;
	return r?.structuredContent ?? null;
}

function rowToHandoff(columns: string[], row: unknown[], repo: string): Handoff {
	const d = Object.fromEntries(columns.map((c, i) => [c, row[i]])) as Record<string, unknown>;
	return {
		id: String(d.id ?? ""),
		repo,
		from_agent: String(d.from_agent ?? ""),
		to_agent: d.to_agent ? String(d.to_agent) : null,
		task_id: d.task_id ? String(d.task_id) : null,
		task_code: d.task_code ? String(d.task_code) : null,
		summary: String(d.summary ?? ""),
		context: (d.context as Record<string, unknown>) ?? {},
		status: String(d.status ?? "pending") as Handoff["status"],
		created_at: String(d.created_at ?? ""),
		updated_at: String(d.updated_at ?? d.created_at ?? ""),
		expires_at: d.expires_at ? String(d.expires_at) : null
	};
}

/** Polling interval when the tab is visible (ms). */
const POLL_INTERVAL_VISIBLE = 8_000;

export function createArenaHandler() {
	const store = writable<ArenaData>({
		scene: null,
		loading: false,
		error: null,
		lastUpdated: 0,
		repoCount: 0
	});

	let fetchInProgress = false;
	let layoutConfig: ArenaLayoutConfig | null = null;
	let unsubscribeRepos: (() => void) | null = null;
	const poller = createVisibilityPoller(fetchData, POLL_INTERVAL_VISIBLE);

	async function fetchData(): Promise<void> {
		if (fetchInProgress) return;
		if (!layoutConfig) return;

		const repos = get(availableRepos).map((r) => r.repo);
		if (repos.length === 0) {
			// Keep loading=true; repos will populate shortly from loadRepos().
			// Subscribe once so we re-trigger fetchData as soon as repos arrive.
			if (!unsubscribeRepos) {
				unsubscribeRepos = availableRepos.subscribe((list) => {
					if (list.length > 0) {
						unsubscribeRepos?.();
						unsubscribeRepos = null;
						void fetchData();
					}
				});
			}
			return;
		}
		// Clean up subscription once we have repos
		unsubscribeRepos?.();
		unsubscribeRepos = null;

		fetchInProgress = true;

		try {
			// Fetch from all repos in parallel — prioritise in_progress tasks
			const perRepo = await Promise.allSettled(
				repos.map((repo) =>
					Promise.allSettled([
						api.tasks({ repo, status: "in_progress", pageSize: 10 }),
						api.tasks({ repo, status: "pending", pageSize: 8 }),
						api.tasks({ repo, status: "blocked", pageSize: 4 }),
						api.coordinationClaims({ repo, active_only: true, pageSize: 50 }),
						api.callTool("handoff-list", { repo, status: "pending", limit: 10, structured: true })
					])
				)
			);

			const allTasks: Task[] = [];
			const allClaims: TaskClaim[] = [];
			const allHandoffs: Handoff[] = [];

			repos.forEach((repo, i) => {
				const repoResult = perRepo[i];
				if (repoResult.status === "rejected") return;
				const [ipRes, pendRes, blockedRes, claimsRes, handoffsRes] = repoResult.value;

				if (ipRes.status === "fulfilled") allTasks.push(...(ipRes.value.tasks ?? []));
				if (pendRes.status === "fulfilled") allTasks.push(...(pendRes.value.tasks ?? []));
				if (blockedRes.status === "fulfilled") allTasks.push(...(blockedRes.value.tasks ?? []));
				if (claimsRes.status === "fulfilled") allClaims.push(...(claimsRes.value.claims ?? []));

				if (handoffsRes.status === "fulfilled") {
					const result = structured<HandoffListResult>(handoffsRes.value);
					const cols = result?.handoffs?.columns ?? [];
					const rows = result?.handoffs?.rows ?? [];
					allHandoffs.push(...rows.map((row) => rowToHandoff(cols, row, repo)));
				}
			});

			// Deduplicate tasks by id
			const uniqueTasks = Array.from(new Map(allTasks.map((t) => [t.id, t])).values());

			const scene = buildArenaScene(uniqueTasks, allClaims, allHandoffs, get(store).scene, layoutConfig!);

			store.update((s) => ({
				...s,
				scene,
				loading: false,
				error: null,
				lastUpdated: Date.now(),
				repoCount: repos.length
			}));

			// Sync the state manager with the latest scene snapshot.
			// This primes the state manager for future event-driven updates
			// while the rendering continues to use the existing store.
			arenaStateManager.initFromScene(scene);
		} catch (e) {
			store.update((s) => ({
				...s,
				loading: false,
				error: e instanceof Error ? e.message : "Failed to load arena data"
			}));
		} finally {
			fetchInProgress = false;
		}
	}

	function setLayout(config: ArenaLayoutConfig): void {
		layoutConfig = config;
	}

	/** Expose the arenaStateManager's reactive ArenaState store. */
	function getStateStore() {
		return arenaStateManager.getStore();
	}

	function start(config: ArenaLayoutConfig): void {
		layoutConfig = config;
		store.update((s) => ({ ...s, loading: true }));

		// Register fetchData as the fallback fetch for the EventCoordinator.
		// When SSE is unavailable, the coordinator will poll via fetchData().
		eventCoordinator.setFallbackFetch(fetchData);

		// Trigger initial data load
		void fetchData();

		// Start visibility-gated periodic polling.
		// The poller is a no-op in SSR (no document).
		poller.start();
	}

	function stop(): void {
		poller.stop();
		unsubscribeRepos?.();
		unsubscribeRepos = null;
		eventCoordinator.destroy();
		fetchInProgress = false;
	}

	return {
		subscribe: store.subscribe,
		getStateStore,
		start,
		stop,
		setLayout,
		refresh: fetchData
	};
}
