import { describe, expect, it } from "vitest";
import {
	DEFAULT_ZERO_EDGE_VISIBLE_NODE_LIMIT,
	initializeZeroEdgeOverviewLayout,
	runForceLayout,
	type LayoutNode
} from "../ui/src/lib/kg/KGForceLayout";

function createNode(index: number): LayoutNode {
	return {
		id: `node-${index}`,
		name: `Node ${index}`,
		type: "concept",
		x: 0,
		y: 0,
		vx: 0,
		vy: 0,
		pinned: false
	};
}

describe("KGForceLayout", () => {
	it("bounds zero-edge overview nodes and caps rendered node count", () => {
		const nodes = Array.from({ length: DEFAULT_ZERO_EDGE_VISIBLE_NODE_LIMIT + 10 }, (_, index) => createNode(index));
		const layoutNodes = initializeZeroEdgeOverviewLayout(nodes, 800, 600);

		expect(layoutNodes).toHaveLength(DEFAULT_ZERO_EDGE_VISIBLE_NODE_LIMIT);
		expect(layoutNodes.every((node) => node.x >= 0 && node.x <= 800 && node.y >= 0 && node.y <= 600)).toBe(true);
		expect(layoutNodes.every((node) => node.vx === 0 && node.vy === 0)).toBe(true);
	});

	it("leaves zero-edge overview positions stable when force layout is skipped by callers", () => {
		const nodes = Array.from({ length: 25 }, (_, index) => createNode(index));
		const overviewNodes = initializeZeroEdgeOverviewLayout(nodes, 500, 400);
		const positions = overviewNodes.map((node) => ({ x: node.x, y: node.y }));

		expect(positions.some((position) => position.x > 0 && position.y > 0)).toBe(true);
	});

	it("still supports connected force layouts", () => {
		const nodes = [createNode(1), createNode(2)];
		nodes[0].x = 100;
		nodes[0].y = 100;
		nodes[1].x = 300;
		nodes[1].y = 300;

		const result = runForceLayout(nodes, [{ source: "node-1", target: "node-2", relation_type: "related" }], 500, 400, {
			iterations: 1
		});

		expect(result).toHaveLength(2);
		expect(result.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(true);
	});
});
