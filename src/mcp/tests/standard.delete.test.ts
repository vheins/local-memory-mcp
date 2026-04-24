import { describe, it, expect, beforeEach } from "vitest";
import { createRouter } from "../router";
import { createTestStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import type { VectorStore } from "../types";
import { getPrimaryTextContent } from "../utils/mcp-response";

describe("MCP Local Memory - Standard Delete", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let vectors: VectorStore;
	let router: (method: string, params: Record<string, unknown>) => Promise<any>;

	const REPO = "bulk-standards-repo";

	beforeEach(async () => {
		db = await createTestStore();
		vectors = new StubVectorStore(db);
		router = createRouter(db, vectors) as any;
	});

	it("should bulk delete coding standards", async () => {
		await router("tools/call", {
			name: "standard-store",
			arguments: {
				name: "Standard A",
				content: "Use API schemas for every public endpoint.",
				repo: REPO,
				is_global: false,
				tags: ["api"],
				metadata: { source: "test" }
			}
		});

		await router("tools/call", {
			name: "standard-store",
			arguments: {
				name: "Standard B",
				content: "Use service-layer boundaries for write operations.",
				repo: REPO,
				is_global: false,
				tags: ["architecture"],
				metadata: { source: "test" }
			}
		});

		const standards = db.standards.search({ repo: REPO, limit: 10, offset: 0 });
		expect(standards.length).toBe(2);

		const delRes = await router("tools/call", {
			name: "standard-delete",
			arguments: {
				repo: REPO,
				ids: standards.map((standard) => standard.id)
			}
		});

		expect(getPrimaryTextContent(delRes)).toContain("Deleted 2 coding standard(s)");
		expect(db.standards.search({ repo: REPO, limit: 10, offset: 0 })).toHaveLength(0);
	});
});
