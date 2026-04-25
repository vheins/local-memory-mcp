import type { ArenaScene, ArenaLayoutConfig, ZoneRect, AgentFacing, AgentState, VisualAgent } from './arenaTypes';
import { STATUS_COLORS, computeZones } from './arenaTransform';

// ─── Motion constants ────────────────────────────────────────────────────────
const SPEED_WALK = 80;      // px/sec when heading to task
const SPEED_WANDER = 48;    // px/sec when idle
const ARRIVE_DIST = 6;      // px – consider "arrived" within this distance
const WANDER_INTERVAL = [2500, 4500]; // ms range between wander target picks
const WANDER_PAUSE = [800, 1800];    // ms pause at wander target

// ─── Drawing constants ───────────────────────────────────────────────────────
const TILE_SIZE = 28;
const ZONE_LABEL_H = 22;
const DESK_W = 46;
const DESK_H = 14;
const SCREEN_W = 32;
const SCREEN_H = 18;
const AGENT_HEAD_R = 9;

// ─── Color helpers ───────────────────────────────────────────────────────────
function hexToRgb(hex: string): [number, number, number] {
	const n = parseInt(hex.slice(1), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lighten(hex: string, a: number): string {
	const [r, g, b] = hexToRgb(hex);
	return `rgb(${Math.min(255, r + a)},${Math.min(255, g + a)},${Math.min(255, b + a)})`;
}
function darken(hex: string, a: number): string {
	const [r, g, b] = hexToRgb(hex);
	return `rgb(${Math.max(0, r - a)},${Math.max(0, g - a)},${Math.max(0, b - a)})`;
}

// ─── Canvas helpers ──────────────────────────────────────────────────────────
function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
	r = Math.min(r, w / 2, h / 2);
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.lineTo(x + w - r, y);
	ctx.arcTo(x + w, y, x + w, y + r, r);
	ctx.lineTo(x + w, y + h - r);
	ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
	ctx.lineTo(x + r, y + h);
	ctx.arcTo(x, y + h, x, y + h - r, r);
	ctx.lineTo(x, y + r);
	ctx.arcTo(x, y, x + r, y, r);
	ctx.closePath();
}

// ─── Wander state (renderer-local) ───────────────────────────────────────────
interface WanderState {
	nextPickAt: number;   // timestamp when to pick next target
	pausing: boolean;
}

// ─── Renderer class ──────────────────────────────────────────────────────────
export class ArenaRenderer {
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;
	private scene: ArenaScene | null = null;
	private layout: ArenaLayoutConfig | null = null;
	private isDark = false;
	private hoveredId: string | null = null;
	private rafId = 0;
	private ts = 0;
	private prevTs = 0;
	private wander = new Map<string, WanderState>();

	constructor(canvas: HTMLCanvasElement) {
		this.canvas = canvas;
		this.ctx = canvas.getContext('2d')!;
	}

	update(scene: ArenaScene, layout: ArenaLayoutConfig, isDark: boolean): void {
		this.scene = scene;
		this.layout = layout;
		this.isDark = isDark;
	}

	setHovered(id: string | null): void { this.hoveredId = id; }

	start(): void { this.rafId = requestAnimationFrame(this.loop); }
	stop(): void { cancelAnimationFrame(this.rafId); }

	hitTestAgent(mx: number, my: number): string | null {
		if (!this.scene) return null;
		for (const a of this.scene.agents.values()) {
			const dx = mx - a.x, dy = my - a.y;
			if (dx * dx + dy * dy <= (AGENT_HEAD_R + 6) * (AGENT_HEAD_R + 6)) return a.id;
		}
		return null;
	}

	// ── Main loop ─────────────────────────────────────────────────────────────
	private loop = (ts: number): void => {
		const dt = Math.min((ts - this.prevTs) / 1000, 0.05);
		this.prevTs = ts;
		this.ts = ts;

		if (this.scene && this.layout) {
			const zones = computeZones(this.layout.canvasWidth, this.layout.canvasHeight);
			const idleZone = zones.find((z) => z.id === 'idle')!;
			this.updateAgents(dt, idleZone, ts);
		}
		this.render();
		this.rafId = requestAnimationFrame(this.loop);
	};

	// ── Physics / wander update ───────────────────────────────────────────────
	private updateAgents(dt: number, idleZone: ZoneRect, ts: number): void {
		if (!this.scene) return;

		for (const agent of this.scene.agents.values()) {
			// --- Wander target for idle agents ---
			if (agent.state === 'idle') {
				let ws = this.wander.get(agent.id);
				if (!ws) {
					ws = { nextPickAt: ts, pausing: false };
					this.wander.set(agent.id, ws);
				}
				if (ts >= ws.nextPickAt) {
					// Pick a random point inside the idle zone (with padding)
					const pad = 20;
					agent.targetX = idleZone.x + pad + Math.random() * (idleZone.w - pad * 2);
					agent.targetY = idleZone.y + ZONE_LABEL_H + pad + Math.random() * (idleZone.h - ZONE_LABEL_H - pad * 2);
					const pause = WANDER_PAUSE[0] + Math.random() * (WANDER_PAUSE[1] - WANDER_PAUSE[0]);
					const travel = WANDER_INTERVAL[0] + Math.random() * (WANDER_INTERVAL[1] - WANDER_INTERVAL[0]);
					ws.nextPickAt = ts + pause + travel;
				}
			} else {
				this.wander.delete(agent.id);
			}

			// --- Velocity-based movement ---
			const dx = agent.targetX - agent.x;
			const dy = agent.targetY - agent.y;
			const dist = Math.sqrt(dx * dx + dy * dy);

			if (dist < ARRIVE_DIST) {
				agent.vx *= 0.8;
				agent.vy *= 0.8;
				if (Math.abs(agent.vx) < 0.5) agent.vx = 0;
				if (Math.abs(agent.vy) < 0.5) agent.vy = 0;
			} else {
				const speed = agent.state === 'idle' ? SPEED_WANDER : SPEED_WALK;
				// Ease in/out: slow near start and end
				const eased = dist < 40 ? speed * (dist / 40) + 8 : speed;
				const nx = dx / dist;
				const ny = dy / dist;
				const tvx = nx * eased;
				const tvy = ny * eased;
				// Smooth steering
				agent.vx += (tvx - agent.vx) * 0.12;
				agent.vy += (tvy - agent.vy) * 0.12;
			}

			agent.x += agent.vx * dt;
			agent.y += agent.vy * dt;

			// --- Walk phase & facing ---
			const spd = Math.sqrt(agent.vx * agent.vx + agent.vy * agent.vy);
			if (spd > 4) {
				agent.walkPhase = (agent.walkPhase + dt * (spd * 0.065)) % (Math.PI * 2);
				// Determine facing from velocity direction
				if (Math.abs(agent.vx) > Math.abs(agent.vy)) {
					agent.facing = agent.vx > 0 ? 'right' : 'left';
				} else {
					agent.facing = agent.vy > 0 ? 'down' : 'up';
				}
			} else {
				// Gradually ease walk phase back to 0 (standing pose)
				if (agent.walkPhase !== 0) {
					agent.walkPhase *= 0.85;
					if (agent.walkPhase < 0.05) agent.walkPhase = 0;
				}
			}
		}
	}

	// ── Render ────────────────────────────────────────────────────────────────
	private render(): void {
		const { canvas, ctx, scene, layout, isDark, ts } = this;
		if (!layout) return;

		const zones = computeZones(layout.canvasWidth, layout.canvasHeight);

		ctx.clearRect(0, 0, canvas.width, canvas.height);

		this.drawFloor(isDark);
		this.drawZones(zones, isDark);

		if (!scene) return;

		this.drawWorkstations(scene, isDark);
		this.drawClaimLinks(scene, ts);
		this.drawHandoffBeams(scene, ts);
		this.drawAgents(scene, isDark, ts);
	}

	// ── Floor tiles ───────────────────────────────────────────────────────────
	private drawFloor(isDark: boolean): void {
		const { ctx, canvas } = this;
		// Base floor color
		ctx.fillStyle = isDark ? '#0d1117' : '#f0f4f8';
		ctx.fillRect(0, 0, canvas.width, canvas.height);

		// Tile grid (subtle checkerboard)
		const a = isDark ? 0.025 : 0.04;
		for (let tx = 0; tx < canvas.width; tx += TILE_SIZE) {
			for (let ty = 0; ty < canvas.height; ty += TILE_SIZE) {
				const even = ((tx / TILE_SIZE + ty / TILE_SIZE) % 2 === 0);
				ctx.fillStyle = even
					? `rgba(255,255,255,${a})`
					: `rgba(0,0,0,${a * 0.6})`;
				ctx.fillRect(tx, ty, TILE_SIZE, TILE_SIZE);
			}
		}

		// Tile border lines (very faint)
		ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.015)' : 'rgba(0,0,0,0.025)';
		ctx.lineWidth = 0.5;
		for (let tx = 0; tx <= canvas.width; tx += TILE_SIZE) {
			ctx.beginPath(); ctx.moveTo(tx, 0); ctx.lineTo(tx, canvas.height); ctx.stroke();
		}
		for (let ty = 0; ty <= canvas.height; ty += TILE_SIZE) {
			ctx.beginPath(); ctx.moveTo(0, ty); ctx.lineTo(canvas.width, ty); ctx.stroke();
		}
	}

	// ── Zone rooms ────────────────────────────────────────────────────────────
	private drawZones(zones: ZoneRect[], isDark: boolean): void {
		const { ctx } = this;

		for (const zone of zones) {
			const { x, y, w, h, color, label, id } = zone;

			// Carpet / room floor overlay
			const carpetAlpha = isDark ? 0.07 : 0.06;
			ctx.fillStyle = `rgba(${hexToRgb(color).join(',')},${carpetAlpha})`;
			rr(ctx, x, y, w, h, 12);
			ctx.fill();

			// Room carpet texture: subtle diagonal lines
			ctx.save();
			ctx.beginPath();
			rr(ctx, x, y, w, h, 12);
			ctx.clip();
			ctx.strokeStyle = `rgba(${hexToRgb(color).join(',')},${isDark ? 0.04 : 0.035})`;
			ctx.lineWidth = 1;
			const diag = 16;
			for (let d = -h; d < w + h; d += diag) {
				ctx.beginPath();
				ctx.moveTo(x + d, y);
				ctx.lineTo(x + d + h, y + h);
				ctx.stroke();
			}
			ctx.restore();

			// Room border (wall)
			ctx.strokeStyle = `rgba(${hexToRgb(color).join(',')},${isDark ? 0.35 : 0.28})`;
			ctx.lineWidth = 1.5;
			rr(ctx, x, y, w, h, 12);
			ctx.stroke();

			// Zone label badge
			const badgeW = Math.min(w - 16, 80);
			const badgeX = x + 10;
			const badgeY = y + 6;

			ctx.fillStyle = color + (isDark ? '30' : '22');
			rr(ctx, badgeX, badgeY, badgeW, ZONE_LABEL_H - 2, 6);
			ctx.fill();
			ctx.strokeStyle = color + '55';
			ctx.lineWidth = 1;
			rr(ctx, badgeX, badgeY, badgeW, ZONE_LABEL_H - 2, 6);
			ctx.stroke();

			ctx.fillStyle = color;
			ctx.font = 'bold 9px system-ui,sans-serif';
			ctx.textAlign = 'left';
			ctx.textBaseline = 'middle';
			ctx.fillText(label.toUpperCase(), badgeX + 7, badgeY + (ZONE_LABEL_H - 2) / 2);

			// Lobby decorations: small plants
			if (id === 'idle') {
				this.drawPlant(ctx, x + w - 14, y + h - 14, isDark);
				this.drawPlant(ctx, x + 14, y + h - 14, isDark);
				this.drawPlant(ctx, x + w - 14, y + ZONE_LABEL_H + 14, isDark);
			}
		}
	}

	// ── Decorative plant ─────────────────────────────────────────────────────
	private drawPlant(ctx: CanvasRenderingContext2D, x: number, y: number, isDark: boolean): void {
		// Pot
		ctx.fillStyle = isDark ? '#3d2b1a' : '#c4a278';
		rr(ctx, x - 5, y - 4, 10, 8, 3);
		ctx.fill();
		// Leaves
		const leafColors = ['#16a34a', '#15803d', '#22c55e'];
		[[-4, -10], [0, -12], [4, -10], [-6, -7], [6, -7]].forEach(([lx, ly], i) => {
			ctx.fillStyle = leafColors[i % 3];
			ctx.beginPath();
			ctx.ellipse(x + lx, y + ly, 4, 3, (i * 0.5) - 0.5, 0, Math.PI * 2);
			ctx.fill();
		});
	}

	// ── Workstations (desks + computers) ─────────────────────────────────────
	private drawWorkstations(scene: ArenaScene, isDark: boolean): void {
		const { ctx } = this;

		for (const task of scene.tasks.values()) {
			const { x, y, status, taskCode, title, claimedByAgentId, hasPendingHandoff, repo } = task;
			const color = STATUS_COLORS[status] ?? '#64748b';
			const active = !!claimedByAgentId;

			// Desk shadow
			ctx.fillStyle = 'rgba(0,0,0,0.12)';
			rr(ctx, x - DESK_W / 2 + 3, y + DESK_H / 2 - DESK_H / 2 + 3, DESK_W, DESK_H + 2, 4);
			ctx.fill();

			// Desk surface
			ctx.fillStyle = isDark ? '#1e2535' : '#dde3ed';
			rr(ctx, x - DESK_W / 2, y - DESK_H / 2, DESK_W, DESK_H, 4);
			ctx.fill();
			ctx.strokeStyle = isDark ? '#2d3748' : '#b0bac8';
			ctx.lineWidth = 1;
			rr(ctx, x - DESK_W / 2, y - DESK_H / 2, DESK_W, DESK_H, 4);
			ctx.stroke();

			// Monitor stand
			ctx.fillStyle = isDark ? '#374151' : '#9ca3af';
			ctx.fillRect(x - 1.5, y - DESK_H / 2 - 6, 3, 7);

			// Monitor body
			const monY = y - DESK_H / 2 - SCREEN_H - 5;
			ctx.fillStyle = isDark ? '#111827' : '#1f2937';
			rr(ctx, x - SCREEN_W / 2 - 2, monY - 2, SCREEN_W + 4, SCREEN_H + 4, 4);
			ctx.fill();

			// Screen (active = color glow, inactive = dark)
			if (active) {
				const grad = ctx.createLinearGradient(x - SCREEN_W / 2, monY, x + SCREEN_W / 2, monY + SCREEN_H);
				grad.addColorStop(0, lighten(color, 40));
				grad.addColorStop(1, color);
				ctx.fillStyle = grad;
			} else {
				ctx.fillStyle = isDark ? '#1a2030' : '#2d3748';
			}
			rr(ctx, x - SCREEN_W / 2, monY, SCREEN_W, SCREEN_H, 3);
			ctx.fill();

			// Screen glow (when active)
			if (active) {
				ctx.shadowColor = color + 'aa';
				ctx.shadowBlur = 8;
				rr(ctx, x - SCREEN_W / 2, monY, SCREEN_W, SCREEN_H, 3);
				ctx.stroke();
				ctx.shadowBlur = 0;
			}

			// Screen reflection highlight
			ctx.fillStyle = 'rgba(255,255,255,0.14)';
			rr(ctx, x - SCREEN_W / 2, monY, SCREEN_W, SCREEN_H / 2.5, 3);
			ctx.fill();

			// Task code on screen
			ctx.fillStyle = active ? 'rgba(255,255,255,0.92)' : (isDark ? '#374151' : '#6b7280');
			ctx.font = `bold 6px monospace`;
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			const label = `${repo.split('/').pop()?.slice(0, 5)}·${taskCode}`.slice(0, 11);
			ctx.fillText(label, x, monY + SCREEN_H / 2 - 2);

			// Title on desk
			const textColor = isDark ? 'rgba(148,163,184,0.7)' : 'rgba(71,85,105,0.8)';
			ctx.fillStyle = textColor;
			ctx.font = '5.5px system-ui,sans-serif';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText(title.slice(0, 10), x, y + 1);

			// Handoff dot (orange badge on screen corner)
			if (hasPendingHandoff) {
				ctx.fillStyle = '#f59e0b';
				ctx.beginPath();
				ctx.arc(x + SCREEN_W / 2 - 1, monY - 1, 3.5, 0, Math.PI * 2);
				ctx.fill();
			}
		}
	}

	// ── Claim links (agent ↔ workstation) ────────────────────────────────────
	private drawClaimLinks(scene: ArenaScene, ts: number): void {
		const { ctx } = this;

		for (const agent of scene.agents.values()) {
			for (const tid of agent.claimedTaskIds) {
				const task = scene.tasks.get(tid);
				if (!task) continue;

				const grad = ctx.createLinearGradient(agent.x, agent.y, task.x, task.y);
				grad.addColorStop(0, agent.color + 'bb');
				grad.addColorStop(1, (STATUS_COLORS[task.status] ?? '#64748b') + '44');

				ctx.strokeStyle = grad;
				ctx.lineWidth = 1.5;
				ctx.setLineDash([4, 5]);
				ctx.lineDashOffset = -(ts * 0.02) % 9;
				ctx.beginPath();
				ctx.moveTo(agent.x, agent.y);
				ctx.lineTo(task.x, task.y);
				ctx.stroke();
			}
		}
		ctx.setLineDash([]);
		ctx.lineDashOffset = 0;
	}

	// ── Handoff beams ─────────────────────────────────────────────────────────
	private drawHandoffBeams(scene: ArenaScene, ts: number): void {
		const { ctx } = this;

		for (const h of scene.handoffs) {
			const from = scene.agents.get(h.fromAgentId);
			if (!from) continue;
			let toX: number, toY: number;

			if (h.toAgentId) {
				const to = scene.agents.get(h.toAgentId);
				if (!to) continue;
				toX = to.x; toY = to.y;
			} else if (h.taskId) {
				const t = scene.tasks.get(h.taskId);
				if (!t) continue;
				toX = t.x; toY = t.y;
			} else continue;

			// Animated gold beam
			ctx.strokeStyle = '#f59e0b77';
			ctx.lineWidth = 2;
			ctx.setLineDash([7, 5]);
			ctx.lineDashOffset = -(ts * 0.06) % 12;
			ctx.beginPath();
			ctx.moveTo(from.x, from.y);
			ctx.lineTo(toX, toY);
			ctx.stroke();
			ctx.setLineDash([]);
			ctx.lineDashOffset = 0;

			// Travelling particle
			const t = (ts % 1400) / 1400;
			const px = from.x + (toX - from.x) * t;
			const py = from.y + (toY - from.y) * t;
			ctx.fillStyle = '#f59e0b';
			ctx.shadowColor = '#f59e0b';
			ctx.shadowBlur = 6;
			ctx.beginPath();
			ctx.arc(px, py, 3.5, 0, Math.PI * 2);
			ctx.fill();
			ctx.shadowBlur = 0;
		}
	}

	// ── Agent characters (pixel RPG style) ───────────────────────────────────
	private drawAgents(scene: ArenaScene, isDark: boolean, ts: number): void {
		// Draw all agents, hovered last so tooltip ring is on top
		const sorted = Array.from(scene.agents.values()).sort((a, b) =>
			a.y - b.y || (a.id === this.hoveredId ? 1 : 0) - (b.id === this.hoveredId ? 1 : 0)
		);
		for (const agent of sorted) {
			this.drawCharacter(agent, isDark, ts);
		}
	}

	private drawCharacter(agent: VisualAgent, isDark: boolean, ts: number): void {
		const { ctx } = this;
		const { x, y, color, walkPhase, facing, state, name, id } = agent;
		const hovered = id === this.hoveredId;
		const spd = Math.sqrt(agent.vx * agent.vx + agent.vy * agent.vy);
		const moving = spd > 4;

		// ── Ground shadow ──
		ctx.fillStyle = 'rgba(0,0,0,0.14)';
		ctx.beginPath();
		ctx.ellipse(x, y + 3, 10, 5, 0, 0, Math.PI * 2);
		ctx.fill();

		const mirrorX = facing === 'left' ? -1 : 1;
		ctx.save();
		ctx.translate(x, y);
		ctx.scale(mirrorX, 1);

		// ── Legs ──
		const legSwing = moving ? Math.sin(walkPhase) * 5 : 0;
		const pantColor = darken(color, 50);

		// Left leg
		ctx.fillStyle = pantColor;
		ctx.save();
		ctx.translate(-3.5, 0);
		ctx.rotate(legSwing * 0.09);
		rr(ctx, -2, -2, 4, 9, 2);
		ctx.fill();
		ctx.restore();

		// Right leg
		ctx.fillStyle = pantColor;
		ctx.save();
		ctx.translate(3.5, 0);
		ctx.rotate(-legSwing * 0.09);
		rr(ctx, -2, -2, 4, 9, 2);
		ctx.fill();
		ctx.restore();

		// ── Body ──
		const bodyGrad = ctx.createLinearGradient(-6, -18, 6, -8);
		bodyGrad.addColorStop(0, lighten(color, 25));
		bodyGrad.addColorStop(1, color);
		ctx.fillStyle = bodyGrad;
		rr(ctx, -6, -18, 12, 11, 3);
		ctx.fill();

		// Shirt stripe / detail
		ctx.fillStyle = 'rgba(255,255,255,0.15)';
		rr(ctx, -5, -17, 10, 4, 2);
		ctx.fill();

		// ── Head (with slight bob when walking) ──
		const bob = moving ? Math.sin(walkPhase * 2) * 1.2 : 0;
		const hy = -26 + bob;

		ctx.restore(); // restore before drawing head (no mirror for text)
		ctx.save();
		ctx.translate(x, y);

		// Head shadow
		ctx.fillStyle = 'rgba(0,0,0,0.2)';
		ctx.beginPath();
		ctx.ellipse(1, hy + 2, AGENT_HEAD_R, AGENT_HEAD_R * 0.6, 0, 0, Math.PI * 2);
		ctx.fill();

		// Head circle
		const headGrad = ctx.createRadialGradient(-3, hy - 3, 2, 0, hy, AGENT_HEAD_R);
		headGrad.addColorStop(0, lighten(color, 35));
		headGrad.addColorStop(1, color);
		ctx.fillStyle = headGrad;
		ctx.beginPath();
		ctx.arc(0, hy, AGENT_HEAD_R, 0, Math.PI * 2);
		ctx.fill();

		// Initials
		const ini = name.split(/[-_.\s@]+/).slice(0, 2).map((s: string) => (s[0] ?? '').toUpperCase()).join('');
		ctx.fillStyle = 'rgba(255,255,255,0.96)';
		ctx.font = `bold ${ini.length > 1 ? '7' : '9'}px system-ui,sans-serif`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(ini || '?', 0, hy);

		// ── State indicator dot (top-right of head) ──
		if (state !== 'idle') {
			const dotColor =
				state === 'processing' ? '#a855f7' :
				state === 'claiming' ? '#0ea5e9' : '#f59e0b';
			ctx.fillStyle = dotColor;
			ctx.shadowColor = dotColor;
			ctx.shadowBlur = 5;
			ctx.beginPath();
			ctx.arc(AGENT_HEAD_R - 1, hy - AGENT_HEAD_R + 1, 3.5, 0, Math.PI * 2);
			ctx.fill();
			ctx.shadowBlur = 0;
		}

		// ── Working thought bubble (when processing) ──
		if (state === 'processing') {
			const pulse = 0.5 + 0.5 * Math.sin(ts * 0.003);
			const alpha = Math.round(30 + pulse * 60).toString(16).padStart(2, '0');
			ctx.strokeStyle = color + alpha;
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			ctx.arc(0, hy, AGENT_HEAD_R + 5 + pulse * 3, 0, Math.PI * 2);
			ctx.stroke();

			// Tiny ellipsis bubbles (chat-style)
			for (let i = 0; i < 3; i++) {
				const bx = -4 + i * 4;
				const by = hy - AGENT_HEAD_R - 8;
				const bPulse = 0.4 + 0.6 * Math.sin(ts * 0.004 + i * 0.8);
				ctx.fillStyle = color + Math.round(bPulse * 200).toString(16).padStart(2, '0');
				ctx.beginPath();
				ctx.arc(bx, by, 1.5 + bPulse * 0.8, 0, Math.PI * 2);
				ctx.fill();
			}
		}

		// ── Hover ring ──
		if (hovered) {
			ctx.strokeStyle = color;
			ctx.lineWidth = 2;
			ctx.setLineDash([3, 3]);
			ctx.beginPath();
			ctx.arc(0, hy, AGENT_HEAD_R + 7, 0, Math.PI * 2);
			ctx.stroke();
			ctx.setLineDash([]);
		}

		// ── Name label ──
		const nameStr = name.length > 13 ? name.slice(0, 13) + '…' : name;
		ctx.fillStyle = isDark ? 'rgba(226,232,240,0.82)' : 'rgba(15,23,42,0.72)';
		ctx.font = '7px system-ui,sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'top';
		ctx.fillText(nameStr, 0, 12);

		ctx.restore();
	}
}
