import type { ArenaScene, ArenaLayoutConfig, ZoneRect, VisualAgent, VisualTask } from "./arenaTypes";
import { computeZones } from "./arenaTransform";
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
	matchesAgentFilter as utilMatchesAgentFilter,
	matchesTaskFilter as utilMatchesTaskFilter,
	isFilterActive as utilIsFilterActive,
	ZOOM_MIN,
	ZOOM_MAX,
	makeCtx
} from "./arena-renderer/utils";

import { drawGlobalFloor, drawRoom } from "./arena-renderer/scene";
import { drawCharacter, drawCharacterSimplified, drawCharacterAggregate } from "./arena-renderer/agents";
import { drawClaimLinks, drawHandoffBeams } from "./arena-renderer/connections";
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
		return this.layout ? computeZones(this.layout.canvasWidth, this.layout.canvasHeight) : [];
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

	// ── Loop ────────────────────────────────────────────────────────────
	private loop = (ts: number) => {
		const dt = Math.min((ts - this.prevTs) / 1000, 0.05);
		this.prevTs = ts;
		this.ts = ts;
		if (this.scene && this.layout) {
			const zones = computeZones(this.layout.canvasWidth, this.layout.canvasHeight);
			updateAgents(
				this.scene.agents,
				this.wander,
				zones.find((z) => z.id === "in_progress") || zones[0],
				dt,
				ts,
				this.reducedMotion,
				updateHandoffAnim
			);
		}
		this.render();
		this.rafId = requestAnimationFrame(this.loop);
	};

	// ── Main render ──────────────────────────────────────────────────────
	private render() {
		const { canvas, ctx, scene, layout, isDark, viewportZoom: z, viewportPanX: px, viewportPanY: py } = this;
		if (!layout) return;
		const zones = computeZones(layout.canvasWidth, layout.canvasHeight);
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
		for (const zr of zones) drawRoom(rc, zr);

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
			for (const t of sortedTasks) drawWorkstation(rc, t, this.reducedMotion, this.reducedTransparency, scene.agents);
		}

		if (lod < LOD_SIMPLIFIED) {
			drawClaimLinks(
				rc,
				scene,
				(id) => this.mAF(scene.agents.get(id)!),
				(id) => this.mTF(scene.tasks.get(id)!),
				() => this.iFA(),
				lod
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
