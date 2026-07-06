<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import { api } from "../lib/api";
	import Icon from "../lib/Icon.svelte";
	import type { KGNode, KGEdge } from "../lib/interfaces";

	export let repo: string;

	// ─── State ─────────────────────────────────────────────────────────────────
	let nodes: KGNode[] = [];
	let edges: KGEdge[] = [];
	let isLoading = true;
	let errorMsg = "";

	// Force layout state
	let layoutNodes: LayoutNode[] = [];
	let layoutEdges: LayoutEdge[] = [];

	interface LayoutNode {
		id: string;
		name: string;
		type: string;
		description?: string;
		memoryCount?: number;
		x: number;
		y: number;
		vx: number;
		vy: number;
		pinned: boolean;
	}

	interface LayoutEdge {
		source: string;
		target: string;
		relation_type: string;
	}

	// Canvas refs
	let canvas: HTMLCanvasElement;
	let ctx: CanvasRenderingContext2D;
	let canvasWidth = 800;
	let canvasHeight = 600;
	let dpr = 1;

	// Interaction
	let hoveredNode: LayoutNode | null = null;
	let selectedNode: LayoutNode | null = null;
	let selectedEdge: LayoutEdge | null = null;
	let tooltipPos = { x: 0, y: 0 };
	let showTooltip = false;

	// Modal state
	let showAddEntityModal = false;
	let showAddRelationModal = false;
	let showDeleteConfirm = false;
	let deleteTarget: { type: "node" | "edge"; name?: string } | null = null;

	// Add Entity form
	let entityName = "";
	let entityType = "concept";
	let entityDesc = "";

	// Add Relation form
	let relFrom = "";
	let relTo = "";
	let relType = "";

	// ─── Node type colors ───────────────────────────────────────────────────────
	const TYPE_COLORS: Record<string, string> = {
		person: "#22c55e",
		place: "#3b82f6",
		organization: "#f97316",
		concept: "#a855f7",
		unknown: "#6b7280"
	};
	const TYPE_GLOWS: Record<string, string> = {
		person: "rgba(34,197,94,0.35)",
		place: "rgba(59,130,246,0.35)",
		organization: "rgba(249,115,22,0.35)",
		concept: "rgba(168,85,247,0.35)",
		unknown: "rgba(107,114,128,0.25)"
	};

	function getNodeColor(type: string): string {
		return TYPE_COLORS[type] ?? TYPE_COLORS.unknown;
	}
	function getNodeGlow(type: string): string {
		return TYPE_GLOWS[type] ?? TYPE_GLOWS.unknown;
	}

	// ─── Load graph data ────────────────────────────────────────────────────────
	async function loadGraph() {
		if (!repo) return;
		isLoading = true;
		errorMsg = "";
		try {
			const data = await api.kgGraph(repo);
			nodes = data.nodes || [];
			edges = data.edges || [];
			initLayout();
		} catch (e: unknown) {
			errorMsg = e instanceof Error ? e.message : "Failed to load graph";
		} finally {
			isLoading = false;
		}
	}

	// ─── Force-directed layout ─────────────────────────────────────────────────
	const NODE_RADIUS = 18;
	const REPULSION_STRENGTH = 4000;
	const ATTRACTION_STRENGTH = 0.005;
	const CENTERING_STRENGTH = 0.01;
	const DAMPING = 0.85;
	const MIN_VELOCITY = 0.1;
	const ITERATIONS = 120;

	function initLayout() {
		const cx = canvasWidth / 2;
		const cy = canvasHeight / 2;
		const spread = Math.min(canvasWidth, canvasHeight) * 0.35;

		layoutNodes = nodes.map((n, i) => {
			const angle = (2 * Math.PI * i) / nodes.length + Math.random() * 0.2;
			const r = spread * (0.3 + Math.random() * 0.7);
			return {
				id: n.id,
				name: n.name,
				type: n.type,
				description: n.description,
				memoryCount: n.memoryCount,
				x: cx + Math.cos(angle) * r,
				y: cy + Math.sin(angle) * r,
				vx: 0,
				vy: 0,
				pinned: false
			};
		});

		layoutEdges = edges.map((e) => ({
			source: e.source,
			target: e.target,
			relation_type: e.relation_type
		}));

		runForceLayout();
	}

	function runForceLayout() {
		const ln = layoutNodes;
		if (ln.length === 0) return;

		for (let iter = 0; iter < ITERATIONS; iter++) {
			const cooling = 1 - iter / ITERATIONS;

			// Repulsion (all pairs)
			for (let i = 0; i < ln.length; i++) {
				for (let j = i + 1; j < ln.length; j++) {
					const a = ln[i];
					const b = ln[j];
					let dx = a.x - b.x;
					let dy = a.y - b.y;
					let dist = Math.hypot(dx, dy);
					if (dist < 1) dist = 1;
					const force = REPULSION_STRENGTH / (dist * dist);
					const fx = (dx / dist) * force * cooling;
					const fy = (dy / dist) * force * cooling;
					if (!a.pinned) {
						a.vx += fx;
						a.vy += fy;
					}
					if (!b.pinned) {
						b.vx -= fx;
						b.vy -= fy;
					}
				}
			}

			// Attraction along edges
			for (const e of layoutEdges) {
				const a = ln.find((n) => n.name === e.source || n.id === e.source);
				const b = ln.find((n) => n.name === e.target || n.id === e.target);
				if (!a || !b) continue;
				const dx = b.x - a.x;
				const dy = b.y - a.y;
				const dist = Math.hypot(dx, dy);
				if (dist < 1) continue;
				const force = ATTRACTION_STRENGTH * dist * cooling;
				const fx = (dx / dist) * force;
				const fy = (dy / dist) * force;
				if (!a.pinned) {
					a.vx += fx;
					a.vy += fy;
				}
				if (!b.pinned) {
					b.vx -= fx;
					b.vy -= fy;
				}
			}

			// Centering
			const cx = canvasWidth / 2;
			const cy = canvasHeight / 2;
			for (const n of ln) {
				if (n.pinned) continue;
				n.vx += (cx - n.x) * CENTERING_STRENGTH * cooling;
				n.vy += (cy - n.y) * CENTERING_STRENGTH * cooling;
			}

			// Apply velocity + damping
			for (const n of ln) {
				if (n.pinned) continue;
				n.vx *= DAMPING;
				n.vy *= DAMPING;
				if (Math.abs(n.vx) < MIN_VELOCITY && Math.abs(n.vy) < MIN_VELOCITY) {
					n.vx = 0;
					n.vy = 0;
				}
				n.x += n.vx;
				n.y += n.vy;

				// Clamp to canvas bounds
				const margin = 30;
				if (n.x < margin) {
					n.x = margin;
					n.vx = 0;
				}
				if (n.x > canvasWidth - margin) {
					n.x = canvasWidth - margin;
					n.vx = 0;
				}
				if (n.y < margin) {
					n.y = margin;
					n.vy = 0;
				}
				if (n.y > canvasHeight - margin) {
					n.y = canvasHeight - margin;
					n.vy = 0;
				}
			}
		}

		render();
	}

	// ─── Canvas rendering ──────────────────────────────────────────────────────
	function resizeCanvas() {
		if (!canvas) return;
		const rect = canvas.parentElement?.getBoundingClientRect();
		if (rect) {
			canvasWidth = rect.width;
			canvasHeight = rect.height;
		}
		dpr = window.devicePixelRatio || 1;
		canvas.width = canvasWidth * dpr;
		canvas.height = canvasHeight * dpr;
		canvas.style.width = canvasWidth + "px";
		canvas.style.height = canvasHeight + "px";
		ctx = canvas.getContext("2d")!;
		ctx.scale(dpr, dpr);
	}

	function render() {
		if (!ctx) return;
		const isDark = document.documentElement.classList.contains("dark");
		ctx.clearRect(0, 0, canvasWidth, canvasHeight);

		// Background
		ctx.fillStyle = isDark ? "#0a0e1a" : "#f0f4ff";
		ctx.fillRect(0, 0, canvasWidth, canvasHeight);

		// Subtle grid
		ctx.strokeStyle = isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)";
		ctx.lineWidth = 0.5;
		const gs = 30;
		for (let x = 0; x < canvasWidth; x += gs) {
			ctx.beginPath();
			ctx.moveTo(x, 0);
			ctx.lineTo(x, canvasHeight);
			ctx.stroke();
		}
		for (let y = 0; y < canvasHeight; y += gs) {
			ctx.beginPath();
			ctx.moveTo(0, y);
			ctx.lineTo(canvasWidth, y);
			ctx.stroke();
		}

		// Draw edges
		for (const e of layoutEdges) {
			const a = layoutNodes.find((n) => n.name === e.source || n.id === e.source);
			const b = layoutNodes.find((n) => n.name === e.target || n.id === e.target);
			if (!a || !b) continue;

			const isSelected = selectedEdge === e;
			const _isHovered = selectedEdge === e;

			ctx.strokeStyle = isSelected ? "#f59e0b" : isDark ? "rgba(148,163,184,0.4)" : "rgba(100,116,139,0.35)";
			ctx.lineWidth = isSelected ? 2.5 : 1.5;
			ctx.beginPath();
			ctx.moveTo(a.x, a.y);
			ctx.lineTo(b.x, b.y);
			ctx.stroke();

			// Edge label (midpoint)
			if (e.relation_type) {
				const mx = (a.x + b.x) / 2;
				const my = (a.y + b.y) / 2;
				ctx.fillStyle = isDark ? "rgba(148,163,184,0.7)" : "rgba(100,116,139,0.7)";
				ctx.font = "9px system-ui,sans-serif";
				ctx.textAlign = "center";
				ctx.textBaseline = "bottom";
				// Background for label
				const label = e.relation_type;
				const tw = ctx.measureText(label).width;
				ctx.fillStyle = isDark ? "rgba(10,14,26,0.8)" : "rgba(240,244,255,0.85)";
				ctx.fillRect(mx - tw / 2 - 3, my - 10, tw + 6, 14);
				ctx.fillStyle = isDark ? "rgba(148,163,184,0.8)" : "rgba(71,85,105,0.8)";
				ctx.fillText(label, mx, my);
			}
		}

		// Draw nodes
		for (const n of layoutNodes) {
			const color = getNodeColor(n.type);
			const glow = getNodeGlow(n.type);
			const isHov = hoveredNode === n;
			const isSel = selectedNode === n;
			const radius = isHov || isSel ? NODE_RADIUS + 4 : NODE_RADIUS;

			// Glow
			if (isHov || isSel) {
				ctx.shadowColor = glow;
				ctx.shadowBlur = 20;
			}

			// Node circle
			const grd = ctx.createRadialGradient(n.x - 4, n.y - 4, 2, n.x, n.y, radius);
			grd.addColorStop(0, isDark ? lighten(color, 40) : lighten(color, 60));
			grd.addColorStop(1, color);
			ctx.fillStyle = grd;
			ctx.beginPath();
			ctx.arc(n.x, n.y, radius, 0, Math.PI * 2);
			ctx.fill();

			ctx.shadowBlur = 0;

			// Border
			ctx.strokeStyle = isSel ? "#f59e0b" : isDark ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.6)";
			ctx.lineWidth = isSel ? 2.5 : 1.5;
			ctx.stroke();

			// Memory count badge
			if (n.memoryCount && n.memoryCount > 0) {
				ctx.fillStyle = isDark ? "#1e293b" : "#ffffff";
				ctx.beginPath();
				ctx.arc(n.x + radius - 6, n.y - radius + 6, 9, 0, Math.PI * 2);
				ctx.fill();
				ctx.fillStyle = getNodeColor(n.type);
				ctx.font = "bold 8px system-ui,sans-serif";
				ctx.textAlign = "center";
				ctx.textBaseline = "middle";
				ctx.fillText(String(n.memoryCount), n.x + radius - 6, n.y - radius + 6);
			}

			// Label
			ctx.fillStyle = isDark ? "#e2e8f0" : "#1e293b";
			ctx.font = "bold 11px system-ui,sans-serif";
			ctx.textAlign = "center";
			ctx.textBaseline = "top";
			ctx.fillText(n.name, n.x, n.y + radius + 4);

			// Description subtitle
			if (n.description) {
				ctx.fillStyle = isDark ? "rgba(148,163,184,0.6)" : "rgba(100,116,139,0.6)";
				ctx.font = "8px system-ui,sans-serif";
				const _maxW = 120;
				let desc = n.description.length > 18 ? n.description.slice(0, 18) + "..." : n.description;
				ctx.fillText(desc, n.x, n.y + radius + 16);
			}
		}

		// Tooltip
		if (showTooltip && selectedNode) {
			const n = selectedNode;
			const tipX = tooltipPos.x;
			const tipY = tooltipPos.y;
			const lines = [
				n.name,
				`Type: ${n.type}`,
				n.description ? n.description : "",
				n.memoryCount != null ? `Memories: ${n.memoryCount}` : ""
			].filter(Boolean);

			ctx.font = "11px system-ui,sans-serif";
			const maxW = Math.max(...lines.map((l) => ctx.measureText(l).width));
			const pad = 10;
			const lh = 16;
			const tw = maxW + pad * 2;
			const th = lines.length * lh + pad * 2;

			let tx = tipX + 12;
			let ty = tipY - 12;
			if (tx + tw > canvasWidth) tx = tipX - tw - 12;
			if (ty + th > canvasHeight) ty = canvasHeight - th - 4;
			if (ty < 4) ty = 4;

			ctx.fillStyle = isDark ? "rgba(2,6,23,0.92)" : "rgba(255,255,255,0.95)";
			ctx.shadowColor = "rgba(0,0,0,0.2)";
			ctx.shadowBlur = 12;
			roundRect(ctx, tx, ty, tw, th, 8);
			ctx.fill();
			ctx.shadowBlur = 0;
			ctx.strokeStyle = isDark ? "rgba(148,163,184,0.2)" : "rgba(0,0,0,0.08)";
			ctx.lineWidth = 1;
			roundRect(ctx, tx, ty, tw, th, 8);
			ctx.stroke();

			ctx.textAlign = "left";
			ctx.textBaseline = "top";
			for (let i = 0; i < lines.length; i++) {
				const isTitle = i === 0;
				ctx.font = isTitle ? "bold 12px system-ui,sans-serif" : "10px system-ui,sans-serif";
				ctx.fillStyle = isDark ? "#e2e8f0" : "#1e293b";
				ctx.fillText(lines[i], tx + pad, ty + pad + i * lh);
			}
		}
	}

	function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
		r = Math.min(r, w / 2, h / 2);
		c.beginPath();
		c.moveTo(x + r, y);
		c.lineTo(x + w - r, y);
		c.arcTo(x + w, y, x + w, y + r, r);
		c.lineTo(x + w, y + h - r);
		c.arcTo(x + w, y + h, x + w - r, y + h, r);
		c.lineTo(x + r, y + h);
		c.arcTo(x, y + h, x, y + h - r, r);
		c.lineTo(x, y + r);
		c.arcTo(x, y, x + r, y, r);
		c.closePath();
	}

	function lighten(hex: string, amt: number): string {
		const s = hex.replace("#", "");
		const n = parseInt(s.length === 3 ? s[0] + s[0] + s[1] + s[1] + s[2] + s[2] : s, 16);
		const r = Math.min(255, ((n >> 16) & 255) + amt);
		const g = Math.min(255, ((n >> 8) & 255) + amt);
		const b = Math.min(255, (n & 255) + amt);
		return `rgb(${r},${g},${b})`;
	}

	// ─── Interaction handlers ───────────────────────────────────────────────────
	function handleCanvasClick(e: MouseEvent) {
		const rect = canvas.getBoundingClientRect();
		const mx = e.clientX - rect.left;
		const my = e.clientY - rect.top;

		// Check nodes first (rendered on top)
		for (const n of layoutNodes) {
			const r = NODE_RADIUS + 4;
			const dx = mx - n.x;
			const dy = my - n.y;
			if (dx * dx + dy * dy <= r * r) {
				selectedNode = n;
				selectedEdge = null;
				tooltipPos = { x: mx, y: my };
				showTooltip = true;
				render();
				return;
			}
		}

		// Check edges (distance to line segment)
		for (const e of layoutEdges) {
			const a = layoutNodes.find((n) => n.name === e.source || n.id === e.source);
			const b = layoutNodes.find((n) => n.name === e.target || n.id === e.target);
			if (!a || !b) continue;
			const dist = distToSegment(mx, my, a.x, a.y, b.x, b.y);
			if (dist < 10) {
				selectedEdge = e;
				selectedNode = null;
				showTooltip = false;
				render();
				return;
			}
		}

		// Click on empty space
		selectedNode = null;
		selectedEdge = null;
		showTooltip = false;
		render();
	}

	function handleCanvasDblClick(e: MouseEvent) {
		const rect = canvas.getBoundingClientRect();
		const mx = e.clientX - rect.left;
		const my = e.clientY - rect.top;

		for (const n of layoutNodes) {
			const r = NODE_RADIUS + 4;
			const dx = mx - n.x;
			const dy = my - n.y;
			if (dx * dx + dy * dy <= r * r) {
				deleteTarget = { type: "node", name: n.name };
				showDeleteConfirm = true;
				return;
			}
		}
	}

	function handleCanvasRightClick(e: MouseEvent) {
		e.preventDefault();
		const rect = canvas.getBoundingClientRect();
		const mx = e.clientX - rect.left;
		const my = e.clientY - rect.top;

		// Check edges
		for (const e of layoutEdges) {
			const a = layoutNodes.find((n) => n.name === e.source || n.id === e.source);
			const b = layoutNodes.find((n) => n.name === e.target || n.id === e.target);
			if (!a || !b) continue;
			const dist = distToSegment(mx, my, a.x, a.y, b.x, b.y);
			if (dist < 10) {
				deleteTarget = { type: "edge", name: `${e.source} → ${e.target} (${e.relation_type})` };
				showDeleteConfirm = true;
				return;
			}
		}
	}

	function handleCanvasMove(e: MouseEvent) {
		const rect = canvas.getBoundingClientRect();
		const mx = e.clientX - rect.left;
		const my = e.clientY - rect.top;

		let found: LayoutNode | null = null;
		for (const n of layoutNodes) {
			const r = NODE_RADIUS + 4;
			const dx = mx - n.x;
			const dy = my - n.y;
			if (dx * dx + dy * dy <= r * r) {
				found = n;
				break;
			}
		}

		if (found !== hoveredNode) {
			hoveredNode = found;
			canvas.style.cursor = found ? "pointer" : "default";
			render();
		}
	}

	function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
		const dx = x2 - x1;
		const dy = y2 - y1;
		const len2 = dx * dx + dy * dy;
		if (len2 === 0) return Math.hypot(px - x1, py - y1);
		let t = ((px - x1) * dx + (py - y1) * dy) / len2;
		t = Math.max(0, Math.min(1, t));
		return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
	}

	// ─── Add Entity ────────────────────────────────────────────────────────────
	async function addEntity() {
		if (!entityName.trim()) return;
		try {
			await api.kgCreateEntity({
				name: entityName.trim(),
				type: entityType,
				description: entityDesc.trim() || undefined,
				repo
			});
			entityName = "";
			entityType = "concept";
			entityDesc = "";
			showAddEntityModal = false;
			await loadGraph();
		} catch (e: unknown) {
			errorMsg = e instanceof Error ? e.message : "Failed to create entity";
		}
	}

	// ─── Add Relation ──────────────────────────────────────────────────────────
	async function addRelation() {
		if (!relFrom || !relTo || !relType.trim()) return;
		try {
			await api.kgCreateRelation({
				from_entity: relFrom,
				to_entity: relTo,
				relation_type: relType.trim(),
				repo
			});
			relFrom = "";
			relTo = "";
			relType = "";
			showAddRelationModal = false;
			await loadGraph();
		} catch (e: unknown) {
			errorMsg = e instanceof Error ? e.message : "Failed to create relation";
		}
	}

	// ─── Delete actions ────────────────────────────────────────────────────────
	async function confirmDelete() {
		if (!deleteTarget) return;
		try {
			if (deleteTarget.type === "node" && deleteTarget.name) {
				await api.kgDeleteEntity(deleteTarget.name);
			} else if (deleteTarget.type === "edge") {
				const e = selectedEdge;
				if (e) {
					await api.kgDeleteRelation({
						from_entity: e.source,
						to_entity: e.target,
						relation_type: e.relation_type
					});
				}
			}
			showDeleteConfirm = false;
			deleteTarget = null;
			selectedEdge = null;
			selectedNode = null;
			showTooltip = false;
			await loadGraph();
		} catch (e: unknown) {
			errorMsg = e instanceof Error ? e.message : "Failed to delete";
		}
	}

	function cancelDelete() {
		showDeleteConfirm = false;
		deleteTarget = null;
	}

	// ─── Lifecycle ─────────────────────────────────────────────────────────────
	let resizeObserver: ResizeObserver | null = null;

	onMount(() => {
		if (canvas) {
			resizeCanvas();
			ctx = canvas.getContext("2d")!;
		}

		if (repo) loadGraph();

		resizeObserver = new ResizeObserver(() => {
			resizeCanvas();
			if (layoutNodes.length > 0) runForceLayout();
		});
		if (canvas?.parentElement) {
			resizeObserver.observe(canvas.parentElement);
		}
	});

	onDestroy(() => {
		resizeObserver?.disconnect();
	});

	// Re-load when repo changes
	$: if (repo && canvas) {
		loadGraph();
	}

	// ─── Tooltip keyboard dismiss ──────────────────────────────────────────────
	function onKeyDown(e: KeyboardEvent) {
		if (e.key === "Escape") {
			showTooltip = false;
			selectedNode = null;
			selectedEdge = null;
			showDeleteConfirm = false;
			showAddEntityModal = false;
			showAddRelationModal = false;
			render();
		}
	}
</script>

<svelte:window on:keydown={onKeyDown} />

<div class="kg-container">
	<!-- Toolbar -->
	<div class="kg-toolbar">
		<div class="kg-toolbar-left">
			<span class="section-label" style="font-size:0.68rem;">
				<Icon name="share-2" size={12} strokeWidth={1.75} />
				Knowledge Graph
			</span>
			<span class="kg-stats">
				{nodes.length} nodes · {edges.length} edges
			</span>
		</div>
		<div class="kg-toolbar-right">
			<button
				class="btn btn-ghost btn-sm"
				on:click={() => {
					showAddEntityModal = true;
				}}
			>
				<Icon name="plus" size={12} strokeWidth={2} />
				Add Entity
			</button>
			<button
				class="btn btn-ghost btn-sm"
				on:click={() => {
					showAddRelationModal = true;
				}}
			>
				<Icon name="link" size={12} strokeWidth={2} />
				Add Relation
			</button>
			<button class="btn btn-ghost btn-sm" on:click={loadGraph} disabled={isLoading}>
				<Icon name="refresh-cw" size={12} strokeWidth={2} className={isLoading ? "animate-spin" : ""} />
				Refresh
			</button>
		</div>
	</div>

	<!-- Error -->
	{#if errorMsg}
		<div class="kg-error">
			<Icon name="triangle-alert" size={14} strokeWidth={1.75} />
			{errorMsg}
		</div>
	{/if}

	<!-- Loading -->
	{#if isLoading}
		<div class="kg-loading">
			<div
				class="animate-spin"
				style="width:24px;height:24px;border:3px solid var(--color-border);border-top-color:var(--color-primary);border-radius:50%;"
			></div>
			<span>Loading graph...</span>
		</div>
	{:else if layoutNodes.length === 0}
		<div class="kg-empty">
			<Icon name="share-2" size={32} strokeWidth={1.25} className="" />
			<div>No knowledge graph data found</div>
			<div class="text-xs" style="color:var(--color-text-muted);">Add entities and relations to build your graph.</div>
		</div>
	{:else}
		<!-- Canvas -->
		<div class="kg-canvas-wrap">
			<canvas
				bind:this={canvas}
				on:click={handleCanvasClick}
				on:dblclick={handleCanvasDblClick}
				on:contextmenu={handleCanvasRightClick}
				on:mousemove={handleCanvasMove}
				aria-label="Knowledge Graph visualization"
				tabindex="0"
			></canvas>
		</div>
	{/if}

	<!-- Delete Confirm Modal -->
	{#if showDeleteConfirm}
		<div
			class="modal-overlay"
			on:click={cancelDelete}
			on:keydown={(e) => e.key === "Escape" && cancelDelete()}
			role="button"
			tabindex="0"
			aria-label="Close"
		></div>
		<div class="modal-panel animate-fade-in-scale" role="dialog" aria-label="Confirm delete">
			<div class="modal-header">
				<Icon name="trash" size={14} strokeWidth={1.75} />
				<span>Confirm Delete</span>
			</div>
			<div class="modal-body">
				{#if deleteTarget?.type === "node"}
					<p>Are you sure you want to delete entity <strong>{deleteTarget.name}</strong>?</p>
				{:else}
					<p>Are you sure you want to delete this relation?</p>
					<p style="font-size:0.8rem;color:var(--color-text-muted);margin-top:4px;">{deleteTarget?.name}</p>
				{/if}
			</div>
			<div class="modal-footer">
				<button class="btn btn-ghost btn-sm" on:click={cancelDelete}>Cancel</button>
				<button
					class="btn btn-sm"
					style="background:var(--color-danger);color:white;border:none;"
					on:click={confirmDelete}>Delete</button
				>
			</div>
		</div>
	{/if}

	<!-- Add Entity Modal -->
	{#if showAddEntityModal}
		<div
			class="modal-overlay"
			on:click={() => (showAddEntityModal = false)}
			on:keydown={(e) => e.key === "Escape" && (showAddEntityModal = false)}
			role="button"
			tabindex="0"
			aria-label="Close"
		></div>
		<div class="modal-panel animate-fade-in-scale" role="dialog" aria-label="Add entity">
			<div class="modal-header">
				<Icon name="plus" size={14} strokeWidth={1.75} />
				<span>Add Entity</span>
			</div>
			<div class="modal-body">
				<div class="form-group">
					<label class="form-label" for="entity-name">Name *</label>
					<input id="entity-name" class="form-input" type="text" bind:value={entityName} placeholder="Entity name" />
				</div>
				<div class="form-group">
					<label class="form-label" for="entity-type">Type</label>
					<select id="entity-type" class="form-select" bind:value={entityType}>
						<option value="person">Person</option>
						<option value="place">Place</option>
						<option value="organization">Organization</option>
						<option value="concept">Concept</option>
						<option value="unknown">Unknown</option>
					</select>
				</div>
				<div class="form-group">
					<label class="form-label" for="entity-desc">Description</label>
					<textarea
						id="entity-desc"
						class="form-textarea"
						bind:value={entityDesc}
						placeholder="Optional description"
						rows="2"
					></textarea>
				</div>
			</div>
			<div class="modal-footer">
				<button
					class="btn btn-ghost btn-sm"
					on:click={() => {
						showAddEntityModal = false;
					}}>Cancel</button
				>
				<button class="btn btn-primary btn-sm" on:click={addEntity} disabled={!entityName.trim()}>Create</button>
			</div>
		</div>
	{/if}

	<!-- Add Relation Modal -->
	{#if showAddRelationModal}
		<div
			class="modal-overlay"
			on:click={() => (showAddRelationModal = false)}
			on:keydown={(e) => e.key === "Escape" && (showAddRelationModal = false)}
			role="button"
			tabindex="0"
			aria-label="Close"
		></div>
		<div class="modal-panel animate-fade-in-scale" role="dialog" aria-label="Add relation">
			<div class="modal-header">
				<Icon name="link" size={14} strokeWidth={1.75} />
				<span>Add Relation</span>
			</div>
			<div class="modal-body">
				<div class="form-group">
					<label class="form-label" for="rel-from">From Entity *</label>
					<select id="rel-from" class="form-select" bind:value={relFrom}>
						<option value="">Select entity...</option>
						{#each layoutNodes as n (n.name)}
							<option value={n.name}>{n.name}</option>
						{/each}
					</select>
				</div>
				<div class="form-group">
					<label class="form-label" for="rel-to">To Entity *</label>
					<select id="rel-to" class="form-select" bind:value={relTo}>
						<option value="">Select entity...</option>
						{#each layoutNodes as n (n.name)}
							<option value={n.name}>{n.name}</option>
						{/each}
					</select>
				</div>
				<div class="form-group">
					<label class="form-label" for="rel-type">Relation Type *</label>
					<input
						id="rel-type"
						class="form-input"
						type="text"
						bind:value={relType}
						placeholder="e.g., knows, located_in, works_at"
					/>
				</div>
			</div>
			<div class="modal-footer">
				<button
					class="btn btn-ghost btn-sm"
					on:click={() => {
						showAddRelationModal = false;
					}}>Cancel</button
				>
				<button class="btn btn-primary btn-sm" on:click={addRelation} disabled={!relFrom || !relTo || !relType.trim()}
					>Create</button
				>
			</div>
		</div>
	{/if}
</div>

<style>
	.kg-container {
		display: flex;
		flex-direction: column;
		height: calc(100vh - 180px);
		border-radius: 24px;
		overflow: hidden;
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		box-shadow: var(--glass-shadow);
		backdrop-filter: var(--glass-blur);
		-webkit-backdrop-filter: var(--glass-blur);
	}

	:global(.dark) .kg-container {
		background: var(--panel-dark);
		border-color: var(--panel-dark-border);
		box-shadow: var(--panel-dark-shadow);
	}

	.kg-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
		border-bottom: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.05);
		flex-shrink: 0;
	}

	:global(.dark) .kg-toolbar {
		border-color: rgba(148, 163, 184, 0.1);
	}

	.kg-toolbar-left {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.kg-toolbar-right {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.kg-stats {
		font-size: 0.72rem;
		color: var(--color-text-muted);
		font-weight: 600;
	}

	.kg-canvas-wrap {
		flex: 1;
		overflow: hidden;
		position: relative;
	}

	.kg-canvas-wrap canvas {
		display: block;
		width: 100%;
		height: 100%;
	}

	.kg-error {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 16px;
		background: rgba(239, 68, 68, 0.08);
		color: var(--color-danger);
		font-size: 0.8rem;
		font-weight: 600;
		border-bottom: 1px solid rgba(239, 68, 68, 0.15);
	}

	.kg-loading,
	.kg-empty {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		color: var(--color-text-muted);
		font-size: 0.85rem;
	}

	.kg-empty :global(svg) {
		opacity: 0.3;
	}

	/* ─── Modal styles ──────────────────────────────────────────────────────── */
	.modal-overlay {
		position: fixed;
		inset: 0;
		background: rgba(1, 12, 30, 0.55);
		z-index: 60;
		backdrop-filter: blur(6px);
		-webkit-backdrop-filter: blur(6px);
	}

	.modal-panel {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		z-index: 61;
		background: var(--glass-bg-ultra);
		backdrop-filter: blur(28px) saturate(1.2);
		-webkit-backdrop-filter: blur(28px) saturate(1.2);
		border: 1px solid var(--glass-border);
		border-radius: 16px;
		box-shadow: var(--glass-shadow-elevated);
		width: min(400px, 90vw);
		max-height: 80vh;
		overflow-y: auto;
	}

	:global(.dark) .modal-panel {
		background: var(--panel-dark-ultra);
		border-color: var(--panel-dark-border);
		box-shadow: var(--panel-dark-shadow);
	}

	.modal-header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 16px 20px;
		font-weight: 800;
		font-size: 0.9rem;
		color: var(--color-text);
		border-bottom: 1px solid var(--color-border);
	}

	:global(.dark) .modal-header {
		border-color: rgba(148, 163, 184, 0.1);
	}

	.modal-body {
		padding: 16px 20px;
	}

	.modal-footer {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
		padding: 12px 20px;
		border-top: 1px solid var(--color-border);
	}

	:global(.dark) .modal-footer {
		border-color: rgba(148, 163, 184, 0.1);
	}

	.form-group {
		margin-bottom: 12px;
	}

	.form-label {
		display: block;
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
		margin-bottom: 4px;
	}
</style>
