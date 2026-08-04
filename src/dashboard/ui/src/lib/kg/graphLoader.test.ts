import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { derived, get, writable } from "svelte/store";
import { createGraphLoader, type GraphLoaderDeps } from "./graphLoader";
import type { KGNode, KGEdge } from "$lib/interfaces";

// Mock the api module ($lib alias resolves via vitest.config.ts). The mock is
// hoisted above imports, so the shared fn must come from vi.hoisted.
const { kgGraphMock } = vi.hoisted(() => ({ kgGraphMock: vi.fn() }));

vi.mock("$lib/api", () => ({
	api: {
		kgGraph: kgGraphMock
	}
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

const nodeA: KGNode = { id: "n-a", name: "Node A", type: "concept" };
const nodeB: KGNode = { id: "n-b", name: "Node B", type: "concept" };
const nodeC: KGNode = { id: "n-c", name: "Node C", type: "concept" };
const edgeAB: KGEdge = { source: "n-a", target: "n-b", relation_type: "related" };
const edgeCD: KGEdge = { source: "n-c", target: "n-d", relation_type: "related" };

/** Server response shaped like GET /api/kg/graph (jsonApiRes envelope → data). */
function graphResponse(
	overrides: { nodes?: KGNode[]; edges?: KGEdge[]; truncated?: boolean; totalItems?: number } = {}
) {
	const totalItems = overrides.totalItems ?? 100;
	return {
		nodes: overrides.nodes ?? [nodeA],
		edges: overrides.edges ?? [edgeAB],
		truncated: overrides.truncated ?? false,
		pagination: { page: 1, pageSize: 25, totalItems, totalPages: Math.ceil(totalItems / 25) }
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

// ─── Deps harness ─────────────────────────────────────────────────────────────

interface TestHarness {
	deps: GraphLoaderDeps;
	setRepo: (repo: string) => void;
}

function createTestDeps(initialRepo = "repo-a"): TestHarness {
	let repo = initialRepo;
	let loadedRepo = "";
	const page = writable(1);
	const pageSize = writable(25);
	const totalItems = writable(0);
	const totalPages = derived([totalItems, pageSize], ([ti, ps]) => Math.ceil(ti / ps));
	const deps: GraphLoaderDeps = {
		repo: vi.fn(() => repo),
		getLoadedRepo: vi.fn(() => loadedRepo),
		setLoadedRepo: vi.fn((r: string) => {
			loadedRepo = r;
		}),
		hasLayout: vi.fn(() => false),
		setNodes: vi.fn(),
		setEdges: vi.fn(),
		setTruncated: vi.fn(),
		setLoading: vi.fn(),
		setError: vi.fn(),
		onClear: vi.fn(),
		onDataReady: vi.fn(),
		page,
		pageSize,
		totalItems,
		totalPages
	};
	return {
		deps,
		setRepo: (r) => {
			repo = r;
		}
	};
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("graphLoader", () => {
	beforeEach(() => {
		kgGraphMock.mockReset();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("first load (cache miss) fetches full edges and populates the cache", async () => {
		const { deps } = createTestDeps();
		const loader = createGraphLoader(deps);
		kgGraphMock.mockResolvedValueOnce(graphResponse());

		await loader.loadGraph();

		expect(kgGraphMock).toHaveBeenCalledTimes(1);
		const [repoArg, params] = kgGraphMock.mock.calls[0];
		expect(repoArg).toBe("repo-a");
		expect(params.includeEdges).toBeUndefined(); // full fetch — no opt-out
		expect(params.signal).toBeInstanceOf(AbortSignal);
		expect(deps.setNodes).toHaveBeenCalledWith([nodeA]);
		expect(deps.setEdges).toHaveBeenCalledWith([edgeAB]);
		expect(deps.setTruncated).toHaveBeenCalledWith(false);
		expect(deps.onDataReady).toHaveBeenCalledTimes(1);
		expect(deps.setLoadedRepo).toHaveBeenCalledWith("repo-a");
		expect(deps.setLoading).toHaveBeenLastCalledWith(false);
	});

	it("page nav after cache warm sends includeEdges:false, reuses cached edges, and never overwrites the cache with the server's empty edges", async () => {
		const { deps } = createTestDeps();
		const loader = createGraphLoader(deps);
		kgGraphMock.mockResolvedValueOnce(graphResponse());
		await loader.loadGraph(); // warm the repo-a cache

		// Page nav — the server honors includeEdges=false: nodes only, edges: [].
		kgGraphMock.mockClear();
		deps.page.set(2);
		kgGraphMock.mockResolvedValueOnce(graphResponse({ nodes: [nodeB], edges: [] }));
		await loader.loadGraph(false, true);

		expect(kgGraphMock).toHaveBeenCalledTimes(1);
		const [repoArg, params] = kgGraphMock.mock.calls[0];
		expect(repoArg).toBe("repo-a");
		expect(params.page).toBe(2);
		expect(params.includeEdges).toBe(false);
		// Cached edges served — NOT the response's empty array.
		expect(deps.setEdges).toHaveBeenLastCalledWith([edgeAB]);
		expect(deps.setTruncated).toHaveBeenLastCalledWith(false);
		expect(deps.setNodes).toHaveBeenLastCalledWith([nodeB]);

		// A third page nav still gets the cached edges — the [] from the
		// includeEdges=false response never replaced the cache entry.
		kgGraphMock.mockClear();
		deps.page.set(3);
		kgGraphMock.mockResolvedValueOnce(graphResponse({ nodes: [nodeA], edges: [] }));
		await loader.loadGraph(false, true);
		expect(kgGraphMock.mock.calls[0][1].includeEdges).toBe(false);
		expect(deps.setEdges).toHaveBeenLastCalledWith([edgeAB]);
	});

	it("forceReload sends a full request (no includeEdges:false) and refreshes the cache entry", async () => {
		const { deps } = createTestDeps();
		const loader = createGraphLoader(deps);
		kgGraphMock.mockResolvedValueOnce(graphResponse({ edges: [edgeAB] }));
		await loader.loadGraph(); // cache: edgeAB, truncated: false

		kgGraphMock.mockClear();
		kgGraphMock.mockResolvedValueOnce(graphResponse({ nodes: [nodeC], edges: [edgeCD], truncated: true }));
		await loader.loadGraph(true); // forceReload (refresh / CRUD mutation)

		expect(kgGraphMock).toHaveBeenCalledTimes(1);
		expect(kgGraphMock.mock.calls[0][1].includeEdges).toBeUndefined();
		expect(deps.setEdges).toHaveBeenLastCalledWith([edgeCD]);
		expect(deps.setTruncated).toHaveBeenLastCalledWith(true);

		// The refreshed entry is what subsequent reuse page-navs serve.
		kgGraphMock.mockClear();
		deps.page.set(2);
		kgGraphMock.mockResolvedValueOnce(graphResponse({ nodes: [nodeB], edges: [] }));
		await loader.loadGraph(false, true);
		expect(deps.setEdges).toHaveBeenLastCalledWith([edgeCD]);
		expect(deps.setTruncated).toHaveBeenLastCalledWith(true);
	});

	it("repo switch evicts the previous repo's cache entry", async () => {
		const { deps, setRepo } = createTestDeps();
		const loader = createGraphLoader(deps);
		kgGraphMock.mockResolvedValueOnce(graphResponse({ edges: [edgeAB] }));
		await loader.loadGraph(); // repo-a cached with edgeAB

		// Full load for repo-b evicts repo-a's entry.
		setRepo("repo-b");
		kgGraphMock.mockResolvedValueOnce(graphResponse({ nodes: [nodeC], edges: [edgeCD] }));
		await loader.loadGraph();
		expect(deps.setEdges).toHaveBeenLastCalledWith([edgeCD]);

		// Back to repo-a with reuseEdges: the entry was evicted → full fetch
		// (includeEdges undefined), proving repo-a's cache entry is gone.
		setRepo("repo-a");
		kgGraphMock.mockResolvedValueOnce(graphResponse({ edges: [edgeAB] }));
		await loader.loadGraph(false, true);
		expect(kgGraphMock).toHaveBeenCalledTimes(3);
		expect(kgGraphMock.mock.calls[2][1].includeEdges).toBeUndefined();
		expect(deps.setEdges).toHaveBeenLastCalledWith([edgeAB]);
	});

	it("a new loadGraph aborts the in-flight request; the superseded request never re-applies data or clears loading state", async () => {
		const { deps } = createTestDeps();
		const loader = createGraphLoader(deps);
		const first = deferred<ReturnType<typeof graphResponse>>();
		const second = deferred<ReturnType<typeof graphResponse>>();
		kgGraphMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

		const p1 = loader.loadGraph();
		const firstSignal = kgGraphMock.mock.calls[0][1].signal as AbortSignal;
		const p2 = loader.loadGraph();

		// The second load aborted the first request's controller.
		expect(firstSignal.aborted).toBe(true);
		expect((kgGraphMock.mock.calls[1][1].signal as AbortSignal).aborted).toBe(false);
		expect(deps.setLoading).toHaveBeenLastCalledWith(true);

		second.resolve(graphResponse({ nodes: [nodeB], edges: [edgeCD] }));
		await p2;
		expect(deps.setLoading).toHaveBeenLastCalledWith(false);

		// The superseded response resolves later: data must not be applied and
		// the loading state must stay false (the latest request owns it).
		first.resolve(graphResponse({ nodes: [nodeA], edges: [edgeAB] }));
		await p1;
		expect(deps.setNodes).not.toHaveBeenCalledWith([nodeA]);
		expect(deps.setEdges).not.toHaveBeenCalledWith([edgeAB]);
		expect(deps.setEdges).toHaveBeenLastCalledWith([edgeCD]);
		expect(deps.setLoading).toHaveBeenLastCalledWith(false);
	});

	it("goToPage debounces rapid clicks into a single fetch after 150ms", async () => {
		vi.useFakeTimers();
		const { deps } = createTestDeps();
		const loader = createGraphLoader(deps);
		kgGraphMock.mockResolvedValueOnce(graphResponse());
		await loader.loadGraph(); // warm cache; pagination → 4 total pages

		kgGraphMock.mockClear();
		kgGraphMock.mockResolvedValue(graphResponse({ nodes: [nodeB], edges: [] }));

		loader.goToPage(2);
		loader.goToPage(3);
		loader.goToPage(4);
		expect(kgGraphMock).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(150);

		expect(kgGraphMock).toHaveBeenCalledTimes(1);
		expect(get(deps.page)).toBe(4);
		expect(kgGraphMock.mock.calls[0][1].page).toBe(4);
		expect(kgGraphMock.mock.calls[0][1].includeEdges).toBe(false); // cache hit
		expect(deps.setEdges).toHaveBeenLastCalledWith([edgeAB]); // cached, not []
	});

	it("repo switch mid-flight discards the stale response", async () => {
		const { deps, setRepo } = createTestDeps();
		const loader = createGraphLoader(deps);
		const inFlight = deferred<ReturnType<typeof graphResponse>>();
		kgGraphMock.mockReturnValueOnce(inFlight.promise);

		const p = loader.loadGraph();
		setRepo("repo-b");
		inFlight.resolve(graphResponse({ nodes: [nodeA], edges: [edgeAB] }));
		await p;

		// Response discarded: no data applied, no ready/loaded callbacks.
		expect(deps.onDataReady).not.toHaveBeenCalled();
		expect(deps.setLoadedRepo).not.toHaveBeenCalled();
		expect(deps.setNodes).toHaveBeenCalledTimes(1); // clearGraph's [] only
		expect(deps.setNodes).toHaveBeenCalledWith([]);
		expect(deps.setEdges).toHaveBeenCalledTimes(1); // clearGraph's [] only
		expect(deps.setEdges).toHaveBeenCalledWith([]);
		// Actual contract: the stale request never clears loading — the newer
		// repo's load owns the loading state (see TASK-200 comment).
		expect(deps.setLoading).toHaveBeenCalledTimes(1);
		expect(deps.setLoading).toHaveBeenCalledWith(true);
	});
});
