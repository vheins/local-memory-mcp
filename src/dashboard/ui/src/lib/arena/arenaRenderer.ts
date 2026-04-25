import type { ArenaScene, ArenaLayoutConfig, ZoneRect, AgentFacing, VisualAgent, VisualTask } from './arenaTypes';
import { STATUS_COLORS, computeZones } from './arenaTransform';

// ─── Motion ────────────────────────────────────────────────────────────────
const SPEED_WALK   = 85;
const SPEED_WANDER = 50;
const ARRIVE_DIST  = 6;
const WANDER_INT   : [number, number] = [2800, 5000];
const WANDER_PAUSE : [number, number] = [600, 1600];

// ─── Color helpers ─────────────────────────────────────────────────────────
function h2r(hex: string): [number, number, number] {
	if (!hex) return [0, 0, 0];
	let s = hex.replace('#', '');
	if (s.length === 3) s = s[0]+s[0]+s[1]+s[1]+s[2]+s[2];
	else if (s.length === 8) s = s.slice(0, 6);
	const n = parseInt(s, 16);
	return [(n>>16)&255,(n>>8)&255,n&255];
}
function lighten(hex: string, amt: number) {
	const [r,g,b] = h2r(hex);
	return `rgb(${Math.min(255,r+amt)},${Math.min(255,g+amt)},${Math.min(255,b+amt)})`;
}
function darken(hex: string, amt: number) {
	const [r,g,b] = h2r(hex);
	return `rgb(${Math.max(0,r-amt)},${Math.max(0,g-amt)},${Math.max(0,b-amt)})`;
}
function rgba(hex: string, a: number) {
	const [r,g,b] = h2r(hex);
	return `rgba(${r},${g},${b},${a})`;
}
function strHash(s: string): number {
	let h = 5381;
	for (let i = 0; i < s.length; i++) h = ((h<<5)+h+s.charCodeAt(i))>>>0;
	return h;
}
// deterministic per-cell noise [0,1]
function tileNoise(x: number, y: number): number {
	return Math.abs(Math.sin(x * 127.1 + y * 311.7) * 43758.5453) % 1;
}

// ─── Canvas helpers ────────────────────────────────────────────────────────
function rr(ctx: CanvasRenderingContext2D, x:number,y:number,w:number,h:number,r:number) {
	r = Math.min(r, w/2, h/2);
	ctx.beginPath();
	ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.arcTo(x+w,y,x+w,y+r,r);
	ctx.lineTo(x+w,y+h-r); ctx.arcTo(x+w,y+h,x+w-r,y+h,r);
	ctx.lineTo(x+r,y+h); ctx.arcTo(x,y+h,x,y+h-r,r);
	ctx.lineTo(x,y+r); ctx.arcTo(x,y,x+r,y,r);
	ctx.closePath();
}

// ─── Agent styling tables ──────────────────────────────────────────────────
const HAIR_COLORS = ['#1a0a00','#2d1a00','#0f0f0f','#4a2d00','#8B4513','#d4a800','#c0392b','#7b2d8b','#1a3a5c','#2d4a1a'];
const SKIN_TONES  = ['#f5c89a','#e8a870','#d4875a','#c06840','#8B5e3c','#6b3d28'];
const PANT_COLORS = ['#1e3a5f','#2d4a1a','#3d2a1a','#2a1a3d','#1a3d3d','#3d1a2a','#2a2a3d'];

// ─── Wander state ──────────────────────────────────────────────────────────
interface WanderState { nextPickAt: number }

// ══════════════════════════════════════════════════════════════════════════════
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

	update(scene: ArenaScene, layout: ArenaLayoutConfig, isDark: boolean) {
		this.scene = scene; this.layout = layout; this.isDark = isDark;
	}
	setHovered(id: string | null) { this.hoveredId = id; }
	start() { this.rafId = requestAnimationFrame(this.loop); }
	stop()  { cancelAnimationFrame(this.rafId); }

	hitTestAgent(mx: number, my: number): string | null {
		if (!this.scene) return null;
		for (const a of this.scene.agents.values()) {
			const dx = mx-a.x, dy = my-a.y;
			if (dx*dx+dy*dy <= 14*14) return a.id;
		}
		return null;
	}

	// ── Loop ─────────────────────────────────────────────────────────────────
	private loop = (ts: number) => {
		const dt = Math.min((ts - this.prevTs) / 1000, 0.05);
		this.prevTs = ts; this.ts = ts;
		if (this.scene && this.layout) {
			const zones = computeZones(this.layout.canvasWidth, this.layout.canvasHeight);
			const idle = zones.find(z => z.id === 'in_progress') || zones[0];
			this.updateAgents(dt, idle, ts);
		}
		this.render();
		this.rafId = requestAnimationFrame(this.loop);
	};

	// ── Agent physics + wander ────────────────────────────────────────────────
	private updateAgents(dt: number, idleZone: ZoneRect, ts: number) {
		if (!this.scene) return;
		for (const a of this.scene.agents.values()) {
			if (a.state === 'idle') {
				let ws = this.wander.get(a.id);
				if (!ws) { ws = { nextPickAt: ts }; this.wander.set(a.id, ws); }
				if (ts >= ws.nextPickAt) {
					const pad = 22, lh = 26;
					a.targetX = idleZone.x + pad + Math.random()*(idleZone.w - pad*2);
					a.targetY = idleZone.y + lh + pad + Math.random()*(idleZone.h - lh - pad*2);
					const pause = WANDER_PAUSE[0] + Math.random()*(WANDER_PAUSE[1]-WANDER_PAUSE[0]);
					const travel = WANDER_INT[0] + Math.random()*(WANDER_INT[1]-WANDER_INT[0]);
					ws.nextPickAt = ts + pause + travel;
				}
			} else { this.wander.delete(a.id); }

			const dx = a.targetX - a.x, dy = a.targetY - a.y;
			const dist = Math.hypot(dx, dy);
			if (dist < ARRIVE_DIST) {
				a.vx *= 0.75; a.vy *= 0.75;
				if (Math.abs(a.vx) < 0.5) a.vx = 0;
				if (Math.abs(a.vy) < 0.5) a.vy = 0;
			} else {
				const spd = a.state === 'idle' ? SPEED_WANDER : SPEED_WALK;
				const ease = dist < 50 ? spd*(dist/50)+8 : spd;
				a.vx += ((dx/dist)*ease - a.vx) * 0.1;
				a.vy += ((dy/dist)*ease - a.vy) * 0.1;
			}
			a.x += a.vx * dt; a.y += a.vy * dt;

			const spd2 = Math.hypot(a.vx, a.vy);
			if (spd2 > 5) {
				a.walkPhase = (a.walkPhase + dt * spd2 * 0.07) % (Math.PI*2);
				a.facing = Math.abs(a.vx) > Math.abs(a.vy)
					? (a.vx > 0 ? 'right' : 'left')
					: (a.vy > 0 ? 'down' : 'up');
			} else {
				a.walkPhase = a.walkPhase > 0.05 ? a.walkPhase * 0.85 : 0;
			}
		}
	}

	// ── Main render ───────────────────────────────────────────────────────────
	private render() {
		const { canvas, ctx, scene, layout, isDark, ts } = this;
		if (!layout) return;
		const zones = computeZones(layout.canvasWidth, layout.canvasHeight);

		ctx.clearRect(0,0,canvas.width,canvas.height);
		this.drawGlobalFloor(isDark);

		for (const z of zones) this.drawRoom(z, isDark);

		if (!scene) return;

		// Sort tasks by y so closer ones render last (depth)
		const sortedTasks = Array.from(scene.tasks.values()).sort((a,b) => a.y - b.y);
		for (const t of sortedTasks) this.drawWorkstation(t, isDark, ts);

		this.drawClaimLinks(scene, ts);
		this.drawHandoffBeams(scene, ts);

		// Sort agents by y (depth order), hovered last
		const sortedAgents = Array.from(scene.agents.values())
			.sort((a,b) => a.y - b.y || (a.id === this.hoveredId ? 1 : -1));
		for (const a of sortedAgents) this.drawCharacter(a, isDark, ts);
	}

	// ── Global floor ──────────────────────────────────────────────────────────
	private drawGlobalFloor(isDark: boolean) {
		const { ctx, canvas } = this;
		ctx.fillStyle = isDark ? '#0a0e1a' : '#dde3ed';
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		// subtle global grid lines
		ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.03)';
		ctx.lineWidth = 0.5;
		const g = 24;
		for (let x = 0; x < canvas.width; x += g) {
			ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); ctx.stroke();
		}
		for (let y = 0; y < canvas.height; y += g) {
			ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); ctx.stroke();
		}
	}

	// ── Room: floor + walls + lighting + label ────────────────────────────────
	private drawRoom(zone: ZoneRect, isDark: boolean) {
		const { ctx } = this;
		const { x, y, w, h, color, id } = zone;

		// 1. Clip to zone
		ctx.save();
		rr(ctx, x, y, w, h, 10);
		ctx.clip();

		// 2. Floor texture
		switch (id) {
			case 'in_progress': this.drawPlazaFloor(ctx, x, y, w, h, isDark); break;
			case 'backlog':     this.drawDirtFloor(ctx, x, y, w, h, '#5b3a6e', isDark); break;
			case 'pending':     this.drawDirtFloor(ctx, x, y, w, h, '#a68246', isDark); break;
			case 'blocked':     this.drawDirtFloor(ctx, x, y, w, h, '#8b2a2a', isDark); break;
			case 'burnout':     this.drawCleanTileFloor(ctx, x, y, w, h, isDark); break;
			case 'completed':   this.drawGrassFloor(ctx, x, y, w, h, isDark); break;
			default:            this.drawWoodPlankFloor(ctx, x, y, w, h, isDark); break;
		}

		// 3. Ambient room light (radial glow from ceiling)
		const lx = x + w/2, ly = y + h*0.35;
		const grd = ctx.createRadialGradient(lx, ly, 0, lx, ly, Math.max(w, h) * 0.85);
		grd.addColorStop(0, rgba(color, isDark ? 0.12 : 0.08));
		grd.addColorStop(1, 'rgba(0,0,0,0)');
		ctx.fillStyle = grd;
		ctx.fillRect(x, y, w, h);

		ctx.restore();

		// 4. Wall (top edge, drawn OUTSIDE clip so it overlaps floor slightly)
		this.drawWall(ctx, x, y, w, isDark, color);

		// 5. Zone border
		ctx.strokeStyle = rgba(color, isDark ? 0.45 : 0.35);
		ctx.lineWidth = 1.5;
		rr(ctx, x, y, w, h, 10);
		ctx.stroke();

		// 6. Room-specific decorations
		this.drawRoomDecor(ctx, zone, isDark);

		// 7. Zone label on wall
		this.drawZoneLabel(ctx, zone, isDark);
	}

	// ── Floor textures ────────────────────────────────────────────────────────
	private drawPlazaFloor(ctx: CanvasRenderingContext2D, x:number,y:number,w:number,h:number, isDark:boolean) {
		const t = 24;
		const c0 = isDark ? '#2e3540' : '#b0b8c4';
		const c1 = isDark ? '#262d36' : '#a0a8b4';
		ctx.fillStyle = c0; ctx.fillRect(x,y,w,h);
		for (let cx2 = Math.floor(x/t)*t; cx2 < x+w; cx2 += t) {
			for (let cy2 = Math.floor(y/t)*t; cy2 < y+h; cy2 += t) {
				if (((Math.round(cx2/t) + Math.round(cy2/t)) & 1) === 0) {
					ctx.fillStyle = c1;
					ctx.fillRect(cx2, cy2, t, t);
				}
				// Draw subtle stone cracks
				if (tileNoise(cx2, cy2) > 0.8) {
					ctx.strokeStyle = isDark ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.1)';
					ctx.lineWidth = 1;
					ctx.beginPath();
					ctx.moveTo(cx2 + 2, cy2 + 2);
					ctx.lineTo(cx2 + t/2, cy2 + t/2);
					ctx.stroke();
				}
			}
		}
	}
	
	private drawDirtFloor(ctx: CanvasRenderingContext2D, x:number,y:number,w:number,h:number, baseColor:string, isDark:boolean) {
		ctx.fillStyle = baseColor;
		ctx.fillRect(x, y, w, h);
		for (let cx2 = x; cx2 < x+w; cx2 += 16) {
			for (let cy2 = y; cy2 < y+h; cy2 += 16) {
				const r = tileNoise(cx2, cy2);
				if (r > 0.5) {
					ctx.fillStyle = isDark ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.1)';
					ctx.beginPath();
					ctx.arc(cx2 + r*10, cy2 + r*10, 2 + r*2, 0, Math.PI*2);
					ctx.fill();
				}
			}
		}
	}

	private drawGrassFloor(ctx: CanvasRenderingContext2D, x:number,y:number,w:number,h:number, isDark:boolean) {
		ctx.fillStyle = isDark ? '#1a4020' : '#4ade80';
		ctx.fillRect(x, y, w, h);
		ctx.strokeStyle = isDark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.1)';
		for (let cx2 = x; cx2 < x+w; cx2 += 12) {
			for (let cy2 = y; cy2 < y+h; cy2 += 12) {
				const r = tileNoise(cx2, cy2);
				if (r > 0.4) {
					ctx.beginPath();
					ctx.moveTo(cx2 + r*5, cy2 + 8);
					ctx.lineTo(cx2 + r*5 + 2, cy2 + 2);
					ctx.lineTo(cx2 + r*5 + 4, cy2 + 8);
					ctx.stroke();
				}
			}
		}
	}


	private drawWoodPlankFloor(ctx: CanvasRenderingContext2D, x:number,y:number,w:number,h:number, isDark:boolean) {
		const pH = 9;
		const baseR = isDark ? 30 : 180;
		const baseG = isDark ? 22 : 140;
		const baseB = isDark ? 12 : 80;
		ctx.fillStyle = `rgb(${baseR},${baseG},${baseB})`;
		ctx.fillRect(x,y,w,h);

		for (let py = Math.floor(y/pH)*pH; py < y+h; py += pH) {
			const row = Math.round(py/pH);
			const shade = (tileNoise(row, 0)*30 - 15) * (isDark ? 0.8 : 0.6);
			const r = Math.round(Math.min(255,Math.max(0,baseR+shade)));
			const g = Math.round(Math.min(255,Math.max(0,baseG+shade)));
			const b = Math.round(Math.min(255,Math.max(0,baseB+shade)));
			ctx.fillStyle = `rgb(${r},${g},${b})`;
			ctx.fillRect(x, py, w, pH);
			// grain
			ctx.strokeStyle = isDark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.07)';
			ctx.lineWidth = 0.5;
			ctx.beginPath(); ctx.moveTo(x,py); ctx.lineTo(x+w,py); ctx.stroke();
			// plank joint (vertical, offset per row)
			const offset = (row % 2) * 55 + tileNoise(row,1)*40;
			for (let jx = x + offset; jx < x+w; jx += 80 + tileNoise(row, jx)*20) {
				ctx.beginPath(); ctx.moveTo(jx,py); ctx.lineTo(jx,py+pH); ctx.stroke();
			}
		}
	}

	private drawCarpetFloor(ctx: CanvasRenderingContext2D, x:number,y:number,w:number,h:number, color:string, isDark:boolean) {
		ctx.fillStyle = isDark ? '#100d18' : '#1a1535';
		ctx.fillRect(x,y,w,h);
		// carpet pile lines (diagonal)
		ctx.strokeStyle = rgba(color, 0.06);
		ctx.lineWidth = 1;
		const sp = 8;
		for (let d = -h; d < w+h; d += sp) {
			ctx.beginPath(); ctx.moveTo(x+d,y); ctx.lineTo(x+d+h,y+h); ctx.stroke();
		}
		// subtle grid for pile direction
		ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.04)';
		ctx.lineWidth = 0.5;
		for (let cx2 = x; cx2 < x+w; cx2 += 12) {
			ctx.beginPath(); ctx.moveTo(cx2,y); ctx.lineTo(cx2,y+h); ctx.stroke();
		}
		for (let cy2 = y; cy2 < y+h; cy2 += 12) {
			ctx.beginPath(); ctx.moveTo(x,cy2); ctx.lineTo(x+w,cy2); ctx.stroke();
		}
	}

	private drawCrackedTileFloor(ctx: CanvasRenderingContext2D, x:number,y:number,w:number,h:number, isDark:boolean) {
		const t = 18;
		const base = isDark ? '#1c1410' : '#c8b89a';
		ctx.fillStyle = base; ctx.fillRect(x,y,w,h);
		for (let tx = Math.floor(x/t)*t; tx < x+w; tx += t) {
			for (let ty = Math.floor(y/t)*t; ty < y+h; ty += t) {
				const n = tileNoise(Math.round(tx/t), Math.round(ty/t));
				const r = (n * 30 - 15) * (isDark ? 0.7 : 0.5);
				ctx.fillStyle = isDark ? `rgba(255,${100+r},${50+r},0.04)` : `rgba(180,${140+r},${100+r},0.3)`;
				ctx.fillRect(tx, ty, t, t);
				// crack on ~15% of tiles
				if (n > 0.85) {
					ctx.strokeStyle = isDark ? 'rgba(0,0,0,0.6)' : 'rgba(100,80,60,0.5)';
					ctx.lineWidth = 0.75;
					ctx.beginPath();
					ctx.moveTo(tx+n*t, ty+2);
					ctx.lineTo(tx+t/2+n*5, ty+t/2);
					ctx.lineTo(tx+t*0.8, ty+t-2);
					ctx.stroke();
				}
			}
		}
		ctx.strokeStyle = isDark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.12)';
		ctx.lineWidth = 1;
		for (let tx = Math.floor(x/t)*t; tx <= x+w; tx += t) {
			ctx.beginPath(); ctx.moveTo(tx,y); ctx.lineTo(tx,y+h); ctx.stroke();
		}
		for (let ty = Math.floor(y/t)*t; ty <= y+h; ty += t) {
			ctx.beginPath(); ctx.moveTo(x,ty); ctx.lineTo(x+w,ty); ctx.stroke();
		}
	}

	private drawCleanTileFloor(ctx: CanvasRenderingContext2D, x:number,y:number,w:number,h:number, isDark:boolean) {
		const t = 22;
		const c0 = isDark ? '#1a2530' : '#f0f4f8';
		const c1 = isDark ? '#1f2d3a' : '#e8eef4';
		ctx.fillStyle = c0; ctx.fillRect(x,y,w,h);
		for (let tx = Math.floor(x/t)*t; tx < x+w; tx += t) {
			for (let ty = Math.floor(y/t)*t; ty < y+h; ty += t) {
				if (((Math.round(tx/t)+Math.round(ty/t))&1) === 0) {
					ctx.fillStyle = c1;
					ctx.fillRect(tx+1, ty+1, t-2, t-2);
					// shine spot
					ctx.fillStyle = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.6)';
					ctx.fillRect(tx+3, ty+3, 5, 5);
				}
			}
		}
		ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.06)';
		ctx.lineWidth = 0.75;
		for (let tx = Math.floor(x/t)*t; tx <= x+w; tx += t) {
			ctx.beginPath(); ctx.moveTo(tx,y); ctx.lineTo(tx,y+h); ctx.stroke();
		}
		for (let ty = Math.floor(y/t)*t; ty <= y+h; ty += t) {
			ctx.beginPath(); ctx.moveTo(x,ty); ctx.lineTo(x+w,ty); ctx.stroke();
		}
	}

	private drawConcreteFloor(ctx: CanvasRenderingContext2D, x:number,y:number,w:number,h:number, isDark:boolean) {
		ctx.fillStyle = isDark ? '#141418' : '#b8bec8';
		ctx.fillRect(x,y,w,h);
		// brushed horizontal lines
		ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.15)';
		ctx.lineWidth = 1;
		for (let cy2 = y; cy2 < y+h; cy2 += 4) {
			if (tileNoise(0, Math.round(cy2)) > 0.5) {
				ctx.beginPath(); ctx.moveTo(x,cy2); ctx.lineTo(x+w,cy2); ctx.stroke();
			}
		}
		// expansion joints
		ctx.strokeStyle = isDark ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.1)';
		ctx.lineWidth = 1.5;
		const jH = 80;
		for (let jy = y + (jH - ((y%jH)||jH)); jy < y+h; jy += jH) {
			ctx.beginPath(); ctx.moveTo(x,jy); ctx.lineTo(x+w,jy); ctx.stroke();
		}
	}

	// ── Wall (top of room, 3D thickness) ─────────────────────────────────────
	private drawWall(ctx: CanvasRenderingContext2D, x:number,y:number,w:number, isDark:boolean, color:string) {
		const wH = 11;
		// Wall face
		ctx.fillStyle = isDark ? '#1c2130' : '#c4cad6';
		rr(ctx, x, y, w, wH, 0);
		ctx.fill();
		// Wall panels
		ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
		ctx.lineWidth = 0.75;
		for (let px = x+24; px < x+w; px += 24) {
			ctx.beginPath(); ctx.moveTo(px,y); ctx.lineTo(px,y+wH); ctx.stroke();
		}
		// Color accent stripe at top
		ctx.fillStyle = rgba(color, 0.4);
		ctx.fillRect(x, y, w, 2.5);
		// Shadow below wall
		const sGrd = ctx.createLinearGradient(x, y+wH, x, y+wH+8);
		sGrd.addColorStop(0,'rgba(0,0,0,0.28)'); sGrd.addColorStop(1,'rgba(0,0,0,0)');
		ctx.fillStyle = sGrd; ctx.fillRect(x, y+wH, w, 8);
		// Left corner post
		ctx.fillStyle = isDark ? '#253040' : '#b8bfc9';
		ctx.fillRect(x, y, 6, wH);
		// Right corner post
		ctx.fillRect(x+w-6, y, 6, wH);
	}

	// ── Zone label sign ───────────────────────────────────────────────────────
	private drawZoneLabel(ctx: CanvasRenderingContext2D, zone: ZoneRect, isDark:boolean) {
		const { x, y, w, color, label } = zone;
		const bw = Math.min(w-16, 92), bh = 16, bx = x+9, by = y+3;
		ctx.fillStyle = rgba(color, isDark ? 0.25 : 0.18);
		rr(ctx, bx, by, bw, bh, 5); ctx.fill();
		ctx.strokeStyle = rgba(color, 0.6); ctx.lineWidth = 0.75;
		rr(ctx, bx, by, bw, bh, 5); ctx.stroke();
		ctx.fillStyle = color;
		ctx.font = 'bold 8px system-ui,sans-serif';
		ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
		ctx.fillText(label.toUpperCase(), bx+6, by+bh/2);
	}

	// ── Room decorations ──────────────────────────────────────────────────────
	private drawRoomDecor(ctx: CanvasRenderingContext2D, zone: ZoneRect, isDark:boolean) {
		const { x, y, w, h, id } = zone;
		switch (id) {
			case 'in_progress': this.decorWorkspace(ctx, x, y, w, h, isDark); break;
			case 'backlog': this.decorArchive(ctx, x, y, w, h, isDark); break;
			case 'pending': this.decorLobby(ctx, x, y, w, h, isDark); break;
			case 'blocked': this.decorIssues(ctx, x, y, w, h, isDark); break;
			case 'burnout': this.decorTherapy(ctx, x, y, w, h, isDark); break;
		}
	}

	private decorPlaza(ctx: CanvasRenderingContext2D, x:number,y:number,w:number,h:number, isDark:boolean) {
		// Fountain in middle
		const fx = x + w/2;
		const fy = y + h/2;
		ctx.fillStyle = isDark ? '#1e293b' : '#94a3b8';
		ctx.beginPath(); ctx.arc(fx, fy, 24, 0, Math.PI*2); ctx.fill();
		ctx.fillStyle = isDark ? '#0ea5e9' : '#38bdf8';
		ctx.beginPath(); ctx.arc(fx, fy, 20, 0, Math.PI*2); ctx.fill();
		ctx.fillStyle = 'rgba(255,255,255,0.4)';
		ctx.beginPath(); ctx.arc(fx, fy, 8, 0, Math.PI*2); ctx.fill();
	}

	private decorFence(ctx: CanvasRenderingContext2D, x:number,y:number,w:number,h:number, isDark:boolean) {
		ctx.strokeStyle = isDark ? '#452b14' : '#8b5a2b';
		ctx.lineWidth = 4;
		ctx.strokeRect(x+4, y+4, w-8, h-8);
	}

	private decorBlocked(ctx: CanvasRenderingContext2D, x:number,y:number,w:number,h:number, isDark:boolean) {
		this.decorFence(ctx, x, y, w, h, isDark);
		// Cones
		ctx.fillStyle = '#f97316';
		[[x+20, y+h-20], [x+40, y+h-20]].forEach(([cx, cy]) => {
			ctx.beginPath(); ctx.moveTo(cx, cy-10); ctx.lineTo(cx+6, cy); ctx.lineTo(cx-6, cy); ctx.fill();
		});
	}

	private decorGarden(ctx: CanvasRenderingContext2D, x:number,y:number,w:number,h:number, isDark:boolean) {
		// Hedges
		ctx.fillStyle = isDark ? '#064e3b' : '#166534';
		ctx.fillRect(x+10, y+10, 20, 20);
		ctx.beginPath(); ctx.arc(x+w-20, y+h-20, 15, 0, Math.PI*2); ctx.fill();
	}

	private decorLobby(ctx: CanvasRenderingContext2D, x:number,y:number,w:number,h:number, isDark:boolean) {
		// Sofa (bottom area)
		const sx = x+w/2-28, sy = y+h-55;
		this.drawSofa(ctx, sx, sy, 56, isDark);
		// Coffee table
		this.drawCoffeeTable(ctx, x+w/2-14, y+h-32, isDark);
		// Plants in corners
		this.drawPotPlant(ctx, x+8, y+h-18, isDark);
		this.drawPotPlant(ctx, x+w-18, y+h-18, isDark);
		this.drawPotPlant(ctx, x+8, y+28, isDark);
		// Reception counter
		const rw = Math.min(w-20, 70);
		this.drawReceptionDesk(ctx, x+w/2-rw/2, y+24, rw, isDark);
		// Ceiling lamp
		this.drawCeilingLamp(ctx, x+w/2, y+14, isDark, this.ts);
	}

	private decorInbox(ctx: CanvasRenderingContext2D, x:number,y:number,w:number,h:number, isDark:boolean) {
		// Letter sorter on wall
		this.drawLetterSorter(ctx, x+w-28, y+20, isDark);
		// Clock on wall
		this.drawClock(ctx, x+18, y+20, isDark, this.ts);
	}

	private decorWorkspace(ctx: CanvasRenderingContext2D, x:number,y:number,w:number,h:number, isDark:boolean) {
		// Power strip on floor
		this.drawPowerStrip(ctx, x+12, y+h-16, Math.min(w-24, 60), isDark);
		// Whiteboard on wall
		this.drawWhiteboard(ctx, x+w-36, y+18, isDark);
		// Add new decorations
		this.drawWaterDispenser(ctx, x+20, y+12, isDark);
		this.drawFlowerVase(ctx, x+w/2, y+24, isDark);
	}

	private decorIssues(ctx: CanvasRenderingContext2D, x:number,y:number,w:number,h:number, isDark:boolean) {
		// Warning tape on floor
		ctx.save();
		ctx.globalAlpha = 0.25;
		ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 4; ctx.setLineDash([8,8]);
		ctx.beginPath(); ctx.moveTo(x,y+h-8); ctx.lineTo(x+w,y+h-8); ctx.stroke();
		ctx.setLineDash([]); ctx.restore();
		// Hazard sign on wall
		this.drawHazardSign(ctx, x+w/2-10, y+16, isDark);
	}

	private decorDone(ctx: CanvasRenderingContext2D, x:number,y:number,w:number,h:number, isDark:boolean) {
		// Trophy shelf
		this.drawTrophyShelf(ctx, x+10, y+20, isDark, this.ts);
		// Plant
		this.drawPotPlant(ctx, x+w-18, y+h-20, isDark);
	}

	private decorArchive(ctx: CanvasRenderingContext2D, x:number,y:number,w:number,h:number, isDark:boolean) {
		// Row of filing cabinets along top wall
		for (let fx = x+10; fx < x+w-22; fx += 26) {
			this.drawFilingCabinet(ctx, fx, y+18, isDark);
		}
		// Add plant
		this.drawPotPlant(ctx, x+w-15, y+h-20, isDark);
	}

	// ── Furniture sprites ─────────────────────────────────────────────────────
	private drawSofa(ctx: CanvasRenderingContext2D, x:number,y:number,w:number, isDark:boolean) {
		const base = isDark ? '#2d3a4a' : '#8b9eb5';
		const cushion = isDark ? '#3a4d62' : '#a8bdd4';
		const arm = isDark ? '#253040' : '#7b8ea5';
		// Back
		ctx.fillStyle = base; rr(ctx,x,y,w,8,3); ctx.fill();
		// Seat
		ctx.fillStyle = cushion; rr(ctx,x,y+7,w,10,3); ctx.fill();
		// Left armrest
		ctx.fillStyle = arm; rr(ctx,x-4,y,8,17,3); ctx.fill();
		// Right armrest
		ctx.fillStyle = arm; rr(ctx,x+w-4,y,8,17,3); ctx.fill();
		// Cushion lines
		ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)';
		ctx.lineWidth = 1;
		ctx.beginPath(); ctx.moveTo(x+w/3,y+7); ctx.lineTo(x+w/3,y+17); ctx.stroke();
		ctx.beginPath(); ctx.moveTo(x+w*2/3,y+7); ctx.lineTo(x+w*2/3,y+17); ctx.stroke();
		// Legs
		ctx.fillStyle = isDark ? '#1a2030' : '#6b7c90';
		[[x+2,y+15],[x+w-6,y+15]].forEach(([lx,ly]) => ctx.fillRect(lx,ly,4,4));
	}

	private drawCoffeeTable(ctx: CanvasRenderingContext2D, x:number,y:number, isDark:boolean) {
		ctx.fillStyle = 'rgba(0,0,0,0.15)';
		ctx.beginPath(); ctx.ellipse(x+14,y+6,16,7,0,0,Math.PI*2); ctx.fill();
		ctx.fillStyle = isDark ? '#2a3545' : '#93a8be';
		ctx.beginPath(); ctx.ellipse(x+14,y+4,15,6,0,0,Math.PI*2); ctx.fill();
		ctx.strokeStyle = isDark ? '#3a4a5a' : '#7a96b0';
		ctx.lineWidth = 1;
		ctx.beginPath(); ctx.ellipse(x+14,y+4,15,6,0,0,Math.PI*2); ctx.stroke();
		// Glass shine
		ctx.fillStyle = 'rgba(255,255,255,0.1)';
		ctx.beginPath(); ctx.ellipse(x+10,y+2,6,2,0,0,Math.PI*2); ctx.fill();
	}

	private drawPotPlant(ctx: CanvasRenderingContext2D, x:number,y:number, isDark:boolean) {
		// Pot
		ctx.fillStyle = isDark ? '#4a2d1a' : '#c4825a';
		rr(ctx,x-5,y-8,10,9,2); ctx.fill();
		ctx.strokeStyle = isDark ? '#6b4028' : '#a0643c'; ctx.lineWidth = 0.5;
		rr(ctx,x-5,y-8,10,9,2); ctx.stroke();
		// Soil
		ctx.fillStyle = isDark ? '#2d1a0a' : '#6b4a28';
		ctx.fillRect(x-4, y-9, 8, 3);
		// Leaves (layered)
		const lc = ['#16a34a','#15803d','#22c55e','#166534'];
		[[-5,-18,4,3,-0.3],[-2,-20,4,3,0],[3,-18,4,3,0.3],[-7,-14,3.5,2.5,-0.5],[5,-14,3.5,2.5,0.5]].forEach(([lx,ly,rx,ry,rot],i) => {
			ctx.save(); ctx.translate(x+lx,y+ly); ctx.rotate(rot as number);
			ctx.fillStyle = lc[i%lc.length];
			ctx.beginPath(); ctx.ellipse(0,0,rx as number,ry as number,0,0,Math.PI*2); ctx.fill();
			ctx.restore();
		});
	}

	private drawReceptionDesk(ctx: CanvasRenderingContext2D, x:number,y:number,w:number, isDark:boolean) {
		ctx.fillStyle = isDark ? '#1a2535' : '#9aafcc';
		rr(ctx,x,y,w,14,4); ctx.fill();
		ctx.strokeStyle = isDark ? '#2a3a50' : '#7a94b0'; ctx.lineWidth = 1;
		rr(ctx,x,y,w,14,4); ctx.stroke();
		// Counter top shine
		ctx.fillStyle = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.35)';
		rr(ctx,x+2,y+2,w-4,4,2); ctx.fill();
		// Small monitor
		ctx.fillStyle = isDark ? '#0f172a' : '#1e2535';
		rr(ctx,x+w/2-8,y-10,16,10,2); ctx.fill();
		ctx.fillStyle = isDark ? '#1e40af' : '#3b82f6';
		rr(ctx,x+w/2-7,y-9,14,8,1); ctx.fill();
	}

	private drawCeilingLamp(ctx: CanvasRenderingContext2D, x:number,y:number, isDark:boolean, ts:number) {
		// Hanging cord
		ctx.strokeStyle = isDark ? '#3a4555' : '#6b7a8a'; ctx.lineWidth = 1;
		ctx.beginPath(); ctx.moveTo(x,y-8); ctx.lineTo(x,y+2); ctx.stroke();
		// Lamp shade
		ctx.fillStyle = isDark ? '#2a3040' : '#e8d870';
		ctx.beginPath(); ctx.moveTo(x-10,y+2); ctx.lineTo(x+10,y+2);
		ctx.lineTo(x+8,y+10); ctx.lineTo(x-8,y+10); ctx.closePath(); ctx.fill();
		// Light cone below (animated pulse)
		const pulse = 0.5 + 0.5*Math.sin(ts*0.0015);
		const lg = ctx.createRadialGradient(x,y+10,0,x,y+10,35+pulse*5);
		lg.addColorStop(0, isDark ? `rgba(255,240,180,${0.15+pulse*0.05})` : `rgba(255,240,180,${0.2+pulse*0.05})`);
		lg.addColorStop(1, 'rgba(0,0,0,0)');
		ctx.fillStyle = lg; ctx.fillRect(x-40,y+10,80,45);
	}

	private drawLetterSorter(ctx: CanvasRenderingContext2D, x:number,y:number, isDark:boolean) {
		const base = isDark ? '#2d3a50' : '#8faac0';
		ctx.fillStyle = base; rr(ctx,x,y,22,28,2); ctx.fill();
		ctx.strokeStyle = isDark ? '#3a4a60' : '#7090a8'; ctx.lineWidth = 0.75;
		[0,7,14,21].forEach(dy => { ctx.beginPath(); ctx.moveTo(x+1,y+dy); ctx.lineTo(x+21,y+dy); ctx.stroke(); });
		// Papers in slots
		['#ef4444','#f59e0b','#3b82f6','#10b981'].forEach((c,i) => {
			ctx.fillStyle = c+'aa';
			rr(ctx,x+2,y+i*7+1,18,5,1); ctx.fill();
		});
	}

	private drawClock(ctx: CanvasRenderingContext2D, cx:number,cy:number, isDark:boolean, ts:number) {
		const r = 9;
		ctx.fillStyle = isDark ? '#1e2840' : '#f0f4fc';
		ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
		ctx.strokeStyle = isDark ? '#3a4a60' : '#8898b0'; ctx.lineWidth = 1;
		ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.stroke();
		// Hour marks
		ctx.strokeStyle = isDark ? '#5a6a80' : '#8898b0'; ctx.lineWidth = 0.75;
		for (let i = 0; i < 12; i++) {
			const a = i*Math.PI/6, r2 = r-1.5;
			ctx.beginPath(); ctx.moveTo(cx+Math.cos(a)*r2,cy+Math.sin(a)*r2);
			ctx.lineTo(cx+Math.cos(a)*(r2-2),cy+Math.sin(a)*(r2-2)); ctx.stroke();
		}
		// Hands (driven by real time for life)
		const now = new Date();
		const minA = (now.getMinutes()/60)*Math.PI*2 - Math.PI/2;
		const hrA  = ((now.getHours()%12)/12)*Math.PI*2 + (now.getMinutes()/60)*Math.PI/6 - Math.PI/2;
		ctx.strokeStyle = isDark ? '#e2e8f0' : '#1e2840';
		ctx.lineWidth = 1.5; ctx.lineCap = 'round';
		ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx+Math.cos(hrA)*5,cy+Math.sin(hrA)*5); ctx.stroke();
		ctx.lineWidth = 1;
		ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx+Math.cos(minA)*7,cy+Math.sin(minA)*7); ctx.stroke();
		ctx.fillStyle = isDark ? '#ef4444' : '#ef4444';
		ctx.beginPath(); ctx.arc(cx,cy,1.5,0,Math.PI*2); ctx.fill();
	}

	private drawPowerStrip(ctx: CanvasRenderingContext2D, x:number,y:number,w:number, isDark:boolean) {
		ctx.fillStyle = isDark ? '#1a1a1a' : '#2d2d2d';
		rr(ctx,x,y,w,6,3); ctx.fill();
		ctx.fillStyle = isDark ? '#3a3a3a' : '#4a4a4a';
		for (let ox = 6; ox < w-4; ox += 10) {
			rr(ctx,x+ox,y+1,6,4,2); ctx.fill();
		}
	}

	private drawWhiteboard(ctx: CanvasRenderingContext2D, x:number,y:number, isDark:boolean) {
		ctx.fillStyle = isDark ? '#1e2840' : '#f8fafc';
		rr(ctx,x,y,28,22,2); ctx.fill();
		ctx.strokeStyle = isDark ? '#3a4a60' : '#b0bac8'; ctx.lineWidth = 1;
		rr(ctx,x,y,28,22,2); ctx.stroke();
		// Scribble lines (code on whiteboard)
		const lines = [isDark?'#4ade80':'#16a34a', isDark?'#60a5fa':'#2563eb', isDark?'#f472b6':'#db2777'];
		lines.forEach((c,i) => {
			ctx.strokeStyle = c; ctx.lineWidth = 0.75;
			ctx.beginPath(); ctx.moveTo(x+3,y+5+i*5); ctx.lineTo(x+3+8+i*4,y+5+i*5); ctx.stroke();
		});
	}

	private drawHazardSign(ctx: CanvasRenderingContext2D, x:number,y:number, _isDark:boolean) {
		ctx.fillStyle = '#f59e0b';
		ctx.beginPath(); ctx.moveTo(x+10,y); ctx.lineTo(x+20,y+16); ctx.lineTo(x,y+16); ctx.closePath(); ctx.fill();
		ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1;
		ctx.stroke();
		ctx.fillStyle = '#1a1a1a';
		ctx.font = 'bold 9px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
		ctx.fillText('!', x+10, y+15);
	}

	private drawTrophyShelf(ctx: CanvasRenderingContext2D, x:number,y:number, isDark:boolean, ts:number) {
		// Shelf board
		ctx.fillStyle = isDark ? '#2d1a08' : '#c4825a';
		rr(ctx,x,y+20,50,5,2); ctx.fill();
		// Trophies
		[['#f59e0b',x+5],['#94a3b8',x+20],['#cd7f32',x+35]].forEach(([c,tx]) => {
			ctx.fillStyle = c as string;
			ctx.beginPath(); ctx.arc(tx as number+5,y+13,5,Math.PI,0); ctx.fill();
			ctx.fillRect(tx as number+3,y+13,4,8);
			rr(ctx,tx as number,y+20,10,4,2); ctx.fill();
		});
		// Golden trophy glow pulse
		const p = 0.5+0.5*Math.sin(ts*0.002);
		ctx.fillStyle = `rgba(245,158,11,${0.08+p*0.06})`;
		ctx.beginPath(); ctx.ellipse(x+10,y+18,12,6,0,0,Math.PI*2); ctx.fill();
	}

	private drawFilingCabinet(ctx: CanvasRenderingContext2D, x:number,y:number, isDark:boolean) {
		ctx.fillStyle = isDark ? '#1e2535' : '#9aaec0';
		rr(ctx,x,y,20,28,2); ctx.fill();
		ctx.strokeStyle = isDark ? '#2d3a50' : '#7a98b0'; ctx.lineWidth = 0.75;
		rr(ctx,x,y,20,28,2); ctx.stroke();
		// Drawer lines and handles
		[0,9,18].forEach(dy => {
			ctx.strokeStyle = isDark ? '#3a4a60' : '#5a7898'; ctx.lineWidth = 0.5;
			ctx.beginPath(); ctx.moveTo(x+1,y+dy+8); ctx.lineTo(x+19,y+dy+8); ctx.stroke();
			ctx.fillStyle = isDark ? '#4a5a70' : '#4a6888';
			rr(ctx,x+7,y+dy+3,6,3,2); ctx.fill();
		});
	}

	private drawFlowerVase(ctx: CanvasRenderingContext2D, x:number,y:number, isDark:boolean) {
		// Table/stand
		ctx.fillStyle = isDark ? '#2d1a08' : '#8b5a2b';
		rr(ctx, x-6, y-2, 12, 10, 1); ctx.fill();
		// Vase
		ctx.fillStyle = isDark ? '#1e3a8a' : '#bfdbfe';
		ctx.beginPath(); ctx.ellipse(x, y-6, 4, 6, 0, 0, Math.PI*2); ctx.fill();
		// Flowers
		const fc = ['#f43f5e', '#ec4899', '#d946ef'];
		[[-3,-12],[3,-11],[0,-14]].forEach(([fx, fy], i) => {
			ctx.strokeStyle = '#16a34a'; ctx.lineWidth = 1;
			ctx.beginPath(); ctx.moveTo(x, y-10); ctx.lineTo(x+fx, y+fy); ctx.stroke();
			ctx.fillStyle = fc[i];
			ctx.beginPath(); ctx.arc(x+fx, y+fy, 2.5, 0, Math.PI*2); ctx.fill();
		});
	}

	private drawWaterDispenser(ctx: CanvasRenderingContext2D, x:number, y:number, isDark:boolean) {
		// Base
		ctx.fillStyle = isDark ? '#1e293b' : '#e2e8f0';
		rr(ctx, x, y, 14, 24, 2); ctx.fill();
		ctx.strokeStyle = isDark ? '#334155' : '#cbd5e1'; ctx.lineWidth = 1;
		rr(ctx, x, y, 14, 24, 2); ctx.stroke();
		// Bottle
		ctx.fillStyle = isDark ? '#0ea5e955' : '#38bdf855';
		rr(ctx, x+2, y-12, 10, 12, 3); ctx.fill();
		// Taps
		ctx.fillStyle = '#ef4444'; ctx.fillRect(x+3, y+8, 2, 3);
		ctx.fillStyle = '#3b82f6'; ctx.fillRect(x+9, y+8, 2, 3);
		// Drip tray
		ctx.fillStyle = isDark ? '#0f172a' : '#94a3b8';
		rr(ctx, x+2, y+14, 10, 3, 1); ctx.fill();
	}

	private drawHospitalBed(ctx: CanvasRenderingContext2D, x:number, y:number, isDark:boolean) {
		// Bed frame (horizontal)
		ctx.fillStyle = isDark ? '#1e293b' : '#cbd5e1';
		rr(ctx, x-20, y-10, 40, 20, 3); ctx.fill();
		// Mattress
		ctx.fillStyle = isDark ? '#0f172a' : '#f8fafc';
		rr(ctx, x-18, y-8, 36, 16, 2); ctx.fill();
		// Pillow (on the right, since head is at +X)
		ctx.fillStyle = isDark ? '#1e1b4b' : '#e0e7ff';
		rr(ctx, x+10, y-6, 8, 12, 2); ctx.fill();
		// Blanket (on the left)
		ctx.fillStyle = isDark ? '#172554' : '#bfdbfe';
		rr(ctx, x-18, y-8, 20, 16, 2); ctx.fill();
		// IV Drip Pole
		ctx.strokeStyle = isDark ? '#64748b' : '#94a3b8'; ctx.lineWidth = 2;
		ctx.beginPath(); ctx.moveTo(x+16, y-10); ctx.lineTo(x+16, y-25); ctx.stroke();
		ctx.fillStyle = isDark ? '#0ea5e988' : '#38bdf888';
		rr(ctx, x+14, y-25, 4, 6, 1); ctx.fill();
	}

	private decorTherapy(ctx: CanvasRenderingContext2D, x:number,y:number,w:number,h:number, isDark:boolean) {
		// Draw beds under the agents
		for (let idx = 0; idx < 6; idx++) {
			const bx = x + 40 + (idx % 3) * 60;
			const by = y + h / 2 + Math.floor(idx / 3) * 40;
			this.drawHospitalBed(ctx, bx, by, isDark);
		}
		// Add some therapy room decor
		this.drawPotPlant(ctx, x+w-20, y+20, isDark);
		this.drawFlowerVase(ctx, x+20, y+20, isDark);
	}

	// ── Workstations ──────────────────────────────────────────────────────────
	private drawWorkstation(task: VisualTask, isDark: boolean, ts: number) {
		const { ctx } = this;
		const { x, y, status, taskCode, title, claimedByAgentId, hasPendingHandoff, repo } = task;
		const color = STATUS_COLORS[status] ?? '#64748b';
		const active = !!claimedByAgentId;
		const DW = 50, DH = 14, SW = 34, SH = 20;

		// Chair behind desk
		const chairY = y + DH/2 + 4;
		ctx.fillStyle = isDark ? '#1e2d3a' : '#7a98b5';
		ctx.beginPath(); ctx.arc(x, chairY+3, 8, 0, Math.PI*2); ctx.fill();
		ctx.fillStyle = isDark ? '#162435' : '#6888a8';
		ctx.fillRect(x-6, chairY-2, 12, 8);
		// Chair back
		rr(ctx, x-5, chairY-9, 10, 9, 2); ctx.fill();

		// Desk shadow
		ctx.fillStyle = 'rgba(0,0,0,0.18)';
		rr(ctx, x-DW/2+3, y-DH/2+5, DW, DH+2, 4); ctx.fill();

		// Desk surface
		const deskGrd = ctx.createLinearGradient(x-DW/2, y-DH/2, x+DW/2, y+DH/2);
		deskGrd.addColorStop(0, isDark ? '#1e2840' : '#d4dce8');
		deskGrd.addColorStop(1, isDark ? '#18202e' : '#c0ccd8');
		ctx.fillStyle = deskGrd;
		rr(ctx, x-DW/2, y-DH/2, DW, DH, 4); ctx.fill();
		ctx.strokeStyle = isDark ? '#2d3a50' : '#a0b0c0'; ctx.lineWidth = 1;
		rr(ctx, x-DW/2, y-DH/2, DW, DH, 4); ctx.stroke();

		// Keyboard
		ctx.fillStyle = isDark ? '#0d1520' : '#8090a8';
		rr(ctx, x-10, y-2, 20, 5, 2); ctx.fill();
		// Key rows
		ctx.fillStyle = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.3)';
		[[x-9,y-1,18,1.5],[x-8,y+1.5,16,1.5]].forEach(([kx,ky,kw,kh]) => {
			for (let ki = 0; ki < 5; ki++) {
				rr(ctx, kx+ki*(kw/5)+0.5, ky, kw/5-1, kh, 0.5); ctx.fill();
			}
		});
		// Mouse
		ctx.fillStyle = isDark ? '#0d1520' : '#8090a8';
		ctx.beginPath(); ctx.ellipse(x+14, y, 3, 4, 0, 0, Math.PI*2); ctx.fill();
		ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)';
		ctx.lineWidth = 0.5;
		ctx.beginPath(); ctx.moveTo(x+14, y-2); ctx.lineTo(x+14, y+2); ctx.stroke();

		// Monitor stand
		ctx.fillStyle = isDark ? '#2d3a50' : '#8090a8';
		ctx.fillRect(x-1.5, y-DH/2-7, 3, 8);

		// Monitor frame
		const mY = y - DH/2 - SH - 6;
		ctx.fillStyle = isDark ? '#111827' : '#1f2937';
		rr(ctx, x-SW/2-3, mY-3, SW+6, SH+6, 5); ctx.fill();

		// Screen content
		if (active) {
			const sGrd = ctx.createLinearGradient(x-SW/2, mY, x+SW/2, mY+SH);
			sGrd.addColorStop(0, lighten(color, 50));
			sGrd.addColorStop(1, color);
			ctx.fillStyle = sGrd;
			if (active) { ctx.shadowColor = color+'99'; ctx.shadowBlur = 10; }
		} else {
			ctx.fillStyle = isDark ? '#0f1929' : '#1e2d3a';
		}
		rr(ctx, x-SW/2, mY, SW, SH, 3); ctx.fill();
		ctx.shadowBlur = 0;

		// Screen shine
		ctx.fillStyle = 'rgba(255,255,255,0.12)';
		rr(ctx, x-SW/2, mY, SW, SH/2.5, 3); ctx.fill();

		// Code text on screen
		if (active) {
			// Animated "typing" lines
			const lines = 3;
			for (let li = 0; li < lines; li++) {
				const w2 = (SW-8) * (0.4 + 0.6*((Math.sin(ts*0.001+li)*0.5+0.5)));
				ctx.fillStyle = `rgba(255,255,255,${0.2 + li*0.1})`;
				ctx.fillRect(x-SW/2+4, mY+3+li*5, w2, 2);
			}
		}
		// Task code label
		ctx.fillStyle = active ? 'rgba(255,255,255,0.9)' : (isDark ? '#374151' : '#6b7280');
		ctx.font = 'bold 5.5px monospace';
		ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
		ctx.fillText(`${repo.split('/').pop()?.slice(0,5)}·${taskCode}`.slice(0,12), x, mY+SH-1);

		// Task title below desk
		ctx.fillStyle = isDark ? 'rgba(148,163,184,0.65)' : 'rgba(71,85,105,0.65)';
		ctx.font = '5.5px system-ui,sans-serif';
		ctx.textAlign = 'center'; ctx.textBaseline = 'top';
		ctx.fillText(title.slice(0,12), x, y+DH/2+2);

		// Handoff badge
		if (hasPendingHandoff) {
			const bx = x + SW / 2;
			const by = mY - 1;
			ctx.fillStyle = '#f59e0b';
			ctx.shadowColor = '#f59e0b'; ctx.shadowBlur = 8;
			ctx.beginPath(); ctx.arc(bx, by, 5, 0, Math.PI*2); ctx.fill();
			ctx.shadowBlur = 0;
			ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
			ctx.beginPath(); ctx.arc(bx, by, 5, 0, Math.PI*2); ctx.stroke();
			ctx.fillStyle = '#1a1a1a'; ctx.font = 'bold 6.5px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
			ctx.fillText('!', bx, by);
		}
	}

	// ── Claim links ───────────────────────────────────────────────────────────
	private drawClaimLinks(scene: ArenaScene, ts: number) {
		const { ctx } = this;
		for (const a of scene.agents.values()) {
			for (const tid of a.claimedTaskIds) {
				const t = scene.tasks.get(tid); if (!t) continue;
				const grd = ctx.createLinearGradient(a.x,a.y,t.x,t.y);
				grd.addColorStop(0, a.color+'cc');
				grd.addColorStop(1, (STATUS_COLORS[t.status]??'#64748b')+'44');
				ctx.strokeStyle = grd; ctx.lineWidth = 1.5;
				ctx.setLineDash([5,5]); ctx.lineDashOffset = -(ts*0.022)%10;
				ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(t.x,t.y); ctx.stroke();
			}
		}
		ctx.setLineDash([]); ctx.lineDashOffset = 0;
	}

	// ── Handoff beams ─────────────────────────────────────────────────────────
	private drawHandoffBeams(scene: ArenaScene, ts: number) {
		const { ctx } = this;
		for (const h of scene.handoffs) {
			const from = scene.agents.get(h.fromAgentId); if (!from) continue;
			let toX:number, toY:number;
			if (h.toAgentId) { const to = scene.agents.get(h.toAgentId); if (!to) continue; toX=to.x; toY=to.y; }
			else if (h.taskId) { const t = scene.tasks.get(h.taskId); if (!t) continue; toX=t.x; toY=t.y; }
			else continue;

			ctx.strokeStyle = '#f59e0b88'; ctx.lineWidth = 2.5;
			ctx.setLineDash([8,5]); ctx.lineDashOffset = -(ts*0.07)%13;
			ctx.beginPath(); ctx.moveTo(from.x,from.y); ctx.lineTo(toX,toY); ctx.stroke();
			ctx.setLineDash([]); ctx.lineDashOffset = 0;

			const t2 = (ts%1600)/1600;
			const px = from.x+(toX-from.x)*t2, py = from.y+(toY-from.y)*t2;
			ctx.fillStyle = '#f59e0b'; ctx.shadowColor = '#f59e0b'; ctx.shadowBlur = 8;
			ctx.beginPath(); ctx.arc(px,py,4,0,Math.PI*2); ctx.fill();
			ctx.shadowBlur = 0;
		}
	}

	// ── RPG Character ─────────────────────────────────────────────────────────
	private drawCharacter(agent: VisualAgent, isDark: boolean, ts: number) {
		const { ctx } = this;
		const { x, y, walkPhase, facing, state, name, id } = agent;
		const color = agent.color || '#64748b';
		const hovered = id === this.hoveredId;
		const spd = Math.hypot(agent.vx, agent.vy);
		const moving = spd > 5;

		// Derive unique styling
		const nh = strHash(name || '');
		const hairColor = HAIR_COLORS[nh % HAIR_COLORS.length] || '#000';
		const pantColor = PANT_COLORS[(nh >>> 3) % PANT_COLORS.length] || '#1e3a5f';
		const skinTone  = SKIN_TONES[(nh >>> 6) % SKIN_TONES.length] || '#f5c89a';
		const hairStyle = nh % 5;
		const shirtHighlight = lighten(color, 30);

		// Walk cycle values
		const legSwing  = moving ? Math.sin(walkPhase) * 5 : 0;
		const armSwing  = moving ? Math.sin(walkPhase + Math.PI) * 4 : 0;
		const headBob   = moving ? Math.sin(walkPhase * 2) * 1.2 : 0;

		// Ground shadow
		ctx.fillStyle = 'rgba(0,0,0,0.22)';
		ctx.beginPath(); ctx.ellipse(x, y+3, 11, 5, 0, 0, Math.PI*2); ctx.fill();

		// Hover selection ring
		if (hovered) {
			ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash([4,3]);
			ctx.beginPath(); ctx.arc(x, y-24+headBob, 16, 0, Math.PI*2); ctx.stroke();
			ctx.setLineDash([]);
		}

		ctx.save();
		ctx.translate(x, y);
		if (state === 'burnout') {
			ctx.rotate(Math.PI / 2);
			ctx.translate(0, 15);
		} else if (facing === 'left') {
			ctx.scale(-1, 1);
		}

		// ─ Legs ─
		ctx.fillStyle = pantColor;
		// Left leg
		ctx.save(); ctx.translate(-3.5, 0); ctx.rotate(legSwing * 0.1);
		rr(ctx, -2.5, -4, 5, 9, 2); ctx.fill(); ctx.restore();
		// Right leg
		ctx.save(); ctx.translate(3.5, 0); ctx.rotate(-legSwing * 0.1);
		rr(ctx, -2.5, -4, 5, 9, 2); ctx.fill(); ctx.restore();

		// ─ Shoes ─
		ctx.fillStyle = darken(pantColor, 30);
		ctx.save(); ctx.translate(-3.5, legSwing*0.5);
		rr(ctx, -3, 4, 7, 4, 2); ctx.fill(); ctx.restore();
		ctx.save(); ctx.translate(3.5, -legSwing*0.5);
		rr(ctx, -3, 4, 7, 4, 2); ctx.fill(); ctx.restore();

		// ─ Body / shirt ─
		const bGrd = ctx.createLinearGradient(-7,-26,7,-13);
		bGrd.addColorStop(0, shirtHighlight); bGrd.addColorStop(1, color);
		ctx.fillStyle = bGrd;
		rr(ctx, -7, -26, 14, 14, 3); ctx.fill();
		// Shirt collar detail
		ctx.fillStyle = lighten(color, 45);
		rr(ctx, -3.5, -26, 7, 5, 2); ctx.fill();
		// Shirt vertical seam
		ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 0.75;
		ctx.beginPath(); ctx.moveTo(0, -26); ctx.lineTo(0, -13); ctx.stroke();

		// ─ Left arm ─
		ctx.save(); ctx.translate(-9, -24); ctx.rotate(armSwing * 0.12);
		const laGrd = ctx.createLinearGradient(-2,0,2,10);
		laGrd.addColorStop(0, shirtHighlight); laGrd.addColorStop(1, color);
		ctx.fillStyle = laGrd; rr(ctx, -2, 0, 4, 9, 2); ctx.fill();
		// Hand
		ctx.fillStyle = skinTone; ctx.beginPath(); ctx.ellipse(0,10,2.5,2,0,0,Math.PI*2); ctx.fill();
		ctx.restore();

		// ─ Right arm ─
		ctx.save(); ctx.translate(9, -24); ctx.rotate(-armSwing * 0.12);
		ctx.fillStyle = laGrd; rr(ctx, -2, 0, 4, 9, 2); ctx.fill();
		ctx.fillStyle = skinTone; ctx.beginPath(); ctx.ellipse(0,10,2.5,2,0,0,Math.PI*2); ctx.fill();
		ctx.restore();

		// ─ Neck ─
		ctx.fillStyle = skinTone;
		ctx.fillRect(-2.5, -28, 5, 4);

		// ─ Head ─
		const headY = -38 + headBob;
		// Head shadow
		ctx.fillStyle = 'rgba(0,0,0,0.15)';
		ctx.beginPath(); ctx.ellipse(1, headY+2, 9, 5, 0, 0, Math.PI*2); ctx.fill();
		// Skin
		const hGrd = ctx.createRadialGradient(-3, headY-3, 2, 0, headY, 10);
		hGrd.addColorStop(0, lighten(skinTone, 15)); hGrd.addColorStop(1, skinTone);
		ctx.fillStyle = hGrd;
		ctx.beginPath(); ctx.ellipse(0, headY, 9, 10, 0, 0, Math.PI*2); ctx.fill();

		// ─ Hair ─
		this.drawHair(ctx, 0, headY, hairColor, hairStyle);

		// ─ Face (only when facing down or side) ─
		if (facing !== 'up') {
			this.drawFace(ctx, 0, headY, skinTone, facing, moving, walkPhase, state, ts, nh);
		}

		ctx.restore(); // end translate(x,y) + scale

		// ─ State badges ─
		if (state !== 'idle' && state !== 'burnout') {
			const dotColor = state === 'processing' ? '#a855f7' : state === 'claiming' ? '#0ea5e9' : '#f59e0b';
			const badgeX = x + (facing === 'left' ? -10 : 10);
			const badgeY = y - 48 + headBob;
			ctx.fillStyle = dotColor; ctx.shadowColor = dotColor; ctx.shadowBlur = 10;
			ctx.beginPath(); ctx.arc(badgeX, badgeY, 5, 0, Math.PI*2); ctx.fill();
			ctx.shadowBlur = 0;
			ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
			ctx.beginPath(); ctx.arc(badgeX, badgeY, 5, 0, Math.PI*2); ctx.stroke();
			ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1;
			ctx.beginPath(); ctx.arc(badgeX, badgeY, 6, 0, Math.PI*2); ctx.stroke();
		}

		// ─ Working effect: pulse ring + thought dots ─
		if (state === 'processing') {
			const pulse = 0.4 + 0.6*Math.sin(ts*0.0028);
			ctx.strokeStyle = rgba(color, 0.18 + pulse*0.14);
			ctx.lineWidth = 1.5;
			ctx.beginPath(); ctx.arc(x, y-38+headBob, 17+pulse*4, 0, Math.PI*2); ctx.stroke();
			// Thought bubble
			for (let bi = 0; bi < 3; bi++) {
				const boff = 0.3 + 0.7*Math.sin(ts*0.004 + bi*1.1);
				ctx.fillStyle = rgba(color, 0.5 + boff*0.5);
				ctx.beginPath(); ctx.arc(x + (facing === 'left' ? -5+bi*5 : -5+bi*5), y-54+headBob, 1.5+boff, 0, Math.PI*2); ctx.fill();
			}
		}

		// ─ Burnout effect ─
		if (state === 'burnout') {
			const zPhase = (ts * 0.002) % (Math.PI * 2);
			for (let i = 0; i < 3; i++) {
				const zt = (zPhase + i * (Math.PI*2/3)) % (Math.PI*2);
				const alpha = Math.max(0, Math.sin(zt));
				const zx = x + 5 + Math.cos(zt)*5 + zt * 2;
				const zy = y - 10 - zt * 8;
				ctx.fillStyle = `rgba(150, 150, 200, ${alpha})`;
				ctx.font = `bold ${8 + zt * 1.5}px monospace`;
				ctx.fillText('Z', zx, zy);
			}
		}

		// ─ Name label ─
		ctx.fillStyle = isDark ? 'rgba(226,232,240,0.82)' : 'rgba(15,23,42,0.7)';
		ctx.font = '7px system-ui,sans-serif';
		ctx.textAlign = 'center'; ctx.textBaseline = 'top';
		const lbl = name.length > 12 ? name.slice(0,12)+'…' : name;
		ctx.fillText(lbl, x, y+12);
	}

	// ─ Hair styles ─
	private drawHair(ctx: CanvasRenderingContext2D, x:number, y:number, color:string, style:number) {
		ctx.fillStyle = color;
		switch (style) {
			case 0: // Short buzzcut
				ctx.beginPath(); ctx.ellipse(x, y, 9, 10, 0, Math.PI, 0); ctx.fill();
				// Sideburns
				ctx.fillRect(x-9, y-2, 3, 5);
				ctx.fillRect(x+6, y-2, 3, 5);
				break;
			case 1: // Spiky
				for (let i = -2; i <= 2; i++) {
					ctx.beginPath(); ctx.moveTo(x+i*4-2,y-7); ctx.lineTo(x+i*4,y-14); ctx.lineTo(x+i*4+2,y-7); ctx.closePath(); ctx.fill();
				}
				ctx.beginPath(); ctx.ellipse(x,y-5,9,4,0,0,Math.PI*2); ctx.fill();
				break;
			case 2: // Medium / swept
				ctx.save(); ctx.translate(x, y);
				ctx.beginPath();
				ctx.moveTo(-9,-2); ctx.bezierCurveTo(-11,-12,10,-16,11,-6);
				ctx.lineTo(9,0); ctx.bezierCurveTo(4,-8,-4,-10,-9,-2);
				ctx.closePath(); ctx.fill();
				ctx.restore();
				break;
			case 3: // Long (extends below chin)
				ctx.beginPath(); ctx.arc(x,y,9.5,Math.PI,0); ctx.fill();
				// Side locks
				rr(ctx, x-10, y, 4, 12, 2); ctx.fill();
				rr(ctx, x+6, y, 4, 12, 2); ctx.fill();
				break;
			case 4: // Cap / hat
				ctx.fillStyle = darken(color, 20);
				// Brim
				rr(ctx, x-12, y-6, 24, 5, 2); ctx.fill();
				// Crown
				ctx.fillStyle = color;
				rr(ctx, x-9, y-16, 18, 12, 3); ctx.fill();
				// Logo badge
				ctx.fillStyle = lighten(color, 40);
				rr(ctx, x-3, y-11, 6, 4, 1); ctx.fill();
				break;
		}
	}

	// ─ Face details ─
	private drawFace(ctx: CanvasRenderingContext2D, x:number, y:number, _skinTone:string, facing: AgentFacing, moving:boolean, walkPhase:number, state?: string, ts?: number, seed?: number) {
		if (facing === 'right') {
			// Side profile: one eye, profile nose
			ctx.fillStyle = 'rgba(0,0,0,0.7)';
			ctx.beginPath(); ctx.ellipse(x+5, y-2, 1.5, 1.5, 0, 0, Math.PI*2); ctx.fill();
			// Nose bump
			ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 1;
			ctx.beginPath(); ctx.arc(x+9, y, 3, -0.5, 0.5); ctx.stroke();
		} else {
			// Front face (or mirrored for 'left')
			if (state === 'burnout') {
				const isSwirling = ((seed || 0) % 2 === 0);
				if (isSwirling) {
					// Swirling eyes
					ctx.strokeStyle = 'rgba(0,0,0,0.7)';
					ctx.lineWidth = 1;
					const spin = ((ts || 0) * 0.005) % (Math.PI * 2);
					
					// Left eye swirl
					ctx.save(); ctx.translate(x-3, y-2); ctx.rotate(spin);
					ctx.beginPath(); ctx.moveTo(0, 0);
					for (let i = 0; i < 15; i++) {
						const angle = i * 0.5;
						const radius = i * 0.15;
						ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
					}
					ctx.stroke();
					ctx.restore();

					// Right eye swirl
					ctx.save(); ctx.translate(x+3, y-2); ctx.rotate(spin);
					ctx.beginPath(); ctx.moveTo(0, 0);
					for (let i = 0; i < 15; i++) {
						const angle = i * 0.5;
						const radius = i * 0.15;
						ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
					}
					ctx.stroke();
					ctx.restore();
				} else {
					// Closed eyes (curved lines down)
					ctx.strokeStyle = 'rgba(0,0,0,0.7)';
					ctx.lineWidth = 1.5;
					ctx.beginPath(); ctx.arc(x-3, y-2, 2.5, 0, Math.PI); ctx.stroke();
					ctx.beginPath(); ctx.arc(x+3, y-2, 2.5, 0, Math.PI); ctx.stroke();
				}
				// Sad/burnout mouth
				ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1;
				ctx.beginPath(); ctx.arc(x, y+3, 2, Math.PI, Math.PI*2); ctx.stroke();
			} else {
				// Eyes
				ctx.fillStyle = 'white';
				ctx.beginPath(); ctx.ellipse(x-3, y-2, 2.5, 2, 0, 0, Math.PI*2); ctx.fill();
				ctx.beginPath(); ctx.ellipse(x+3, y-2, 2.5, 2, 0, 0, Math.PI*2); ctx.fill();
				ctx.fillStyle = 'rgba(20,20,80,0.85)';
				ctx.beginPath(); ctx.arc(x-3, y-2, 1.3, 0, Math.PI*2); ctx.fill();
				ctx.beginPath(); ctx.arc(x+3, y-2, 1.3, 0, Math.PI*2); ctx.fill();
				// Eye shine
				ctx.fillStyle = 'white';
				ctx.beginPath(); ctx.arc(x-3.5, y-2.5, 0.5, 0, Math.PI*2); ctx.fill();
				ctx.beginPath(); ctx.arc(x+2.5, y-2.5, 0.5, 0, Math.PI*2); ctx.fill();
				// Mouth
				const mouthOpen = moving && Math.sin(walkPhase) > 0.5;
				ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1;
				if (mouthOpen) {
					ctx.beginPath(); ctx.arc(x, y+2, 2, 0, Math.PI); ctx.stroke();
				} else {
					ctx.beginPath(); ctx.moveTo(x-2.5, y+2.5); ctx.quadraticCurveTo(x, y+4, x+2.5, y+2.5); ctx.stroke();
				}
			}
		}
	}
}
