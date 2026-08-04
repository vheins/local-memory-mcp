import express from "express";
import { db } from "../lib/context";
import { jsonApiRes, handleController, HttpError, getAttributes, parsePageParams } from "../lib/jsonApi";
import { KG_MAX_GRAPH_EDGES } from "../../mcp/utils/constants";

export class KGController {
	static async listEntities(req: express.Request, res: express.Response) {
		await handleController(req, res, () => {
			const repo = req.query.repo as string;
			if (!repo) throw new HttpError(400, "repo is required");

			const type = req.query.type as string | undefined;
			const search = req.query.search as string | undefined;
			const { page, pageSize, offset } = parsePageParams(req.query);

			const total = db.knowledgeGraph.countEntities(repo, { type, search });
			const items = db.knowledgeGraph.listEntities(repo, { type, search, limit: pageSize, offset });

			return jsonApiRes(items, "entity", {
				meta: {
					page,
					pageSize,
					totalItems: total,
					totalPages: Math.ceil(total / pageSize)
				}
			});
		});
	}

	static async getEntity(req: express.Request, res: express.Response) {
		await handleController(req, res, () => {
			const name = req.params.name as string;

			const entity = db.knowledgeGraph.getEntityByName(name);
			if (!entity) throw new HttpError(404, "Entity not found");

			const relations = db.knowledgeGraph.getRelationsByName(name);
			const observations = db.knowledgeGraph.getObservationsByName(name);

			return jsonApiRes({ id: entity.name, entity, relations, observations }, "entity");
		});
	}

	static async listRelations(req: express.Request, res: express.Response) {
		await handleController(req, res, () => {
			const repo = req.query.repo as string;
			if (!repo) throw new HttpError(400, "repo is required");

			const { page, pageSize, offset } = parsePageParams(req.query);

			const total = db.knowledgeGraph.countRelations(repo);
			const items = db.knowledgeGraph.listRelations(repo, { limit: pageSize, offset });

			return jsonApiRes(items, "relation", {
				meta: {
					page,
					pageSize,
					totalItems: total,
					totalPages: Math.ceil(total / pageSize)
				}
			});
		});
	}

	static async listGraph(req: express.Request, res: express.Response) {
		await handleController(req, res, () => {
			const repo = req.query.repo as string;
			if (!repo) throw new HttpError(400, "repo is required");

			const { page, pageSize, offset } = parsePageParams(req.query);

			// Optional `includeEdges` query param (TASK-197): consumers that only
			// need the node set can skip the edge fetch + truncation probe entirely,
			// avoiding a payload of up to KG_MAX_GRAPH_EDGES (4000) edges per request.
			// Any value other than the exact string "false" → true (default true), so
			// absent/`true`/garbage all keep the current behavior. Nodes are unaffected:
			// degree is computed server-side via SQL CTE independent of this edge set.
			const includeEdges = (req.query.includeEdges as string | undefined) !== "false";

			const nodesTotal = db.knowledgeGraph.countGraphNodes(repo);
			const nodes = db.knowledgeGraph.listGraphNodes(repo, { limit: pageSize, offset });

			let edges: Array<{ source: string; target: string; relation_type: string }> = [];
			let truncated = false;

			if (includeEdges) {
				// Probe: request KG_MAX_GRAPH_EDGES + 1 rows to detect truncation.
				// If the extra row is present, the graph exceeds the cap and we
				// return only the first KG_MAX_GRAPH_EDGES edges with truncated=true.
				const rawEdges = db.knowledgeGraph.listGraphEdges(repo, KG_MAX_GRAPH_EDGES, true);
				truncated = rawEdges.length > KG_MAX_GRAPH_EDGES;
				edges = truncated ? rawEdges.slice(0, KG_MAX_GRAPH_EDGES) : rawEdges;
			}

			return jsonApiRes({ id: `graph-${repo}`, nodes, edges, truncated }, "graph", {
				meta: {
					page,
					pageSize,
					totalItems: nodesTotal,
					totalPages: Math.ceil(nodesTotal / pageSize)
				}
			});
		});
	}

	static async createEntity(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const attributes = getAttributes(req);
			const { name, type, description, repo, owner } = attributes;

			if (!name) throw new HttpError(400, "name is required");

			const now = new Date().toISOString();
			// Write-lock invariant (TASK-102): all DB mutations acquire the file
			// lock so dashboard writes serialize with MCP tool writes (LWW/conflict
			// semantics). Only the mutation is locked; the read-back stays outside.
			await db.withWrite(() => {
				db.knowledgeGraph.createEntity({
					name,
					type: type || "unknown",
					description: description || null,
					repo: repo || "",
					owner: owner || "",
					created_at: now,
					updated_at: now
				});
			});

			const entity = db.knowledgeGraph.getEntityByName(name);
			return jsonApiRes(entity, "entity");
		});
	}

	static async deleteEntity(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const name = req.params.name as string;

			if (!db.knowledgeGraph.entityExists(name)) {
				throw new HttpError(404, "Entity not found");
			}

			await db.withWrite(() => db.knowledgeGraph.deleteEntity(name));
			return jsonApiRes({ message: "Deleted", name }, "status");
		});
	}

	static async createRelation(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const attributes = getAttributes(req);
			const { from_entity, to_entity, relation_type, repo, owner } = attributes;

			if (!from_entity || !to_entity || !relation_type) {
				throw new HttpError(400, "from_entity, to_entity, and relation_type are required");
			}

			if (!db.knowledgeGraph.entityExists(from_entity)) {
				throw new HttpError(400, `Source entity '${from_entity}' not found`);
			}

			if (!db.knowledgeGraph.entityExists(to_entity)) {
				throw new HttpError(400, `Target entity '${to_entity}' not found`);
			}

			const now = new Date().toISOString();
			try {
				await db.withWrite(() => {
					db.knowledgeGraph.createRelation({
						from_entity,
						to_entity,
						relation_type,
						repo: repo || "",
						owner: owner || "",
						created_at: now
					});
				});
			} catch (err: unknown) {
				const sqlerr = err as Error & { code?: string };
				if (sqlerr.code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
					throw new HttpError(409, "Relation already exists");
				}
				throw err;
			}

			return jsonApiRes({ from_entity, to_entity, relation_type }, "relation");
		});
	}

	static async deleteRelation(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const attributes = getAttributes(req);
			const { from_entity, to_entity, relation_type } = attributes;

			if (!from_entity || !to_entity || !relation_type) {
				throw new HttpError(400, "from_entity, to_entity, and relation_type are required");
			}

			const result = await db.withWrite(() => db.knowledgeGraph.deleteRelation(from_entity, to_entity, relation_type));

			if (result.changes === 0) {
				throw new HttpError(404, "Relation not found");
			}

			return jsonApiRes({ message: "Deleted" }, "status");
		});
	}

	static async deleteObservation(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const id = req.params.id as string;

			const result = await db.withWrite(() => db.knowledgeGraph.deleteObservation(id));

			if (result.changes === 0) {
				throw new HttpError(404, "Observation not found");
			}

			return jsonApiRes({ message: "Deleted", id }, "status");
		});
	}
}
