import type { AgentFacing, HelperVariant, HandoffVehicle, ArenaScene } from "../arenaTypes";
import type { FilterState } from "../arenaEvents";

// ─── Level of Detail ────────────────────────────────────────────────────────
export const LOD_FULL = 0;
export const LOD_NORMAL = 1;
export const LOD_SIMPLIFIED = 2;
export const LOD_AGGREGATE = 3;
export type LODLevel = typeof LOD_FULL | typeof LOD_NORMAL | typeof LOD_SIMPLIFIED | typeof LOD_AGGREGATE;

// ─── Motion ────────────────────────────────────────────────────────────────
export const SPEED_WALK = 85;
export const SPEED_WANDER = 50;
export const ARRIVE_DIST = 6;
export const WANDER_INT: [number, number] = [2800, 5000];
export const WANDER_PAUSE: [number, number] = [600, 1600];

// ─── Handoff Animation ────────────────────────────────────────────────────
export const HANDOFF_SPEED = 100;
export const PICKUP_DURATION = 800;
export const ARRIVE_DURATION = 600;

// ─── Zoom constraints ──────────────────────────────────────────────────────
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 3.0;

// ─── Color helpers ─────────────────────────────────────────────────────────
export function h2r(hex: string): [number, number, number] {
	if (!hex) return [0, 0, 0];
	let s = hex.replace("#", "");
	if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
	else if (s.length === 8) s = s.slice(0, 6);
	const n = parseInt(s, 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function lighten(hex: string, amt: number) {
	const [r, g, b] = h2r(hex);
	return `rgb(${Math.min(255, r + amt)},${Math.min(255, g + amt)},${Math.min(255, b + amt)})`;
}
export function darken(hex: string, amt: number) {
	const [r, g, b] = h2r(hex);
	return `rgb(${Math.max(0, r - amt)},${Math.max(0, g - amt)},${Math.max(0, b - amt)})`;
}
export function rgba(hex: string, a: number) {
	const [r, g, b] = h2r(hex);
	return `rgba(${r},${g},${b},${a})`;
}
export function strHash(s: string): number {
	let h = 5381;
	for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
	return h;
}
export function tileNoise(x: number, y: number): number {
	return Math.abs(Math.sin(x * 127.1 + y * 311.7) * 43758.5453) % 1;
}

// ─── Canvas rounded-rect helper ────────────────────────────────────────────
export function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
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

// ─── Blocked reason visual helpers ──────────────────────────────────────────
export const BLOCKED_REASON_COLORS: Record<string, string> = {
	dependency: "#F59E0B",
	"rate-limit": "#F97316",
	human: "#3B82F6",
	conflict: "#EF4444",
	token: "#A855F7",
	memory: "#EC4899",
	tool: "#6B7280"
};

export const BLOCKED_REASON_ICONS: Record<string, string> = {
	dependency: "🔗",
	"rate-limit": "⏱",
	human: "👤",
	conflict: "🔀",
	token: "💰",
	memory: "🧠",
	tool: "⚙"
};

// ─── Agent styling tables ──────────────────────────────────────────────────
export const HAIR_COLORS = [
	"#1a0a00",
	"#2d1a00",
	"#0f0f0f",
	"#4a2d00",
	"#8B4513",
	"#d4a800",
	"#c0392b",
	"#7b2d8b",
	"#1a3a5c",
	"#2d4a1a"
];
export const SKIN_TONES = ["#f5c89a", "#e8a870", "#d4875a", "#c06840", "#8B5e3c", "#6b3d28"];
export const PANT_COLORS = ["#1e3a5f", "#2d4a1a", "#3d2a1a", "#2a1a3d", "#1a3d3d", "#3d1a2a", "#2a2a3d"];

export const HELPER_SHIRT_COLORS: Record<HelperVariant, string> = {
	male_nurse: "#1e6e9e",
	female_nurse: "#2d8e6e",
	staff1: "#5a3e8a",
	staff2: "#8a5a3e"
};
export const HELPER_HAIR: Record<HelperVariant, string> = {
	male_nurse: "#1a0a00",
	female_nurse: "#4a2d00",
	staff1: "#0f0f0f",
	staff2: "#2d1a00"
};
export const HELPER_SKIN: Record<HelperVariant, string> = {
	male_nurse: "#e8a870",
	female_nurse: "#f5c89a",
	staff1: "#d4875a",
	staff2: "#c06840"
};

// ─── Wander state ──────────────────────────────────────────────────────────
export interface WanderState {
	nextPickAt: number;
}

// ─── Render context ─────────────────────────────────────────────────────────
export interface RenderCtx {
	ctx: CanvasRenderingContext2D;
	canvasW: number;
	canvasH: number;
	isDark: boolean;
	ts: number;
	zoom: number;
	panX: number;
	panY: number;
	lod: LODLevel;
	hoveredId: string | null;
	reducedMotion: boolean;
	reducedTransparency: boolean;
}

export function makeCtx(
	ctx: CanvasRenderingContext2D,
	canvasW: number,
	canvasH: number,
	isDark: boolean,
	ts: number,
	zoom: number,
	panX: number,
	panY: number,
	lod: LODLevel,
	hoveredId: string | null,
	reducedMotion: boolean,
	reducedTransparency: boolean
): RenderCtx {
	return { ctx, canvasW, canvasH, isDark, ts, zoom, panX, panY, lod, hoveredId, reducedMotion, reducedTransparency };
}

// ─── Filter helpers ─────────────────────────────────────────────────────────
export function matchesAgentFilter(
	agent: { role: string; repos: string[]; name: string; claimedTaskIds: string[] },
	filter: FilterState,
	tasks?: Map<string, { title: string; taskCode: string }> | null
): boolean {
	if (filter.roles.length > 0 && !filter.roles.includes(agent.role)) return false;
	if (filter.repository && !agent.repos.includes(filter.repository)) return false;
	if (filter.search) {
		const q = filter.search.toLowerCase();
		if (!agent.name.toLowerCase().includes(q)) {
			if (!tasks) return false;
			const taskMatch = agent.claimedTaskIds.some((tid) => {
				const t = tasks.get(tid);
				return t && (t.title.toLowerCase().includes(q) || t.taskCode.toLowerCase().includes(q));
			});
			if (!taskMatch) return false;
		}
	}
	return true;
}

export function matchesTaskFilter(
	task: {
		repo: string;
		priorityLevel: string;
		status: string;
		title: string;
		taskCode: string;
		claimedByAgentId: string | null;
	},
	filter: FilterState,
	agents?: Map<string, { role: string }> | null
): boolean {
	if (filter.repository && task.repo !== filter.repository) return false;
	if (filter.priorities.length > 0 && !filter.priorities.includes(task.priorityLevel)) return false;
	if (filter.statuses.length > 0 && !filter.statuses.includes(task.status)) return false;
	if (filter.search) {
		const q = filter.search.toLowerCase();
		if (!task.title.toLowerCase().includes(q) && !task.taskCode.toLowerCase().includes(q)) return false;
	}
	if (filter.roles.length > 0 && task.claimedByAgentId) {
		const agent = agents?.get(task.claimedByAgentId);
		if (agent && !filter.roles.includes(agent.role)) return false;
	}
	return true;
}

export function isFilterActive(filter: FilterState): boolean {
	return (
		filter.repository !== null ||
		filter.roles.length > 0 ||
		filter.priorities.length > 0 ||
		filter.statuses.length > 0 ||
		filter.search !== ""
	);
}
