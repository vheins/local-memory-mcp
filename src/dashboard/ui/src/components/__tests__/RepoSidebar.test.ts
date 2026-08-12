// @vitest-environment jsdom
// RepoSidebar navigation surface tests (TASK-435 — regression guard for the
// TASK-425 nav restructure).
//
// The left sidebar nav is the app's ONLY navigation surface: NAV_ITEMS
// (lib/navigation.ts) drives every view gate in App.svelte. These tests pin
// down the TASK-405/TASK-425 a11y contract — exactly 11 role=tab items, a
// single tablist with the accessible name "Dashboard sections", aria-selected
// synchronized with the `activeTab` store, and onTabSelect emission — so a
// future regression (dropped item, broken gate, duplicated tablist) fails CI
// instead of passing silently.
//
// Store strategy: the REAL stores module is used (no store mock) so
// `activeTab.set()` exercises the actual subscription → re-render path.
// stores.ts is side-effect-free at import time (initPersistedState is opt-in).
// useRepoSidebar / RepoItem / Icon are mocked per the App.test.ts pattern —
// nav semantics (role/aria-selected/label) are what we assert, not icon or
// repo-list plumbing.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, setup, cleanup } from "@testing-library/svelte";

import RepoSidebar from "../RepoSidebar.svelte";
import { NAV_ITEMS } from "../../lib/navigation";
import {
	activeTab,
	isRepoSidebarCollapsed,
	availableRepos,
	currentRepo,
	pinnedRepos,
	repoSearchQuery
} from "../../lib/stores";

// ─── Mocks (App.test.ts pattern) ────────────────────────────────────────────
// Nav handler: collapse/select/pin plumbing is not under test here.
vi.mock("../../lib/composables/useRepoSidebar", () => ({
	createRepoSidebarHandler: () => ({
		toggleCollapse: vi.fn(),
		selectRepo: vi.fn(),
		togglePin: vi.fn(),
		onDragStart: vi.fn(),
		onDragOver: vi.fn(),
		onDrop: vi.fn(),
		onDragEnd: vi.fn(),
		getRepoInitials: (repo: string) => repo.slice(0, 2)
	})
}));
// Sub-components: heavy repo list + SVG icons are stubbed; the assertions
// below probe the nav semantics only.
vi.mock("../../lib/Icon.svelte", () => ({ default: () => ({}) }));
vi.mock("../RepoItem.svelte", () => ({ default: () => ({}) }));

// ─── Independent contract (NOT derived from NAV_ITEMS, so a removed/re-ordered
//     item fails the test instead of making it tautological) ────────────────
const EXPECTED_NAV = [
	{ id: "arena", label: "Arena" },
	{ id: "dashboard", label: "Dashboard" },
	{ id: "activity", label: "Activity" },
	{ id: "memories", label: "Memories" },
	{ id: "tasks", label: "Tasks" },
	{ id: "codebase", label: "Codebase" },
	{ id: "handoffs", label: "Handoffs" },
	{ id: "queue", label: "Queue" },
	{ id: "knowledge-graph", label: "Knowledge Graph" },
	{ id: "standards", label: "Standards" },
	{ id: "reference", label: "Reference" }
] as const;

function renderSidebar(onTabSelect = vi.fn(), onRepoSelect = vi.fn()) {
	return render(RepoSidebar, { props: { onRepoSelect, onTabSelect } });
}

// Reset module-level store state between tests (real stores persist across
// tests in the same file) and (re)configure the testing-library env.
beforeEach(async () => {
	activeTab.set("arena");
	isRepoSidebarCollapsed.set(false);
	availableRepos.set([]);
	currentRepo.set(null);
	pinnedRepos.set([]);
	repoSearchQuery.set("");
	vi.clearAllMocks();
	await setup();
});

afterEach(() => {
	cleanup();
});

// ─── NAV_ITEMS model (TASK-425 contract) ────────────────────────────────────
describe("NAV_ITEMS nav model (TASK-425 contract)", () => {
	it("exposes exactly the 11 dashboard views with unique ids and correct labels", () => {
		expect(NAV_ITEMS).toHaveLength(EXPECTED_NAV.length);
		expect(NAV_ITEMS.map((n) => n.id)).toEqual(EXPECTED_NAV.map((n) => n.id));
		expect(NAV_ITEMS.map((n) => n.label)).toEqual(EXPECTED_NAV.map((n) => n.label));
		expect(new Set(NAV_ITEMS.map((n) => n.id)).size).toBe(NAV_ITEMS.length);
	});
});

// ─── RepoSidebar navigation rendering (TASK-435) ────────────────────────────
describe("RepoSidebar navigation (TASK-435)", () => {
	it("renders exactly ONE tablist with the accessible name 'Dashboard sections' (no mobile/desktop duplicate)", () => {
		renderSidebar();
		const tablists = screen.getAllByRole("tablist");
		expect(tablists).toHaveLength(1);
		expect(tablists[0].getAttribute("aria-label")).toBe("Dashboard sections");
	});

	it("renders all 11 nav items as role=tab with id nav-{id} and the correct label", () => {
		renderSidebar();
		for (const item of EXPECTED_NAV) {
			const tab = screen.getByRole("tab", { name: item.label });
			expect(tab.id).toBe(`nav-${item.id}`);
		}
		expect(screen.getAllByRole("tab")).toHaveLength(EXPECTED_NAV.length);
	});

	it("marks exactly one tab aria-selected=true (the active one); all others false", () => {
		activeTab.set("queue");
		renderSidebar();

		const queue = screen.getByRole("tab", { name: "Queue" });
		expect(queue.getAttribute("aria-selected")).toBe("true");

		// Negative: a non-active item must NOT be selected.
		const dashboard = screen.getByRole("tab", { name: "Dashboard" });
		expect(dashboard.getAttribute("aria-selected")).toBe("false");

		const selected = screen.getAllByRole("tab").filter((t) => t.getAttribute("aria-selected") === "true");
		expect(selected).toHaveLength(1);
		expect(selected[0].id).toBe("nav-queue");
	});

	it("syncs aria-selected when the activeTab store changes (re-render path)", async () => {
		renderSidebar();
		expect(screen.getByRole("tab", { name: "Arena" }).getAttribute("aria-selected")).toBe("true");

		// Store update → subscription fires → DOM re-renders with the new selection.
		activeTab.set("standards");
		await waitFor(() => {
			expect(screen.getByRole("tab", { name: "Standards" }).getAttribute("aria-selected")).toBe("true");
			expect(screen.getByRole("tab", { name: "Arena" }).getAttribute("aria-selected")).toBe("false");
		});
		const selected = screen.getAllByRole("tab").filter((t) => t.getAttribute("aria-selected") === "true");
		expect(selected).toHaveLength(1);
		expect(selected[0].id).toBe("nav-standards");
	});

	it("emits onTabSelect with the clicked tab id (id, not label)", async () => {
		const onTabSelect = vi.fn();
		renderSidebar(onTabSelect);

		await fireEvent.click(screen.getByRole("tab", { name: "Memories" }));
		await fireEvent.click(screen.getByRole("tab", { name: "Tasks" }));

		expect(onTabSelect).toHaveBeenCalledTimes(2);
		expect(onTabSelect).toHaveBeenNthCalledWith(1, "memories");
		expect(onTabSelect).toHaveBeenNthCalledWith(2, "tasks");
	});

	it("collapsed state still renders all 11 tabs with title tooltips and no labels", () => {
		isRepoSidebarCollapsed.set(true);
		const { container } = renderSidebar();

		const tabs = container.querySelectorAll('[role="tab"]');
		expect(tabs).toHaveLength(EXPECTED_NAV.length);
		tabs.forEach((tab, i) => {
			expect(tab.id).toBe(`nav-${EXPECTED_NAV[i].id}`);
			expect(tab.getAttribute("title")).toBe(EXPECTED_NAV[i].label);
		});
		// Negative: labels are hidden in collapsed mode (icon-only tooltips).
		expect(container.querySelectorAll(".nav-label")).toHaveLength(0);
	});
});
