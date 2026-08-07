import type { ArenaScene, ArenaLayoutConfig, ZoneRect, VisualAgent, VisualTask } from "./arenaTypes";
import { sectionsToZones } from "./arenaTransform-layout";
import { STATUS_TO_ZONE } from "./arenaTransform-utils";
import { getArenaLayoutManager } from "./arena-layout/ArenaLayoutManager";
import type { ArenaLayoutManager } from "./arena-layout/ArenaLayoutManager";
import type { SectionBounds, WorkflowEdge } from "./arena-layout/types";
import type { FilterState } from "./arenaEvents";

// ─── Re-export LOD constants & type ──────────────────────────────────────
export { LOD_FULL, LOD_NORMAL, LOD_SIMPLIFIED, LOD_AGGREGATE } from "./arena-renderer/utils";
export type { LODLevel } from "./arena-renderer/utils";
import {
	LOD_FULL,
	LOD_NORMAL,
	LOD_SIMPLIFIED,
	LOD_AGGREGATE,
	type LODLevel,
	type RenderCtx,
	type WanderState,
	pointInRect,
	matchesAgentFilter as utilMatchesAgentFilter,
	matchesTaskFilter as utilMatchesTaskFilter,
	isFilterActive as utilIsFilterActive,
	ZOOM_MIN,
	ZOOM_MAX,
	makeCtx
} from "./arena-renderer/utils";

import { drawGlobalFloor, drawRoom } from "./arena-renderer/scene";
import { drawCharacter, drawCharacterSimplified, drawCharacterAggregate } from "./arena-renderer/agents";
import { drawClaimLinks, drawHandoffBeams, drawWorkflowArrows } from "./arena-renderer/connections";
import type { ZoneStats } from "./arena-renderer/zones";
import { drawHandoffTrail, drawHandoffGroup } from "./arena-renderer/effects";
import { drawWorkstation, drawWorkstationSimplified, drawZoneAggregate } from "./arena-renderer/workstations";
import { updateAgents, updateHandoffAnim } from "./arena-renderer/physics";

// ═══════════════════════════════════════════════════════════════════════════
// ArenaRenderer — slim orchestrator (< 500 lines)
// ═══════════════════════════════════════════════════════════════════════════

export class ArenaRenderer {
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;
	private scene: ArenaScene | null = null;
	private layout: ArenaLayoutConfig | null = null;
	/** Shared layout manager — single source of truth for zone geometry. */
	private layoutManager: ArenaLayoutManager = getArenaLayoutManager();
	/** Cached sections (identity-compared to detect manager cache invalidation). */
	private cachedSections: SectionBounds[] | null = null;
	/** Manager sections mapped to the legacy ZoneRect shape (full rects). */
	private zones: ZoneRect[] = [];
	/** Section id → section color (for workstation monitor accents). */
	private zoneColorById = new Map<string, string>();
	/** Workflow pipeline edges (cached alongside zones — same invalidation). */
	private workflowEdges: WorkflowEdge[] = [];
	/** Cached per-section task/agent counts for the stats strip (see computeZoneStats). */
	private zoneStats = new Map<string, ZoneStats>();
	/** Sections identity the cached task-count portion was computed from. */
	private statsSections: SectionBounds[] | null = null;
	/** Scene reference the cached task-count portion was computed from. */
	private statsScene: ArenaScene | null = null;
	private isDark = false;
	private hoveredId: string | null = null;
	private selectedId: string | null = null;
	private selectedType: "agent" | "task" | "repository" | null = null;
	private rafId = 0;
	private ts = 0;
	private prevTs = 0;
	private wander = new Map<string, WanderState>();
	private activeFilter: FilterState = { repository: null, roles: [], priorities: [], statuses: [], search: "" };
	private currentLod: LODLevel = LOD_NORMAL;
	private reducedMotion = false;
	private reducedTransparency = false;
	private viewportZoom = 1.0;
	private viewportPanX = 0;
	private viewportPanY = 0;

	constructor(canvas: HTMLCanvasElement) {
		this.canvas = canvas;
		this.ctx = canvas.getContext("2d")!;
	}

	// ── Public API ───────────────────────────────────────────────────────
	update(scene: ArenaScene, layout: ArenaLayoutConfig, isDark: boolean) {
		this.scene = scene;
		this.layout = layout;
		this.layoutManager = layout.layoutManager ?? getArenaLayoutManager();
		this.isDark = isDark;
	}
	setHovered(id: string | null) {
		this.hoveredId = id;
	}
	setFilter(filter: FilterState): void {
		this.activeFilter = filter;
	}
	setReducedMotion(enabled: boolean): void {
		this.reducedMotion = enabled;
	}
	setReducedTransparency(enabled: boolean): void {
		this.reducedTransparency = enabled;
	}
	setSelected(id: string | null, type: "agent" | "task" | "repository" | null) {
		this.selectedId = id;
		this.selectedType = type;
	}
	getSelected() {
		return { id: this.selectedId, type: this.selectedType };
	}
	start() {
		this.rafId = requestAnimationFrame(this.loop);
	}
	stop() {
		cancelAnimationFrame(this.rafId);
	}

	setViewport(zoom: number, panX: number, panY: number): void {
		this.viewportZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
		this.viewportPanX = panX;
		this.viewportPanY = panY;
	}

	getViewportWorldBounds(): { x: number; y: number; w: number; h: number } {
		const cw = this.canvas.width,
			ch = this.canvas.height,
			z = this.viewportZoom || 1;
		return { x: -this.viewportPanX / z, y: -this.viewportPanY / z, w: cw / z, h: ch / z };
	}

	getZones(): ZoneRect[] {
		if (!this.layout) return [];
		return sectionsToZones(this.layoutManager.getSections());
	}

	getViewportInfo() {
		return {
			zoom: this.viewportZoom,
			panX: this.viewportPanX,
			panY: this.viewportPanY,
			canvasW: this.canvas.width,
			canvasH: this.canvas.height
		};
	}

	hitTestAgent(mx: number, my: number): string | null {
		if (!this.scene) return null;
		const world = this.screenToWorld(mx, my);
		for (const a of this.scene.agents.values()) {
			if (Math.hypot(world.x - a.x, world.y - a.y) <= 14) return a.id;
		}
		return null;
	}

	hitTestAgentWithPos(mx: number, my: number): { id: string; wx: number; wy: number } | null {
		if (!this.scene) return null;
		const world = this.screenToWorld(mx, my);
		for (const a of this.scene.agents.values()) {
			if (Math.hypot(world.x - a.x, world.y - a.y) <= 14) return { id: a.id, wx: a.x, wy: a.y };
		}
		for (const t of this.scene.tasks.values()) {
			if (Math.hypot(world.x - t.x, world.y - t.y) <= 20) return { id: t.id, wx: t.x, wy: t.y };
		}
		return null;
	}

	hitTestTask(mx: number, my: number): string | null {
		if (!this.scene) return null;
		const world = this.screenToWorld(mx, my);
		for (const t of this.scene.tasks.values()) {
			if (Math.hypot(world.x - t.x, world.y - t.y) <= 20) return t.id;
		}
		return null;
	}

	hitTest(mx: number, my: number): { type: "agent" | "task"; id: string } | null {
		const ah = this.hitTestAgent(mx, my);
		if (ah) return { type: "agent", id: ah };
		const th = this.hitTestTask(mx, my);
		if (th) return { type: "task", id: th };
		return null;
	}

	focusEntity(id: string, type: "agent" | "task"): void {
		if (!this.scene || !this.layout) return;
		const e = type === "agent" ? this.scene.agents.get(id) : this.scene.tasks.get(id);
		if (!e) return;
		this.setViewport(2.0, this.canvas.width / 2 - e.x * 2, this.canvas.height / 2 - e.y * 2);
	}

	// ── Private helpers ─────────────────────────────────────────────────
	private getViewportCullBounds() {
		const z = this.viewportZoom || 1,
			m = z < 0.5 ? 100 : 50;
		const l = -this.viewportPanX / z,
			t = -this.viewportPanY / z;
		return { left: l - m, top: t - m, right: l + this.canvas.width / z + m, bottom: t + this.canvas.height / z + m };
	}
	private isInViewport(x: number, y: number, b: { left: number; top: number; right: number; bottom: number }) {
		return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
	}
	private computeLOD(): LODLevel {
		const z = this.viewportZoom;
		return z >= 1 ? LOD_FULL : z >= 0.5 ? LOD_NORMAL : z >= 0.25 ? LOD_SIMPLIFIED : LOD_AGGREGATE;
	}
	private screenToWorld(sx: number, sy: number) {
		const z = this.viewportZoom || 1;
		return { x: (sx - this.viewportPanX) / z, y: (sy - this.viewportPanY) / z };
	}
	private rc(): RenderCtx {
		return makeCtx(
			this.ctx,
			this.canvas.width,
			this.canvas.height,
			this.isDark,
			this.ts,
			this.viewportZoom,
			this.viewportPanX,
			this.viewportPanY,
			this.currentLod,
			this.hoveredId,
			this.reducedMotion,
			this.reducedTransparency
		);
	}
	private mAF(a: VisualAgent) {
		return utilMatchesAgentFilter(a, this.activeFilter, this.scene?.tasks ?? null);
	}
	private mTF(t: VisualTask) {
		return utilMatchesTaskFilter(t, this.activeFilter, this.scene?.agents ?? null);
	}
	private iFA() {
		return utilIsFilterActive(this.activeFilter);
	}

	/**
	 * Refresh cached zones/colors when the manager's layout cache was
	 * invalidated (dims/occupancy changed). The manager returns the same
	 * sections array until its cache key changes — identity comparison makes
	 * this a single O(1) check per frame, with no per-frame zone math.
	 */
	private syncSections() {
		const sections = this.layoutManager.getSections();
		if (sections === this.cachedSections) return;
		this.cachedSections = sections;
		this.zones = sectionsToZones(sections);
		this.zoneColorById = new Map(sections.map((s) => [s.id, s.visual.color]));
		this.workflowEdges = this.layoutManager.getWorkflow();
	}

	/**
	 * Per-section task/agent counts for the header stats strip — geometric
	 * membership mirrors the aggregate overlay (both use the shared pointInRect
	 * helper). Task positions are baked at scene build, so the task-count
	 * portion is cached: it is recomputed only when the sections array identity
	 * (layout cache invalidation) or the scene reference (re-baked positions)
	 * changes. Agent counts refresh on every call because agents move per frame.
	 * Callers only invoke this when the strip will actually be drawn.
	 */
	private computeZoneStats(scene: ArenaScene): Map<string, ZoneStats> {
		const sections = this.layoutManager.getSections();
		if (sections !== this.statsSections || scene !== this.statsScene) {
			this.statsSections = sections;
			this.statsScene = scene;
			this.zoneStats.clear();
			for (const zr of this.zones) {
				let tasks = 0;
				for (const t of scene.tasks.values()) {
					if (pointInRect(t.x, t.y, zr)) tasks++;
				}
				this.zoneStats.set(zr.id, { tasks, agents: 0 });
			}
		}
		// Agents move every frame — refresh their counts whenever the strip draws.
		for (const zr of this.zones) {
			let agents = 0;
			for (const a of scene.agents.values()) {
				if (pointInRect(a.targetX, a.targetY, zr)) agents++;
			}
			const prev = this.zoneStats.get(zr.id) ?? { tasks: 0, agents: 0 };
			this.zoneStats.set(zr.id, { tasks: prev.tasks, agents });
		}
		return this.zoneStats;
	}

	/** Section accent color for a task's workstation (matches its room tint). */
	private zoneColorForTask(t: VisualTask): string {
		const zoneId = STATUS_TO_ZONE[t.status] ?? "";
		return this.zoneColorById.get(zoneId) ?? this.zones[0]?.color ?? "#64748b";
	}

	/**
	 * Section accent color for a claim link's target task — the same manager
	 * section tokens rooms use (status → zone → section color). Statuses with
	 * no registered zone (completed / canceled render no room) get the neutral
	 * fallback instead of borrowing another section's tint.
	 */
	private zoneColorForStatus(status: string): string {
		const zoneId = STATUS_TO_ZONE[status] ?? "";
		return this.zoneColorById.get(zoneId) ?? "#64748b";
	}

	// ── Loop ────────────────────────────────────────────────────────────
	private loop = (ts: number) => {
		const dt = Math.min((ts - this.prevTs) / 1000, 0.05);
		this.prevTs = ts;
		this.ts = ts;
		if (this.scene && this.layout) {
			// Wander bounds = the in_progress content area (where the desks
			// are), straight from the shared manager; falls back to the first
			// registered section when "in_progress" is missing.
			const sections = this.layoutManager.getSections();
			const inProgress = sections.find((s) => s.id === "in_progress") ?? sections[0];
			if (inProgress) {
				const c = inProgress.contentRect;
				const idleZone: ZoneRect = {
					id: inProgress.id,
					label: inProgress.label,
					x: c.x,
					y: c.y,
					w: c.w,
					h: c.h,
					color: inProgress.visual.color
				};
				updateAgents(this.scene.agents, this.wander, idleZone, dt, ts, this.reducedMotion, updateHandoffAnim);
			}
		}
		this.render();
		this.rafId = requestAnimationFrame(this.loop);
	};

	// ── Main render ──────────────────────────────────────────────────────
	private render() {
		const { canvas, ctx, scene, layout, isDark, viewportZoom: z, viewportPanX: px, viewportPanY: py } = this;
		if (!layout) return;
		this.syncSections();
		const zones = this.zones;
		this.currentLod = this.computeLOD();
		const lod = this.currentLod;
		const rc = this.rc();

		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.fillStyle = isDark ? "#0a0e1a" : "#dde3ed";
		ctx.fillRect(0, 0, canvas.width, canvas.height);

		ctx.save();
		ctx.translate(px, py);
		ctx.scale(z, z);

		drawGlobalFloor(rc);
		const sections = this.cachedSections ?? [];

		// Per-section task/agent counts for the header stats strip — computed
		// only when the strip will actually be drawn (FULL/NORMAL LOD; drawRoom
		// skips it at SIMPLIFIED/AGGREGATE). Task counts are cached inside
		// computeZoneStats (baked positions), so this is not a per-frame
		// recompute of layout or task geometry.
		const zoneStats = scene && lod < LOD_SIMPLIFIED ? this.computeZoneStats(scene) : null;

		for (let i = 0; i < sections.length; i++) {
			drawRoom(rc, zones[i], sections[i].visual, zoneStats?.get(zones[i].id), this.layoutManager);
		}

		// Workflow arrows: infrastructure between rooms — drawn after rooms,
		// before workstations/agents so they read as the pipeline, not content.
		if (lod < LOD_AGGREGATE) drawWorkflowArrows(rc, this.workflowEdges);

		if (!scene) {
			ctx.restore();
			return;
		}

		if (lod === LOD_AGGREGATE) for (const zr of zones) drawZoneAggregate(rc, zr, scene);

		const hasFilter = this.iFA();
		const cull = lod < LOD_SIMPLIFIED ? this.getViewportCullBounds() : undefined;
		const sortedTasks = Array.from(scene.tasks.values())
			.filter((t) => (!hasFilter || this.mTF(t)) && (lod >= LOD_SIMPLIFIED || this.isInViewport(t.x, t.y, cull!)))
			.sort((a, b) => a.y - b.y);

		if (lod === LOD_AGGREGATE) {
			// Aggregate workstations are drawn via drawZoneAggregate above.
		} else if (lod === LOD_SIMPLIFIED) {
			for (const t of sortedTasks) drawWorkstationSimplified(rc, t);
		} else {
			for (const t of sortedTasks) {
				drawWorkstation(rc, t, this.reducedMotion, this.reducedTransparency, scene.agents, this.zoneColorForTask(t));
			}
		}

		if (lod < LOD_SIMPLIFIED) {
			drawClaimLinks(
				rc,
				scene,
				(id) => this.mAF(scene.agents.get(id)!),
				(id) => this.mTF(scene.tasks.get(id)!),
				() => this.iFA(),
				lod,
				(status) => this.zoneColorForStatus(status)
			);
			drawHandoffBeams(
				rc,
				scene,
				(id) => this.mAF(scene.agents.get(id)!),
				(id) => this.mTF(scene.tasks.get(id)!),
				() => this.iFA(),
				lod
			);
			for (const a of scene.agents.values()) {
				if (a.handoffAnim && (!hasFilter || this.mAF(a)) && this.isInViewport(a.x, a.y, cull!)) {
					drawHandoffTrail(rc, a);
				}
			}
		}

		const sortedAgents = Array.from(scene.agents.values())
			.filter((a) => (!hasFilter || this.mAF(a)) && (lod >= LOD_SIMPLIFIED || this.isInViewport(a.x, a.y, cull!)))
			.sort((a, b) => a.y - b.y || (a.id === this.hoveredId ? 1 : -1));

		for (const a of sortedAgents) {
			if (a.handoffAnim) {
				drawHandoffGroup(rc, a);
				continue;
			}
			if (lod === LOD_AGGREGATE) drawCharacterAggregate(rc, a);
			else if (lod === LOD_SIMPLIFIED) drawCharacterSimplified(rc, a);
			else drawCharacter(rc, a);
		}

		ctx.restore();
	}
}
