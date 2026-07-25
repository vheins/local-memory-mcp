<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import { derived } from "svelte/store";
	import { theme } from "../lib/stores";
	import { createArenaHandler } from "../lib/composables/useAgentArena";
	import { ArenaRenderer } from "../lib/arena/arenaRenderer";
	import type { ArenaLayoutConfig } from "../lib/arena/arenaTypes";
	import { arenaStateManager } from "../lib/arena/arenaStateManager";
	import RepositoryCluster from "./RepositoryCluster.svelte";
	import Icon from "../lib/Icon.svelte";
	import EventTimeline from "./EventTimeline.svelte";
	import FilterBar from "./FilterBar.svelte";
	import HoverTooltip from "./HoverTooltip.svelte";
	import ContextMenu from "./ContextMenu.svelte";

	// ── Zoom constants ────────────────────────────────────────────────────
	const ZOOM_MIN = 0.1;
	const ZOOM_MAX = 3.0;
	const ZOOM_STEP = 0.15;
	const ZOOM_ANIM_DURATION = 300; // ms

	// ── Accessibility: reduced motion ──────────────────────────────────────
	const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
	let reducedMotion = $state(motionQuery.matches);
	motionQuery.addEventListener("change", (e) => {
		reducedMotion = e.matches;
	});

	// ── Accessibility: reduced transparency ────────────────────────────────
	const transparencyQuery = window.matchMedia("(prefers-reduced-transparency: reduce)");
	let reducedTransparency = $state(transparencyQuery.matches);
	transparencyQuery.addEventListener("change", (e) => {
		reducedTransparency = e.matches;
	});

	// ── Accessibility: ARIA live region ────────────────────────────────────
	let liveRegionText = $state("");

	let canvas: HTMLCanvasElement;
	let wrapEl: HTMLDivElement;
	let minimapCanvas: HTMLCanvasElement;
	let renderer: ArenaRenderer | null = null;
	let layout: ArenaLayoutConfig | null = null;
	let hoveredAgentId: string | null = null;
	let tooltipPos: { x: number; y: number } | null = null;

	// ── Viewport state (reactive from store, see $derived below) ──────────

	// ── Pan drag state ────────────────────────────────────────────────────
	let isPanning = false;
	let panLastX = 0;
	let panLastY = 0;

	// ── Minimap drag state ────────────────────────────────────────────────
	let minimapDragging = false;

	// ── Hover tooltip state (supports agent + task) ─────────────────────
	let hoverEntityType: "agent" | "task" | "repository" | null = null;
	let hoverEntityId: string | null = null;

	// ── Context menu state ────────────────────────────────────────────────
	let ctxVisible = false;
	let ctxX = 0;
	let ctxY = 0;
	let ctxEntityType: "agent" | "task" | "repository" | null = null;
	let ctxEntityId: string | null = null;

	// ── Keyboard navigation state ─────────────────────────────────────────
	let focusMode: "canvas" | "controls" = "canvas";
	let selectedEntityId: string | null = null;
	let selectedEntityType: "agent" | "task" | "repository" | null = null;

	// ── Zone key mapping for number keys 1-5 ────────────────────────────
	const ZONE_KEY_MAP: Record<string, string> = {
		"1": "pending",
		"2": "in_progress",
		"3": "backlog",
		"4": "blocked",
		"5": "recovery"
	};

	const arena = createArenaHandler();
	const repos = derived(arenaStateManager.getStore(), ($state) => $state.repositories);
	const eventLog = derived(arenaStateManager.getStore(), ($state) => $state.ui.eventLog);
	const uiStore = derived(arenaStateManager.getStore(), ($state) => $state.ui);

	// Sync viewport state from store
	let currentZoom = $derived($uiStore.zoom);
	let currentPanX = $derived($uiStore.panX);
	let currentPanY = $derived($uiStore.panY);

	// Push viewport to renderer whenever it changes
	$effect(() => {
		if (renderer) {
			renderer.setViewport(currentZoom, currentPanX, currentPanY);
		}
	});

	// Push accessibility preferences to renderer
	$effect(() => {
		if (renderer) renderer.setReducedMotion(reducedMotion);
	});
	$effect(() => {
		if (renderer) renderer.setReducedTransparency(reducedTransparency);
	});

	// Push filter to renderer whenever it changes
	const filterUnsub = arenaStateManager.getStore().subscribe(($state) => {
		if (renderer) {
			renderer.setFilter($state.ui.activeFilter);
		}
	});
	onDestroy(() => filterUnsub());

	// ── Accessibility: announce events via ARIA live region ────────────────
	let lastEventCount = 0;
	const eventAnnounceUnsub = eventLog.subscribe(($events) => {
		if ($events.length <= lastEventCount) {
			lastEventCount = $events.length;
			return;
		}
		const newEvents = $events.slice(lastEventCount);
		lastEventCount = $events.length;
		for (const evt of newEvents) {
			const announce = formatEventAnnouncement(evt);
			if (announce) {
				liveRegionText = announce;
			}
		}
	});
	onDestroy(() => eventAnnounceUnsub());

	function formatEventAnnouncement(evt: {
		type: string;
		action: string;
		entityType: string;
		entityId: string;
		detail: string;
	}): string | null {
		const entityLabel = `${evt.entityType} ${evt.entityId}`;
		if (evt.action === "completed") return `Task ${evt.entityId} completed`;
		if (evt.action === "failed") return `Task ${evt.entityId} failed`;
		if (evt.action === "connected") return `${entityLabel} connected`;
		if (evt.action === "disconnected") return `${entityLabel} disconnected`;
		if (evt.action === "blocked") return `Task ${evt.entityId} blocked: ${evt.detail}`;
		return null;
	}

	function initCanvas(): void {
		if (!canvas || !wrapEl) return;
		const w = wrapEl.clientWidth || 960;
		const h = Math.max(520, Math.min(window.innerHeight - 220, 800));
		canvas.width = w;
		canvas.height = h;
		layout = { canvasWidth: w, canvasHeight: h };

		if (!renderer) {
			renderer = new ArenaRenderer(canvas);
			renderer.setViewport(currentZoom, currentPanX, currentPanY);
			renderer.setReducedMotion(reducedMotion);
			renderer.setReducedTransparency(reducedTransparency);
			renderer.start();
		}
		arena.setLayout(layout);
		// Push updated layout/theme to renderer immediately
		if ($arena.scene) renderer.update($arena.scene, layout, $theme === "dark");
	}

	$effect(() => {
		if (renderer && $arena.scene && layout) {
			renderer.update($arena.scene, layout, $theme === "dark");
		}
	});

	// Redraw minimap when scene or viewport changes
	$effect(() => {
		if (minimapCanvas && renderer) {
			drawMinimap($arena.scene, $theme === "dark");
		}
	});

	// ── Canvas coordinate helpers ─────────────────────────────────────────
	function canvasCoords(e: MouseEvent): { cx: number; cy: number } {
		const rect = canvas.getBoundingClientRect();
		const sx = canvas.width / rect.width;
		const sy = canvas.height / rect.height;
		return {
			cx: (e.clientX - rect.left) * sx,
			cy: (e.clientY - rect.top) * sy
		};
	}

	// ── Mouse move (hover detection) ─────────────────────────────────────
	function onMouseMove(e: MouseEvent): void {
		// Handle pan drag first
		if (isPanning) {
			const dx = e.clientX - panLastX;
			const dy = e.clientY - panLastY;
			panLastX = e.clientX;
			panLastY = e.clientY;
			// Scale delta by device pixel ratio to match canvas coords
			const rect = canvas.getBoundingClientRect();
			const sx = canvas.width / rect.width;
			const sy = canvas.height / rect.height;
			const newPanX = currentPanX + dx * sx;
			const newPanY = currentPanY + dy * sy;
			arenaStateManager.setPan(newPanX, newPanY);
			return;
		}

		if (!renderer || !$arena.scene) {
			hoveredAgentId = null;
			tooltipPos = null;
			hoverEntityType = null;
			hoverEntityId = null;
			return;
		}
		const { cx, cy } = canvasCoords(e);

		const hit = renderer.hitTest(cx, cy);
		if (hit) {
			hoveredAgentId = hit.type === "agent" ? hit.id : null;
			renderer.setHovered(hoveredAgentId);
			hoverEntityType = hit.type;
			hoverEntityId = hit.id;
		} else {
			hoveredAgentId = null;
			hoverEntityType = null;
			hoverEntityId = null;
			renderer.setHovered(null);
		}
		tooltipPos = hoverEntityId
			? {
					x: e.clientX - canvas.getBoundingClientRect().left + 14,
					y: e.clientY - canvas.getBoundingClientRect().top - 10
				}
			: null;
	}

	function onMouseDown(e: MouseEvent): void {
		// Middle mouse button starts pan
		if (e.button === 1) {
			e.preventDefault();
			isPanning = true;
			panLastX = e.clientX;
			panLastY = e.clientY;
			canvas.style.cursor = "grabbing";
		}
	}

	function onMouseUp(e: MouseEvent): void {
		if (e.button === 1 && isPanning) {
			isPanning = false;
			canvas.style.cursor = hoveredAgentId ? "pointer" : "default";
		}
	}

	function onMouseLeave(): void {
		hoveredAgentId = null;
		tooltipPos = null;
		hoverEntityType = null;
		hoverEntityId = null;
		renderer?.setHovered(null);
		if (isPanning) {
			isPanning = false;
			canvas.style.cursor = "default";
		}
	}

	// ── Scroll wheel zoom (toward cursor) ────────────────────────────────
	function onWheel(e: WheelEvent): void {
		e.preventDefault();
		const { cx, cy } = canvasCoords(e);
		const delta = -e.deltaY * 0.001;
		const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, currentZoom * (1 + delta)));

		// Zoom toward cursor: adjust pan so the world point under cursor stays fixed
		const worldBeforeX = (cx - currentPanX) / currentZoom;
		const worldBeforeY = (cy - currentPanY) / currentZoom;
		const newPanX = cx - worldBeforeX * newZoom;
		const newPanY = cy - worldBeforeY * newZoom;

		arenaStateManager.setZoom(newZoom);
		arenaStateManager.setPan(newPanX, newPanY);
	}

	// ── Canvas click handling (select entity + double-click zoom) ────────
	let lastClickTime = 0;
	function onCanvasClick(e: MouseEvent): void {
		if (e.button !== 0) return;
		const now = Date.now();
		const { cx, cy } = canvasCoords(e);

		if (now - lastClickTime < 350) {
			// Double-click detected — zoom to entity
			if (!renderer || !canvas) return;
			const hit = renderer.hitTestAgentWithPos(cx, cy);
			if (hit) {
				animateZoomTo(hit.wx, hit.wy, 2.5);
			} else {
				const worldX = (cx - currentPanX) / currentZoom;
				const worldY = (cy - currentPanY) / currentZoom;
				animateZoomTo(worldX, worldY, Math.min(ZOOM_MAX, currentZoom * 1.8));
			}
			lastClickTime = 0;
			return;
		}
		lastClickTime = now;

		// Single click: select entity
		if (!renderer || !$arena.scene) return;
		const hit = renderer.hitTest(cx, cy);
		if (hit) {
			selectedEntityId = hit.id;
			selectedEntityType = hit.type;
			arenaStateManager.setSelected(hit.id, hit.type);
			if (hit.type === "agent") {
				arenaStateManager.setSidePanelView("agent");
			} else if (hit.type === "task") {
				arenaStateManager.setSidePanelView("task");
			}
		} else {
			selectedEntityId = null;
			selectedEntityType = null;
			arenaStateManager.setSelected(null, null);
		}
	}

	// ── Right-click context menu ────────────────────────────────────────
	function onContextMenu(e: MouseEvent): void {
		e.preventDefault();
		if (!renderer || !$arena.scene) return;
		const { cx, cy } = canvasCoords(e);
		const hit = renderer.hitTest(cx, cy);
		if (hit) {
			ctxEntityType = hit.type;
			ctxEntityId = hit.id;
			ctxX = e.clientX;
			ctxY = e.clientY;
			ctxVisible = true;
			selectedEntityId = hit.id;
			selectedEntityType = hit.type;
			arenaStateManager.setSelected(hit.id, hit.type);
		} else {
			ctxVisible = false;
		}
	}

	function onContextAction(e: CustomEvent<{ action: string; entityId: string; entityType: string }>): void {
		const { action, entityId, entityType } = e.detail;
		switch (action) {
			case "focus":
				if (renderer) renderer.focusEntity(entityId, entityType as "agent" | "task");
				break;
			case "view-details":
			case "view-logs":
				arenaStateManager.setSelected(entityId, entityType as "agent" | "task" | "repository");
				arenaStateManager.setSidePanelView(entityType === "repository" ? "repo" : (entityType as "agent" | "task"));
				break;
			default:
				break;
		}
	}

	function onContextClose(): void {
		ctxVisible = false;
	}

	// ── Keyboard navigation ──────────────────────────────────────────────
	function onKeyDown(e: KeyboardEvent): void {
		const tag = (e.target as HTMLElement)?.tagName;
		if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
		const scene = $arena.scene;
		if (!scene) return;

		switch (e.key) {
			case "Tab": {
				e.preventDefault();
				focusMode = focusMode === "canvas" ? "controls" : "canvas";
				if (focusMode === "canvas") canvas?.focus();
				break;
			}
			case "ArrowUp":
			case "ArrowDown":
			case "ArrowLeft":
			case "ArrowRight": {
				if (focusMode !== "canvas" || !renderer) break;
				e.preventDefault();
				navigateEntity(e.key);
				break;
			}
			case "Enter": {
				e.preventDefault();
				if (selectedEntityId && selectedEntityType) {
					arenaStateManager.setSelected(selectedEntityId, selectedEntityType);
					if (selectedEntityType === "agent") arenaStateManager.setSidePanelView("agent");
					else if (selectedEntityType === "task") arenaStateManager.setSidePanelView("task");
					else if (selectedEntityType === "repository") arenaStateManager.setSidePanelView("repo");
					if (renderer) renderer.focusEntity(selectedEntityId, selectedEntityType as "agent" | "task");
				}
				break;
			}
			case "Escape": {
				e.preventDefault();
				if (ctxVisible) {
					ctxVisible = false;
				} else {
					selectedEntityId = null;
					selectedEntityType = null;
					arenaStateManager.setSelected(null, null);
				}
				break;
			}
			case "r": {
				if (e.ctrlKey || e.metaKey) break;
				e.preventDefault();
				resetView();
				break;
			}
			case "f": {
				if (e.ctrlKey || e.metaKey) break;
				e.preventDefault();
				const fb = document.querySelector(".filter-bar") as HTMLElement | null;
				if (fb) fb.style.display = fb.style.display === "none" ? "" : "none";
				break;
			}
			case "e": {
				if (e.ctrlKey || e.metaKey) break;
				e.preventDefault();
				arenaStateManager.toggleTimeline();
				break;
			}
			case "/": {
				e.preventDefault();
				// Could open a search overlay — for now just prevent default
				break;
			}
			case " ": {
				if (e.ctrlKey || e.metaKey) break;
				e.preventDefault();
				arenaStateManager.togglePause();
				break;
			}
			default: {
				if (ZONE_KEY_MAP[e.key] && !e.ctrlKey && !e.metaKey && !e.altKey) {
					e.preventDefault();
					focusZone(ZONE_KEY_MAP[e.key]);
				}
				break;
			}
		}
	}

	function navigateEntity(direction: string): void {
		if (!$arena.scene || !renderer) return;
		const agents = Array.from($arena.scene.agents.values());
		const tasks = Array.from($arena.scene.tasks.values());
		const all = [
			...agents.map((a) => ({ id: a.id, type: "agent" as const, x: a.x, y: a.y })),
			...tasks.map((t) => ({ id: t.id, type: "task" as const, x: t.x, y: t.y }))
		];
		if (all.length === 0) return;

		if (!selectedEntityId) {
			const first = all[0];
			selectedEntityId = first.id;
			selectedEntityType = first.type;
			arenaStateManager.setSelected(first.id, first.type);
			return;
		}

		const cur = all.find((e) => e.id === selectedEntityId);
		if (!cur) {
			const first = all[0];
			selectedEntityId = first.id;
			selectedEntityType = first.type;
			arenaStateManager.setSelected(first.id, first.type);
			return;
		}

		let best: (typeof all)[0] | null = null;
		let bestDist = Infinity;
		for (const ent of all) {
			if (ent.id === cur.id) continue;
			const dx = ent.x - cur.x;
			const dy = ent.y - cur.y;
			let ok = false;
			if (direction === "ArrowUp") ok = dy < -5;
			else if (direction === "ArrowDown") ok = dy > 5;
			else if (direction === "ArrowLeft") ok = dx < -5;
			else if (direction === "ArrowRight") ok = dx > 5;
			if (ok) {
				const d = Math.hypot(dx, dy);
				if (d < bestDist) {
					bestDist = d;
					best = ent;
				}
			}
		}
		if (best) {
			selectedEntityId = best.id;
			selectedEntityType = best.type;
			arenaStateManager.setSelected(best.id, best.type);
		}
	}

	function focusZone(zoneId: string): void {
		if (!renderer) return;
		const zones = renderer.getZones();
		const zone = zones.find((z) => z.id === zoneId);
		if (!zone || !canvas) return;
		animateZoomTo(zone.x + zone.w / 2, zone.y + zone.h / 2, Math.min(ZOOM_MAX, 1.8));
	}

	/** Smoothly animate zoom+pan to center on a world coordinate. */
	function animateZoomTo(worldX: number, worldY: number, targetZoom: number): void {
		if (!canvas) return;
		const startZoom = currentZoom;
		const startPanX = currentPanX;
		const startPanY = currentPanY;
		const targetPanX = canvas.width / 2 - worldX * targetZoom;
		const targetPanY = canvas.height / 2 - worldY * targetZoom;
		const startTime = performance.now();

		function tick(now: number): void {
			const elapsed = now - startTime;
			const t = Math.min(1, elapsed / ZOOM_ANIM_DURATION);
			// Ease out cubic
			const ease = 1 - Math.pow(1 - t, 3);

			const z = startZoom + (targetZoom - startZoom) * ease;
			const px = startPanX + (targetPanX - startPanX) * ease;
			const py = startPanY + (targetPanY - startPanY) * ease;

			arenaStateManager.setZoom(z);
			arenaStateManager.setPan(px, py);

			if (t < 1) requestAnimationFrame(tick);
		}
		requestAnimationFrame(tick);
	}

	// ── Zoom control buttons ─────────────────────────────────────────────
	function zoomIn(): void {
		arenaStateManager.setZoom(Math.min(ZOOM_MAX, currentZoom * (1 + ZOOM_STEP)));
	}

	function zoomOut(): void {
		arenaStateManager.setZoom(Math.max(ZOOM_MIN, currentZoom * (1 - ZOOM_STEP)));
	}

	function resetView(): void {
		arenaStateManager.resetView();
	}

	// ── Minimap ──────────────────────────────────────────────────────────
	function drawMinimap(
		scene: {
			agents: Map<string, { x: number; y: number; color: string }>;
			tasks: Map<string, { x: number; y: number; status: string }>;
		} | null,
		isDark: boolean
	): void {
		if (!minimapCanvas || !layout) return;
		const ctx = minimapCanvas.getContext("2d");
		if (!ctx) return;

		const mw = minimapCanvas.width;
		const mh = minimapCanvas.height;
		const worldW = layout.canvasWidth;
		const worldH = layout.canvasHeight;
		const scaleX = mw / worldW;
		const scaleY = mh / worldH;
		const scale = Math.min(scaleX, scaleY);

		// Background
		ctx.fillStyle = isDark ? "rgba(15,23,42,0.9)" : "rgba(241,245,249,0.9)";
		ctx.fillRect(0, 0, mw, mh);

		// Zone rectangles
		if (renderer) {
			const zones = renderer.getZones();
			const zoneColors: Record<string, string> = {
				in_progress: "#a855f7",
				pending: "#0ea5e9",
				backlog: "#64748b",
				blocked: "#ef4444",
				completed: "#10b981"
			};
			for (const z of zones) {
				ctx.fillStyle = isDark ? (zoneColors[z.id] || "#334155") + "44" : (zoneColors[z.id] || "#94a3b8") + "33";
				ctx.fillRect(z.x * scale, z.y * scale, z.w * scale, z.h * scale);
				ctx.strokeStyle = (zoneColors[z.id] || "#64748b") + "88";
				ctx.lineWidth = 0.5;
				ctx.strokeRect(z.x * scale, z.y * scale, z.w * scale, z.h * scale);
			}
		}

		// Task dots
		if (scene) {
			const statusDotColors: Record<string, string> = {
				in_progress: "#a855f7",
				pending: "#0ea5e9",
				blocked: "#ef4444",
				completed: "#10b981",
				backlog: "#64748b"
			};
			for (const t of scene.tasks.values()) {
				ctx.fillStyle = statusDotColors[t.status] || "#64748b";
				ctx.fillRect(t.x * scale - 1, t.y * scale - 1, 2, 2);
			}

			// Agent dots (colored by role/color)
			for (const a of scene.agents.values()) {
				ctx.fillStyle = a.color || "#8b5cf6";
				ctx.beginPath();
				ctx.arc(a.x * scale, a.y * scale, 2, 0, Math.PI * 2);
				ctx.fill();
			}
		}

		// Viewport rectangle
		if (renderer) {
			const info = renderer.getViewportInfo();
			const vpX = (-info.panX / info.zoom) * scale;
			const vpY = (-info.panY / info.zoom) * scale;
			const vpW = (info.canvasW / info.zoom) * scale;
			const vpH = (info.canvasH / info.zoom) * scale;

			ctx.strokeStyle = isDark ? "#e2e8f0" : "#1e293b";
			ctx.lineWidth = 1.5;
			ctx.strokeRect(vpX, vpY, vpW, vpH);
			ctx.fillStyle = isDark ? "rgba(226,232,240,0.06)" : "rgba(30,41,59,0.06)";
			ctx.fillRect(vpX, vpY, vpW, vpH);
		}

		// Border
		ctx.strokeStyle = isDark ? "rgba(148,163,184,0.3)" : "rgba(0,0,0,0.1)";
		ctx.lineWidth = 1;
		ctx.strokeRect(0, 0, mw, mh);
	}

	function onMinimapMouseDown(e: MouseEvent): void {
		minimapDragging = true;
		minimapNavigate(e);
	}

	function onMinimapMouseMove(e: MouseEvent): void {
		if (minimapDragging) minimapNavigate(e);
	}

	function onMinimapMouseUp(): void {
		minimapDragging = false;
	}

	function minimapNavigate(e: MouseEvent): void {
		if (!minimapCanvas || !canvas || !layout) return;
		const rect = minimapCanvas.getBoundingClientRect();
		const mx = e.clientX - rect.left;
		const my = e.clientY - rect.top;
		const worldW = layout.canvasWidth;
		const worldH = layout.canvasHeight;
		const scaleX = minimapCanvas.width / worldW;
		const scaleY = minimapCanvas.height / worldH;
		const scale = Math.min(scaleX, scaleY);

		// Convert minimap click to world coords, then center viewport
		const worldX = mx / scale;
		const worldY = my / scale;
		const newPanX = canvas.width / 2 - worldX * currentZoom;
		const newPanY = canvas.height / 2 - worldY * currentZoom;
		arenaStateManager.setPan(newPanX, newPanY);
	}

	const zoomPercent = $derived(Math.round(currentZoom * 100));

	function handleEventClick(e: CustomEvent) {
		const entry = e.detail;
		if (entry.entityId && entry.entityType) {
			arenaStateManager.setSelected(entry.entityId, entry.entityType);
			if (entry.entityType === "agent") {
				arenaStateManager.setSidePanelView("agent");
			} else if (entry.entityType === "task") {
				arenaStateManager.setSidePanelView("task");
			} else if (entry.entityType === "repository") {
				arenaStateManager.setSidePanelView("repo");
			}
		}
	}

	const ARENA_INIT_DELAY_MS = 60;

	onMount(() => {
		const tid = setTimeout(() => {
			initCanvas();
			if (layout) arena.start(layout);
		}, ARENA_INIT_DELAY_MS);

		const ro = new ResizeObserver(() => initCanvas());
		ro.observe(wrapEl);

		return () => {
			clearTimeout(tid);
			ro.disconnect();
		};
	});

	onDestroy(() => {
		arena.stop();
		renderer?.stop();
	});
</script>

<div class="arena-root glass card animate-fade-in" class:reduced-transparency={reducedTransparency}>
	<!-- ARIA live region for screen reader announcements -->
	<div class="sr-only" aria-live="polite" aria-atomic="true">{liveRegionText}</div>

	<!-- Header -->
	<div class="arena-hdr">
		<div class="arena-hdr-left">
			<div class="arena-icon">
				<Icon name="cpu" size={16} strokeWidth={1.75} />
			</div>
			<div>
				<div class="section-label" style="margin:0">Agent Arena</div>
				<div class="arena-sub">Live 2D view · all repositories</div>
			</div>
		</div>
		<div class="arena-hdr-right">
			{#if $arena.loading && !$arena.scene}
				<span class="badge loading">
					<span
						class="animate-spin"
						style="display:inline-block;width:10px;height:10px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%"
					></span>
					Loading…
				</span>
			{:else if $arena.error}
				<span class="badge error"><Icon name="alert-circle" size={11} /> Error</span>
			{:else if $arena.scene}
				<span class="badge live">
					<span class="pulse-dot"></span>
					Live &nbsp;·&nbsp;
					<strong>{$arena.scene.agents.size}</strong>&nbsp;{$arena.scene.agents.size === 1 ? "agent" : "agents"}
					&nbsp;·&nbsp;
					<strong>{$arena.scene.tasks.size}</strong>&nbsp;{$arena.scene.tasks.size === 1 ? "task" : "tasks"}
					{#if $arena.repoCount > 1}&nbsp;· {$arena.repoCount} repos{/if}
				</span>
			{/if}
		</div>
	</div>

	<!-- Filter bar -->
	<FilterBar />

	<!-- World canvas -->
	<div class="arena-wrap" bind:this={wrapEl}>
		<canvas
			bind:this={canvas}
			class="arena-canvas"
			on:mousemove={onMouseMove}
			on:mousedown={onMouseDown}
			on:mouseup={onMouseUp}
			on:mouseleave={onMouseLeave}
			on:wheel={onWheel}
			on:click={onCanvasClick}
			on:contextmenu={onContextMenu}
			on:keydown={onKeyDown}
			tabindex="0"
			role="application"
			aria-label="Agent Arena canvas — use arrow keys to navigate, Enter to select, number keys 1-5 to focus zones"
			aria-roledescription="arena"
			style="cursor:{isPanning ? 'grabbing' : hoveredAgentId ? 'pointer' : 'default'}"
		></canvas>

		<!-- Rich hover tooltip (agents + tasks + repos) -->
		<HoverTooltip entityType={hoverEntityType} entityId={hoverEntityId} position={tooltipPos} />

		<!-- Right-click context menu -->
		<ContextMenu
			visible={ctxVisible}
			x={ctxX}
			y={ctxY}
			entityType={ctxEntityType}
			entityId={ctxEntityId}
			on:action={onContextAction}
			on:close={onContextClose}
		/>

		<!-- Empty: no active agents -->
		{#if $arena.scene && $arena.scene.agents.size === 0 && !$arena.loading}
			<div class="arena-empty">
				<Icon name="users" size={30} strokeWidth={1.2} />
				<div style="font-weight:700;font-size:0.9rem">No active agents</div>
				<div class="arena-empty-sub">Agents appear here when they claim tasks across your repositories</div>
			</div>
		{/if}

		<!-- Minimap overlay (top-right) -->
		<div class="minimap-wrap">
			<canvas
				bind:this={minimapCanvas}
				class="minimap-canvas"
				width={160}
				height={100}
				on:mousedown={onMinimapMouseDown}
				on:mousemove={onMinimapMouseMove}
				on:mouseup={onMinimapMouseUp}
				on:mouseleave={onMinimapMouseUp}
			></canvas>
		</div>

		<!-- Zoom controls (bottom-right) -->
		<div class="zoom-controls">
			<button class="zoom-btn" on:click={zoomIn} title="Zoom in" aria-label="Zoom in">+</button>
			<button class="zoom-pct" on:click={resetView} title="Reset view" aria-label="Reset view">{zoomPercent}%</button>
			<button class="zoom-btn" on:click={zoomOut} title="Zoom out" aria-label="Zoom out">−</button>
		</div>
	</div>

	<!-- Footer legend -->
	<div class="arena-footer">
		<div class="legend-row">
			<div class="legend-item"><span class="lg-dot" style="background:#8b5cf6"></span>Lobby (idle)</div>
			<div class="legend-item"><span class="lg-dot" style="background:#0ea5e9"></span>Inbox</div>
			<div class="legend-item"><span class="lg-dot" style="background:#a855f7"></span>Workspace</div>
			<div class="legend-item"><span class="lg-dot" style="background:#ef4444"></span>Issues</div>
			<div class="legend-item"><span class="lg-dot" style="background:#10b981"></span>Done</div>
		</div>
		<div class="legend-row">
			<div class="legend-item">
				<span class="lg-bubble"></span>Working agent
			</div>
			<div class="legend-item">
				<span class="lg-dash" style="border-color:#f59e0b"></span>Handoff beam
			</div>
			<div class="legend-item">
				<span class="lg-dash"></span>Claim link
			</div>
		</div>
	</div>

	<RepositoryCluster repositories={$repos} collapsed={true} />

	<EventTimeline events={$eventLog} on:eventClick={handleEventClick} />
</div>

<style>
	.arena-root {
		position: relative;
		padding: 0;
		overflow: hidden;
		border-radius: 0;
	}

	.arena-hdr {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 20px;
		border-bottom: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.03);
	}

	.arena-hdr-left {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.arena-icon {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		background: linear-gradient(135deg, var(--color-primary), var(--color-accent));
		display: flex;
		align-items: center;
		justify-content: center;
		color: white;
		box-shadow: 0 4px 12px var(--glow-primary);
		flex-shrink: 0;
	}

	.arena-sub {
		font-size: 0.67rem;
		color: var(--color-text-muted);
		font-weight: 600;
		margin-top: 1px;
	}
	.arena-hdr-right {
		display: flex;
		align-items: center;
	}

	.badge {
		font-size: 0.7rem;
		font-weight: 700;
		padding: 4px 10px;
		border-radius: 999px;
		display: flex;
		align-items: center;
		gap: 5px;
	}
	.badge.loading {
		color: var(--color-text-muted);
		background: rgba(100, 116, 139, 0.1);
	}
	.badge.error {
		color: #ef4444;
		background: rgba(239, 68, 68, 0.1);
	}
	.badge.live {
		color: #10b981;
		background: rgba(16, 185, 129, 0.1);
		border: 1px solid rgba(16, 185, 129, 0.2);
	}

	.pulse-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #10b981;
		animation: status-blink 1.8s ease-in-out infinite;
		flex-shrink: 0;
	}

	.arena-wrap {
		position: relative;
		width: 100%;
		background: var(--color-bg);
	}

	.arena-canvas {
		display: block;
		width: 100%;
		height: auto;
	}

	.arena-canvas:focus-visible {
		outline: 3px solid var(--color-primary);
		outline-offset: 2px;
	}

	/* ── Visually hidden but accessible to screen readers ──────────────── */
	:global(.sr-only) {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.arena-empty {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		color: var(--color-text-muted);
		pointer-events: none;
	}
	.arena-empty-sub {
		font-size: 0.73rem;
		opacity: 0.6;
		text-align: center;
		max-width: 280px;
	}

	.agent-tip {
		position: absolute;
		z-index: 20;
		padding: 10px 12px;
		border-radius: 12px;
		font-size: 0.77rem;
		min-width: 168px;
		pointer-events: none;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18);
		backdrop-filter: blur(14px);
	}
	.tip-name {
		display: flex;
		align-items: center;
		gap: 6px;
		font-weight: 800;
		font-size: 0.82rem;
		color: var(--color-text);
		margin-bottom: 7px;
	}
	.tip-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.tip-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
		padding: 1px 0;
		color: var(--color-text-muted);
		font-size: 0.73rem;
	}
	.tip-key {
		font-weight: 700;
		font-size: 0.67rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		opacity: 0.65;
	}
	.tip-state {
		font-weight: 700;
	}
	.tip-state.processing {
		color: #a855f7;
	}
	.tip-state.idle {
		color: #64748b;
	}
	.tip-state.claiming {
		color: #0ea5e9;
	}
	.tip-state.handoff_out {
		color: #f59e0b;
	}
	.tip-state.handoff_in {
		color: #10b981;
	}
	.tip-repos {
		font-size: 0.68rem;
		text-align: right;
		max-width: 100px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tip-model {
		font-size: 0.62rem;
		color: var(--color-text-muted);
		background: rgba(100, 116, 139, 0.1);
		padding: 1px 6px;
		border-radius: 4px;
		font-weight: 600;
		margin-left: auto;
	}
	.tip-tool {
		font-family: "JetBrains Mono", monospace;
		font-size: 0.68rem;
		max-width: 120px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tip-health {
		font-weight: 700;
		text-transform: uppercase;
		font-size: 0.65rem;
	}
	.tip-health.healthy {
		color: #22c55e;
	}
	.tip-health.degraded {
		color: #eab308;
	}
	.tip-health.critical {
		color: #ef4444;
		animation: status-blink 1s ease-in-out infinite;
	}
	.tip-health.offline {
		color: #9ca3af;
	}
	.tip-progress-row {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 1px 0;
		color: var(--color-text-muted);
		font-size: 0.73rem;
	}
	.tip-progress-bar {
		flex: 1;
		height: 4px;
		background: rgba(148, 163, 184, 0.2);
		border-radius: 9999px;
		overflow: hidden;
	}
	.tip-progress-fill {
		height: 100%;
		background: linear-gradient(90deg, #3b82f6, #22c55e);
		border-radius: 9999px;
		transition: width 0.3s ease;
	}
	.tip-progress-text {
		font-size: 0.65rem;
		font-weight: 700;
		min-width: 28px;
		text-align: right;
	}
	.tip-telemetry {
		border-top: 1px solid rgba(148, 163, 184, 0.15);
		margin-top: 4px;
		padding-top: 4px;
	}

	.arena-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 6px;
		padding: 8px 20px;
		border-top: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.02);
	}
	.legend-row {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
	}
	.legend-item {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 0.68rem;
		color: var(--color-text-muted);
		font-weight: 600;
	}
	.lg-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.lg-dash {
		display: inline-block;
		width: 18px;
		height: 0;
		border-top: 2px dashed rgba(99, 102, 241, 0.55);
		flex-shrink: 0;
	}
	.lg-bubble {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: #a855f7;
		flex-shrink: 0;
		animation: status-blink 1.8s ease-in-out infinite;
	}

	/* ── Zoom controls ─────────────────────────────────────────────────── */
	.zoom-controls {
		position: absolute;
		bottom: 12px;
		right: 12px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		z-index: 15;
		user-select: none;
	}
	.zoom-btn {
		width: 28px;
		height: 28px;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: var(--color-surface, rgba(30, 41, 59, 0.85));
		color: var(--color-text, #e2e8f0);
		font-size: 1rem;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		backdrop-filter: blur(8px);
		transition:
			background 0.15s,
			border-color 0.15s;
		padding: 0;
		line-height: 1;
	}
	.zoom-btn:hover {
		background: var(--color-border, rgba(148, 163, 184, 0.2));
		border-color: var(--color-primary, #8b5cf6);
	}
	.zoom-pct {
		width: 42px;
		height: 22px;
		border: 1px solid var(--color-border);
		border-radius: 4px;
		background: var(--color-surface, rgba(30, 41, 59, 0.7));
		color: var(--color-text-muted, #94a3b8);
		font-size: 0.6rem;
		font-weight: 700;
		font-family: "JetBrains Mono", monospace;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		backdrop-filter: blur(8px);
		transition: background 0.15s;
		padding: 0;
	}
	.zoom-pct:hover {
		background: var(--color-border, rgba(148, 163, 184, 0.2));
		color: var(--color-text, #e2e8f0);
	}

	/* ── Minimap ───────────────────────────────────────────────────────── */
	.minimap-wrap {
		position: absolute;
		top: 8px;
		right: 8px;
		z-index: 15;
		border-radius: 6px;
		overflow: hidden;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
		pointer-events: auto;
	}
	.minimap-canvas {
		display: block;
		cursor: crosshair;
	}

	/* ── Reduced transparency overrides ──────────────────────────────────── */
	.reduced-transparency .zoom-btn,
	.reduced-transparency .zoom-pct {
		backdrop-filter: none;
		background: var(--color-surface, #1e293b);
	}
	.reduced-transparency .agent-tip {
		backdrop-filter: none;
	}
</style>
