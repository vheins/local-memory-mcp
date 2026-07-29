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

	const REPO = "delete-tests-repo";

	beforeEach(async () => {
		db = await createTestStore();
		vectors = new StubVectorStore(db);
		router = createRouter(db, vectors) as any;
	});

	it("should delete a single coding standard by id", async () => {
		const createRes = await router("tools/call", {
			name: "standard-write",
			arguments: {
				owner: "test",
				name: "Single Delete Standard",
				content: "Will be deleted individually.",
				repo: REPO,
				is_global: false,
				tags: ["delete"],
				metadata: { source: "test" }
			}
		});

		const createText = getPrimaryTextContent(createRes);
		const codeMatch = createText.match(/\[(\w+-\d+)\]/);
		const standardCode = codeMatch ? codeMatch[1] : null;

		const delRes = await router("tools/call", {
			name: "standard-delete",
			arguments: {
				owner: "test",
				repo: REPO,
				code: standardCode
			}
		});

		expect(getPrimaryTextContent(delRes)).toContain("Deleted 1 standard from");
		expect(db.standards.search({ repo: REPO, limit: 10, offset: 0 })).toHaveLength(0);
	});

	it("should delete a single coding standard by code", async () => {
		const createRes = await router("tools/call", {
			name: "standard-write",
			arguments: {
				owner: "test",
				name: "Code Delete Standard",
				content: "Will be deleted by code.",
				repo: REPO,
				is_global: false,
				tags: ["delete"],
				metadata: { source: "test" }
			}
		});

		const createText2 = getPrimaryTextContent(createRes);
		const codeMatch2 = createText2.match(/\[(\w+-\d+)\]/);
		const stdCode = codeMatch2 ? codeMatch2[1] : null;

		const delRes = await router("tools/call", {
			name: "standard-delete",
			arguments: {
				owner: "test",
				repo: REPO,
				code: stdCode
			}
		});

		expect(getPrimaryTextContent(delRes)).toContain("Deleted 1 standard from");
		expect(db.standards.search({ repo: REPO, limit: 10, offset: 0 })).toHaveLength(0);
	});

	it("should bulk delete coding standards", async () => {
		await router("tools/call", {
			name: "standard-write",
			arguments: {
				owner: "test",
				name: "Standard A",
				content: "Use API schemas for every public endpoint.",
				repo: REPO,
				is_global: false,
				tags: ["api"],
				metadata: { source: "test" }
			}
		});

		await router("tools/call", {
			name: "standard-write",
			arguments: {
				owner: "test",
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
				owner: "test",
				repo: REPO,
				ids: standards.map((standard) => standard.id)
			}
		});

		expect(getPrimaryTextContent(delRes)).toContain("Deleted 2 standards from");
		expect(db.standards.search({ repo: REPO, limit: 10, offset: 0 })).toHaveLength(0);
	});
});
