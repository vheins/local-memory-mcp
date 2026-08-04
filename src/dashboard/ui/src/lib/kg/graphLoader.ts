import { get } from "svelte/store";
import type { Readable, Writable } from "svelte/store";
import { api } from "$lib/api";
import type { KGNode, KGEdge } from "$lib/interfaces";

/**
 * Graph-fetch orchestration for the knowledge-graph dashboard (TASK-196).
 *
 * Extracted from KGGraph.svelte so the component stays view + layout glue.
 * This module owns the client-side edge cache, the AbortController lifecycle,
 * and the page-navigation debounce, and exposes loadGraph/clearGraph/goToPage
 * plus unmount/repo-switch cleanup. The component wires its state in through
 * stores + callbacks. Nothing here touches the spatial layout (that lives in
 * KGForceLayout / kg-neural-renderer).
 */

export interface GraphLoaderDeps {
	/** Live repo — read fresh because the prop can change mid-flight. */
	repo: () => string;
	/** The repo currently loaded in the view (component guard). */
	getLoadedRepo: () => string;
	/** Persist the loaded-repo guard so the component's repo-change `$:` settles. */
	setLoadedRepo: (repo: string) => void;
	/** True once the force layout has been built for the current data. */
	hasLayout: () => boolean;
	setNodes: (nodes: KGNode[]) => void;
	setEdges: (edges: KGEdge[]) => void;
	setTruncated: (truncated: boolean) => void;
	setLoading: (loading: boolean) => void;
	setError: (message: string) => void;
	/** Reset layout, interaction, and drawer state owned by the component. */
	onClear: () => void;
	/** Rebuild the force layout from the freshly applied nodes/edges. */
	onDataReady: () => void;
	page: Writable<number>;
	pageSize: Writable<number>;
	totalItems: Writable<number>;
	totalPages: Readable<number>;
}

export interface GraphLoader {
	loadGraph(forceReload?: boolean, reuseEdges?: boolean): Promise<void>;
	clearGraph(): void;
	goToPage(page: number): void;
	/** Drop a pending debounced page navigation (repo change / unmount). */
	cancelPendingNavigation(): void;
	/** Abort in-flight requests and clear timers (component onDestroy). */
	dispose(): void;
}

export function createGraphLoader(deps: GraphLoaderDeps): GraphLoader {
	// ─── Graph fetch optimizations (TASK-190) ─────────────────────────────────
	// Edges are repo-wide (the graph endpoint returns up to 4000 edges
	// regardless of pageSize) and identical across node pages, so cache them
	// client-side per repo after the first fetch. On node page changes only the
	// paginated nodes are re-fetched; cached edges are reused while the repo is
	// unchanged. Refreshes and CRUD mutations force a full reload (which
	// invalidates the cache entry) so edits are never masked by stale edges.
	const edgeCache = new Map<string, { edges: KGEdge[]; truncated: boolean }>();

	// AbortController cancels in-flight kgGraph requests on rapid navigation so
	// only the most recent request for the current page wins.
	let kgAbortController: AbortController | null = null;

	// Debounce rapid page-button clicks so they don't each spawn a fetch.
	let pageNavTimer: ReturnType<typeof setTimeout> | null = null;
	const PAGE_NAV_DEBOUNCE_MS = 150;

	function clearGraph() {
		deps.setNodes([]);
		deps.setEdges([]);
		// Layout, interaction, and drawer state are all component-owned.
		deps.onClear();
		deps.setTruncated(false);
	}

	/**
	 * Loads the graph for the current repo.
	 *
	 * @param forceReload Full reload — refetch and update the cached edge set.
	 *   Used by the refresh button and after CRUD mutations (edges may have
	 *   changed, so the cache must be invalidated).
	 * @param reuseEdges Node page change — reuse the cached edge set for this
	 *   repo when available and only apply the freshly fetched (paginated)
	 *   nodes. Falls back to a full load when no cache entry exists.
	 */
	async function loadGraph(forceReload = false, reuseEdges = false) {
		const repo = deps.repo();
		if (!repo) return;
		const requestedRepo = repo;
		// Plain initial loads (no flags) are no-ops once the repo is loaded.
		if (!forceReload && !reuseEdges && deps.getLoadedRepo() === requestedRepo && deps.hasLayout()) return;

		// A force reload (refresh or CRUD mutation) must supersede any pending
		// debounced page navigation; otherwise the 150ms timer fires afterwards
		// and re-applies the stale cached edge set, masking the invalidation.
		if (forceReload && pageNavTimer) {
			clearTimeout(pageNavTimer);
			pageNavTimer = null;
		}

		// Cancel any in-flight request — rapid navigation only keeps the latest.
		kgAbortController?.abort();
		const controller = new AbortController();
		kgAbortController = controller;

		deps.setLoading(true);
		deps.setError("");
		clearGraph();
		try {
			const page = get(deps.page);
			const pageSize = get(deps.pageSize);
			// TASK-198: when reusing edges and this repo's entry is cached, skip the
			// edge payload entirely (includeEdges=false — server returns edges:[]).
			// The response's empty edge array must never overwrite the cache entry.
			// Cache miss OR forceReload → full fetch, cache (re)populated below.
			const cached = !forceReload && reuseEdges ? edgeCache.get(requestedRepo) : undefined;
			const data = await api.kgGraph(requestedRepo, {
				page,
				pageSize,
				signal: controller.signal,
				includeEdges: cached ? false : undefined
			});
			if (controller.signal.aborted) return; // superseded by a newer request
			if (deps.repo() !== requestedRepo) return; // stale-guard: repo switched mid-flight
			deps.setNodes(data.nodes || []);
			if (cached) {
				// Reuse the repo-wide cached edge set; only nodes differ per page.
				deps.setEdges(cached.edges);
				deps.setTruncated(cached.truncated);
			} else {
				deps.setEdges(data.edges || []);
				deps.setTruncated(data.truncated ?? false);
				// Only the current repo's entry is ever read (edgeCache.get is
				// keyed on requestedRepo, which is always the current repo), yet
				// KGGraph stays mounted for the whole KG tab session. Evict every
				// other repo's entry so repo switches don't leak ~4000-edge sets.
				for (const key of edgeCache.keys()) {
					if (key !== requestedRepo) edgeCache.delete(key);
				}
				edgeCache.set(requestedRepo, {
					edges: data.edges || [],
					truncated: data.truncated ?? false
				});
			}
			if (data.pagination) {
				deps.totalItems.set(data.pagination.totalItems);
			}
			deps.setLoadedRepo(requestedRepo);
			deps.onDataReady();
		} catch (e: unknown) {
			if (controller.signal.aborted) return; // aborted by navigation/unmount — no error UI
			if (deps.repo() !== requestedRepo) return;
			// Failed load clears the guard so a raw load for the same repo retries.
			deps.setLoadedRepo("");
			deps.setError(e instanceof Error ? e.message : "Failed to load graph");
		} finally {
			// Only the latest (non-superseded) request controls the loading state.
			if (kgAbortController === controller) {
				kgAbortController = null;
				if (deps.repo() === requestedRepo) {
					deps.setLoading(false);
				}
			}
		}
	}

	function goToPage(p: number) {
		const totalPages = get(deps.totalPages);
		if (p < 1 || p > totalPages) return;
		deps.page.set(p);
		// Debounce rapid page clicks: only the last navigation within the window
		// triggers a fetch (edges come from cache, so this is cheap anyway).
		if (pageNavTimer) clearTimeout(pageNavTimer);
		pageNavTimer = setTimeout(() => {
			pageNavTimer = null;
			loadGraph(false, true); // reuse cached edges — only nodes differ per page
		}, PAGE_NAV_DEBOUNCE_MS);
	}

	function cancelPendingNavigation() {
		if (pageNavTimer) {
			clearTimeout(pageNavTimer);
			pageNavTimer = null;
		}
	}

	function dispose() {
		// Cancel any in-flight kgGraph request and pending page navigation.
		kgAbortController?.abort();
		kgAbortController = null;
		cancelPendingNavigation();
	}

	return { loadGraph, clearGraph, goToPage, cancelPendingNavigation, dispose };
}
