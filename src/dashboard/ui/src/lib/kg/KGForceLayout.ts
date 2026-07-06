// ─── Types ──────────────────────────────────────────────────────────────────

export interface LayoutNode {
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

export interface LayoutEdge {
	source: string;
	target: string;
	relation_type: string;
}

export interface ForceLayoutConfig {
	nodeRadius?: number;
	repulsionStrength?: number;
	attractionStrength?: number;
	centeringStrength?: number;
	damping?: number;
	minVelocity?: number;
	iterations?: number;
	margin?: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const NODE_RADIUS = 18;

const DEFAULT_CONFIG: Required<ForceLayoutConfig> = {
	nodeRadius: 18,
	repulsionStrength: 4000,
	attractionStrength: 0.005,
	centeringStrength: 0.01,
	damping: 0.85,
	minVelocity: 0.1,
	iterations: 120,
	margin: 30
};

// ─── Initialize Layout (circular spread) ─────────────────────────────────────

export function initializeLayout(nodes: LayoutNode[], width: number, height: number): LayoutNode[] {
	const cx = width / 2;
	const cy = height / 2;
	const spread = Math.min(width, height) * 0.35;
	const count = nodes.length;

	return nodes.map((n, i) => {
		const angle = (2 * Math.PI * i) / count + Math.random() * 0.2;
		const r = spread * (0.3 + Math.random() * 0.7);
		return {
			...n,
			x: cx + Math.cos(angle) * r,
			y: cy + Math.sin(angle) * r,
			vx: 0,
			vy: 0,
			pinned: false
		};
	});
}

// ─── Force-Directed Layout Engine ────────────────────────────────────────────
// Mutates nodes in-place and returns them for chaining.

export function runForceLayout(
	nodes: LayoutNode[],
	edges: LayoutEdge[],
	width: number,
	height: number,
	config?: ForceLayoutConfig
): LayoutNode[] {
	if (nodes.length === 0) return nodes;

	const cfg = { ...DEFAULT_CONFIG, ...config };

	// Build O(1) Map for edge endpoint lookups (fixes O(n²) Array.find)
	const nodeMap = new Map<string, LayoutNode>();
	for (const n of nodes) {
		nodeMap.set(n.id, n);
		nodeMap.set(n.name, n);
	}

	for (let iter = 0; iter < cfg.iterations; iter++) {
		const cooling = 1 - iter / cfg.iterations;

		// Repulsion (all pairs)
		for (let i = 0; i < nodes.length; i++) {
			for (let j = i + 1; j < nodes.length; j++) {
				const a = nodes[i];
				const b = nodes[j];
				let dx = a.x - b.x;
				let dy = a.y - b.y;
				let dist = Math.hypot(dx, dy);
				if (dist < 1) dist = 1;
				const force = cfg.repulsionStrength / (dist * dist);
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

		// Attraction along edges (O(1) Map lookup)
		for (const e of edges) {
			const a = nodeMap.get(e.source);
			const b = nodeMap.get(e.target);
			if (!a || !b) continue;
			const dx = b.x - a.x;
			const dy = b.y - a.y;
			const dist = Math.hypot(dx, dy);
			if (dist < 1) continue;
			const force = cfg.attractionStrength * dist * cooling;
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
		const cx = width / 2;
		const cy = height / 2;
		for (const n of nodes) {
			if (n.pinned) continue;
			n.vx += (cx - n.x) * cfg.centeringStrength * cooling;
			n.vy += (cy - n.y) * cfg.centeringStrength * cooling;
		}

		// Apply velocity + damping
		for (const n of nodes) {
			if (n.pinned) continue;
			n.vx *= cfg.damping;
			n.vy *= cfg.damping;
			if (Math.abs(n.vx) < cfg.minVelocity && Math.abs(n.vy) < cfg.minVelocity) {
				n.vx = 0;
				n.vy = 0;
			}
			n.x += n.vx;
			n.y += n.vy;

			// Clamp to canvas bounds
			if (n.x < cfg.margin) {
				n.x = cfg.margin;
				n.vx = 0;
			}
			if (n.x > width - cfg.margin) {
				n.x = width - cfg.margin;
				n.vx = 0;
			}
			if (n.y < cfg.margin) {
				n.y = cfg.margin;
				n.vy = 0;
			}
			if (n.y > height - cfg.margin) {
				n.y = height - cfg.margin;
				n.vy = 0;
			}
		}
	}

	return nodes;
}
