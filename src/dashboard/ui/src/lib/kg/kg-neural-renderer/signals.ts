/**
 * Signal management for the Knowledge Graph Neural Renderer.
 *
 * Manages signal spawning, updating, and lifecycle.
 */

import type { Signal } from "./edges";
import type { Node3D } from "./layout";
import type { LayoutEdge } from "../KGForceLayout";
import { SIGNAL_SPAWN_INTERVAL, MAX_SIGNALS, SIGNAL_SPEED } from "./layout";

// ─── Module-Level State ─────────────────────────────────────────────────────

const signals: Signal[] = [];
let lastSignalSpawn = 0;

// ─── Pre-computed hub edges for O(1) lookup ────────────────────────────────
const hubEdgesCache: Map<string, LayoutEdge[]> = new Map();

export function clearSignals(): void {
	signals.length = 0;
	lastSignalSpawn = 0;
	hubEdgesCache.clear();
}

export function getSignals(): Signal[] {
	return signals;
}

// ─── Build hub edges cache (call once per data update) ─────────────────────

function buildHubEdgesCache(nodes3d: Node3D[], animEdges: LayoutEdge[]): void {
	hubEdgesCache.clear();
	for (const n3d of nodes3d) {
		if (!n3d.isHub) continue;
		const nodeId = n3d.node.id;
		const edges: LayoutEdge[] = [];
		for (const e of animEdges) {
			if (e.source === nodeId || e.target === nodeId) {
				edges.push(e);
			}
		}
		if (edges.length > 0) {
			hubEdgesCache.set(nodeId, edges);
		}
	}
}

// ─── Hub signal spawning ───────────────────────────────────────────────────

export function spawnSignals(
	now: number,
	nodes3d: Node3D[],
	animEdges: LayoutEdge[],
	nodeIndexById: Map<string, number>
): void {
	if (now - lastSignalSpawn < SIGNAL_SPAWN_INTERVAL) return;
	if (signals.length >= MAX_SIGNALS) return;
	lastSignalSpawn = now;

	// Build cache if empty (first call or after data update)
	if (hubEdgesCache.size === 0 && nodes3d.length > 0) {
		buildHubEdgesCache(nodes3d, animEdges);
	}

	for (const n3d of nodes3d) {
		if (!n3d.isHub) continue;
		if (signals.length >= MAX_SIGNALS) break;

		// O(1) lookup from pre-computed cache
		const hubEdges = hubEdgesCache.get(n3d.node.id);
		if (!hubEdges || hubEdges.length === 0) continue;

		const edge = hubEdges[Math.floor(Math.random() * hubEdges.length)];
		const fromId = edge.source === n3d.node.id ? edge.source : edge.target;
		const toId = edge.source === n3d.node.id ? edge.target : edge.source;

		const fromIdx = nodeIndexById.get(fromId);
		const toIdx = nodeIndexById.get(toId);
		if (fromIdx === undefined || toIdx === undefined) continue;

		if (Math.random() > 0.4) continue;

		signals.push({
			fromIdx,
			toIdx,
			progress: 0,
			createdAt: now,
			color: n3d.color
		});
	}
}

// ─── Signal update ─────────────────────────────────────────────────────────

export function updateSignals(): void {
	for (let i = signals.length - 1; i >= 0; i--) {
		signals[i].progress += SIGNAL_SPEED;
		if (signals[i].progress >= 1) {
			signals.splice(i, 1);
		}
	}
}
