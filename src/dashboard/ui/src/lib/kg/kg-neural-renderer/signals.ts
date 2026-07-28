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

export function clearSignals(): void {
	signals.length = 0;
	lastSignalSpawn = 0;
}

export function getSignals(): Signal[] {
	return signals;
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

	for (const n3d of nodes3d) {
		if (!n3d.isHub) continue;
		if (signals.length >= MAX_SIGNALS) break;

		// Find edges connected to this hub
		const hubEdges = animEdges.filter((e) => e.source === n3d.node.id || e.target === n3d.node.id);
		if (hubEdges.length === 0) continue;

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
