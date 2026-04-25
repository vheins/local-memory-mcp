import type { ArenaScene, ArenaLayoutConfig } from './arenaTypes';
import { STATUS_COLORS, STATUS_ORDER, agentColor } from './arenaTransform';

const STATUS_LABELS: Record<string, string> = {
	backlog: 'Backlog',
	pending: 'Pending',
	in_progress: 'In Progress',
	blocked: 'Blocked',
	completed: 'Completed',
	canceled: 'Canceled'
};

const LERP = 0.07;
const TASK_W = 108;
const TASK_H = 38;
const AGENT_R = 16;
const MARGIN_X = 56;
const MARGIN_TOP = 46;

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
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

function colX(idx: number, canvasWidth: number): number {
	const n = STATUS_ORDER.length;
	const colW = (canvasWidth - MARGIN_X * 2) / n;
	return MARGIN_X + idx * colW + colW / 2;
}

export class ArenaRenderer {
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;
	private scene: ArenaScene | null = null;
	private layout: ArenaLayoutConfig | null = null;
	private isDark = false;
	private hoveredAgentId: string | null = null;
	private rafId = 0;
	private ts = 0;

	constructor(canvas: HTMLCanvasElement) {
		this.canvas = canvas;
		this.ctx = canvas.getContext('2d')!;
	}

	update(scene: ArenaScene, layout: ArenaLayoutConfig, isDark: boolean): void {
		this.scene = scene;
		this.layout = layout;
		this.isDark = isDark;
	}

	setHovered(id: string | null): void {
		this.hoveredAgentId = id;
	}

	start(): void {
		this.rafId = requestAnimationFrame(this.loop);
	}

	stop(): void {
		cancelAnimationFrame(this.rafId);
	}

	hitTestAgent(mx: number, my: number): string | null {
		if (!this.scene) return null;
		const R = AGENT_R + 4;
		for (const a of this.scene.agents.values()) {
			const dx = mx - a.x;
			const dy = my - a.y;
			if (dx * dx + dy * dy <= R * R) return a.id;
		}
		return null;
	}

	private loop = (ts: number): void => {
		this.ts = ts;
		this.interpolate();
		this.render();
		this.rafId = requestAnimationFrame(this.loop);
	};

	private interpolate(): void {
		if (!this.scene) return;
		for (const a of this.scene.agents.values()) {
			a.x = lerp(a.x, a.targetX, LERP);
			a.y = lerp(a.y, a.targetY, LERP);
		}
	}

	private render(): void {
		const { canvas, ctx, scene, layout, isDark, ts } = this;
		if (!layout) return;

		ctx.clearRect(0, 0, canvas.width, canvas.height);

		const bg = isDark ? '#0c1120' : '#f1f5f9';
		ctx.fillStyle = bg;
		ctx.fillRect(0, 0, canvas.width, canvas.height);

		this.drawGrid(isDark);
		this.drawColumns(isDark);

		if (!scene) {
			return;
		}

		this.drawClaimLinks(scene, isDark);
		this.drawHandoffBeams(scene, ts);
		this.drawTasks(scene, isDark);
		this.drawAgents(scene, isDark, ts);
	}

	private drawGrid(isDark: boolean): void {
		const { ctx, canvas } = this;
		const c = isDark ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.04)';
		ctx.fillStyle = c;
		const sp = 22;
		for (let x = 0; x <= canvas.width; x += sp) {
			for (let y = 0; y <= canvas.height; y += sp) {
				ctx.beginPath();
				ctx.arc(x, y, 1, 0, Math.PI * 2);
				ctx.fill();
			}
		}
	}

	private drawColumns(isDark: boolean): void {
		const { ctx, canvas } = this;
		const n = STATUS_ORDER.length;
		const colW = (canvas.width - MARGIN_X * 2) / n;
		const sepC = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';

		STATUS_ORDER.forEach((status, idx) => {
			const cx = colX(idx, canvas.width);

			// Column separator
			if (idx > 0) {
				ctx.strokeStyle = sepC;
				ctx.lineWidth = 1;
				ctx.beginPath();
				ctx.moveTo(cx - colW / 2, MARGIN_TOP - 10);
				ctx.lineTo(cx - colW / 2, canvas.height - 10);
				ctx.stroke();
			}

			// Status badge
			const color = STATUS_COLORS[status] ?? '#64748b';
			const label = STATUS_LABELS[status] ?? status;
			const badgeW = Math.min(86, colW - 12);
			const badgeH = 20;
			const bx = cx - badgeW / 2;
			const by = 12;

			ctx.fillStyle = color + '28';
			roundRect(ctx, bx, by, badgeW, badgeH, 6);
			ctx.fill();

			ctx.strokeStyle = color + '55';
			ctx.lineWidth = 1;
			roundRect(ctx, bx, by, badgeW, badgeH, 6);
			ctx.stroke();

			ctx.fillStyle = color;
			ctx.font = 'bold 9px system-ui,sans-serif';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText(label, cx, by + badgeH / 2);
		});
	}

	private drawClaimLinks(scene: ArenaScene, isDark: boolean): void {
		const { ctx } = this;
		for (const agent of scene.agents.values()) {
			for (const tid of agent.claimedTaskIds) {
				const task = scene.tasks.get(tid);
				if (!task) continue;
				const grad = ctx.createLinearGradient(agent.x, agent.y, task.x, task.y);
				grad.addColorStop(0, agent.color + 'aa');
				grad.addColorStop(1, (STATUS_COLORS[task.status] ?? '#64748b') + '44');
				ctx.strokeStyle = grad;
				ctx.lineWidth = 1.5;
				ctx.setLineDash([5, 4]);
				ctx.beginPath();
				ctx.moveTo(agent.x, agent.y);
				ctx.lineTo(task.x, task.y);
				ctx.stroke();
			}
		}
		ctx.setLineDash([]);
	}

	private drawHandoffBeams(scene: ArenaScene, ts: number): void {
		const { ctx } = this;
		for (const h of scene.handoffs) {
			const from = scene.agents.get(h.fromAgentId);
			if (!from) continue;

			let toX: number;
			let toY: number;

			if (h.toAgentId) {
				const to = scene.agents.get(h.toAgentId);
				if (!to) continue;
				toX = to.x;
				toY = to.y;
			} else if (h.taskId) {
				const task = scene.tasks.get(h.taskId);
				if (!task) continue;
				toX = task.x;
				toY = task.y;
			} else {
				continue;
			}

			// Animated dashed beam
			ctx.strokeStyle = '#f59e0b88';
			ctx.lineWidth = 2;
			ctx.setLineDash([6, 4]);
			ctx.lineDashOffset = -(ts * 0.05) % 10;
			ctx.beginPath();
			ctx.moveTo(from.x, from.y);
			ctx.lineTo(toX, toY);
			ctx.stroke();
			ctx.setLineDash([]);
			ctx.lineDashOffset = 0;

			// Travelling particle
			const t = (ts % 1600) / 1600;
			const px = lerp(from.x, toX, t);
			const py = lerp(from.y, toY, t);
			ctx.fillStyle = '#f59e0b';
			ctx.beginPath();
			ctx.arc(px, py, 3.5, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	private drawTasks(scene: ArenaScene, isDark: boolean): void {
		const { ctx } = this;
		const tw = TASK_W;
		const th = TASK_H;

		for (const task of scene.tasks.values()) {
			const color = STATUS_COLORS[task.status] ?? '#64748b';
			const x = task.x - tw / 2;
			const y = task.y - th / 2;
			const claimed = !!task.claimedByAgentId;

			// Shadow for claimed tasks
			if (claimed) {
				ctx.shadowColor = color + '55';
				ctx.shadowBlur = 10;
			}

			ctx.fillStyle = isDark ? color + '22' : color + '1a';
			ctx.strokeStyle = color + (claimed ? 'cc' : '44');
			ctx.lineWidth = claimed ? 1.5 : 1;
			roundRect(ctx, x, y, tw, th, 8);
			ctx.fill();
			ctx.stroke();
			ctx.shadowBlur = 0;

			// Handoff dot
			if (task.hasPendingHandoff) {
				ctx.fillStyle = '#f59e0b';
				ctx.beginPath();
				ctx.arc(x + tw - 6, y + 6, 4, 0, Math.PI * 2);
				ctx.fill();
			}

			const textPrimary = isDark ? 'rgba(226,232,240,0.92)' : 'rgba(15,23,42,0.88)';
			const textMuted = isDark ? 'rgba(148,163,184,0.75)' : 'rgba(71,85,105,0.75)';

			// Code label (short: repo:code)
			const codeLabel = `${task.repo.split('/').pop()}·${task.taskCode}`;
			ctx.fillStyle = textPrimary;
			ctx.font = 'bold 8.5px system-ui,sans-serif';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText(codeLabel.slice(0, 18), task.x, task.y - 7);

			// Title
			ctx.fillStyle = textMuted;
			ctx.font = '8px system-ui,sans-serif';
			const title = task.title.length > 15 ? task.title.slice(0, 15) + '…' : task.title;
			ctx.fillText(title, task.x, task.y + 7);
		}
	}

	private drawAgents(scene: ArenaScene, isDark: boolean, ts: number): void {
		const { ctx, hoveredAgentId } = this;

		for (const agent of scene.agents.values()) {
			const hovered = agent.id === hoveredAgentId;
			const working = agent.state === 'processing' || agent.state === 'claiming';

			// Working pulse ring
			if (working) {
				const pulse = 0.5 + 0.5 * Math.sin(ts * 0.0028);
				const alpha = Math.round((pulse * 80 + 30)).toString(16).padStart(2, '0');
				ctx.strokeStyle = agent.color + alpha;
				ctx.lineWidth = 2;
				ctx.beginPath();
				ctx.arc(agent.x, agent.y, AGENT_R + 5 + pulse * 3, 0, Math.PI * 2);
				ctx.stroke();
			}

			// Hover ring
			if (hovered) {
				ctx.strokeStyle = agent.color;
				ctx.lineWidth = 2.5;
				ctx.beginPath();
				ctx.arc(agent.x, agent.y, AGENT_R + 5, 0, Math.PI * 2);
				ctx.stroke();
			}

			// Circle fill (radial gradient)
			const grad = ctx.createRadialGradient(agent.x - 4, agent.y - 4, 2, agent.x, agent.y, AGENT_R);
			grad.addColorStop(0, agent.color + 'ff');
			grad.addColorStop(1, agent.color + 'cc');
			ctx.fillStyle = grad;
			ctx.beginPath();
			ctx.arc(agent.x, agent.y, AGENT_R, 0, Math.PI * 2);
			ctx.fill();

			// Initials
			const initials = agent.name
				.split(/[-_.\s]+/)
				.slice(0, 2)
				.map((s: string) => (s[0] ?? '').toUpperCase())
				.join('');
			ctx.fillStyle = 'rgba(255,255,255,0.95)';
			ctx.font = `bold ${initials.length > 1 ? '8.5' : '11'}px system-ui,sans-serif`;
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText(initials || '?', agent.x, agent.y);

			// Name label below
			const nameLabel = agent.name.length > 14 ? agent.name.slice(0, 14) + '…' : agent.name;
			ctx.fillStyle = isDark ? 'rgba(226,232,240,0.8)' : 'rgba(15,23,42,0.75)';
			ctx.font = 'bold 8px system-ui,sans-serif';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'top';
			ctx.fillText(nameLabel, agent.x, agent.y + AGENT_R + 3);
		}
	}
}
