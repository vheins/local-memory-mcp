import express from "express";
import { db } from "../lib/context.js";
import { jsonApiRes, handleController, HttpError, getAttributes } from "../lib/jsonApi.js";
import { KG_MAX_GRAPH_EDGES } from "../../mcp/utils/constants";

export class KGController {
	static async listEntities(req: express.Request, res: express.Response) {
		await handleController(req, res, () => {
			const repo = req.query.repo as string;
			if (!repo) throw new HttpError(400, "repo is required");

			const type = req.query.type as string | undefined;
			const search = req.query.search as string | undefined;

			const items = db.knowledgeGraph.listEntities(repo, { type, search });
			return jsonApiRes(items, "entity");
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

			const items = db.knowledgeGraph.listRelations(repo);

			return jsonApiRes(items, "relation");
		});
	}

	static async listGraph(req: express.Request, res: express.Response) {
		await handleController(req, res, () => {
			const repo = req.query.repo as string;
			if (!repo) throw new HttpError(400, "repo is required");

			const nodes = db.knowledgeGraph.listGraphNodes(repo);
			const edges = db.knowledgeGraph.listGraphEdges(repo);

			// Server-side edge cap (TASK-070): the response shape stays
			// `{ nodes, edges }`; `truncated` flags when the edge list was
			// clipped to KG_MAX_GRAPH_EDGES (client can show "showing top N").
			const truncated = edges.length >= KG_MAX_GRAPH_EDGES;

			return jsonApiRes({ id: `graph-${repo}`, nodes, edges, truncated }, "graph");
		});
	}

	static async createEntity(req: express.Request, res: express.Response) {
		await handleController(req, res, () => {
			const attributes = getAttributes(req);
			const { name, type, description, repo, owner } = attributes;

			if (!name) throw new HttpError(400, "name is required");

			const now = new Date().toISOString();
			db.knowledgeGraph.createEntity({
				name,
				type: type || "unknown",
				description: description || null,
				repo: repo || "",
				owner: owner || "",
				created_at: now,
				updated_at: now
			});

			const entity = db.knowledgeGraph.getEntityByName(name);
			return jsonApiRes(entity, "entity");
		});
	}

	static async deleteEntity(req: express.Request, res: express.Response) {
		await handleController(req, res, () => {
			const name = req.params.name as string;

			if (!db.knowledgeGraph.entityExists(name)) {
				throw new HttpError(404, "Entity not found");
			}

			db.knowledgeGraph.deleteEntity(name);
			return jsonApiRes({ message: "Deleted", name }, "status");
		});
	}

	static async createRelation(req: express.Request, res: express.Response) {
		await handleController(req, res, () => {
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
				db.knowledgeGraph.createRelation({
					from_entity,
					to_entity,
					relation_type,
					repo: repo || "",
					owner: owner || "",
					created_at: now
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
		await handleController(req, res, () => {
			const attributes = getAttributes(req);
			const { from_entity, to_entity, relation_type } = attributes;

			if (!from_entity || !to_entity || !relation_type) {
				throw new HttpError(400, "from_entity, to_entity, and relation_type are required");
			}

			const result = db.knowledgeGraph.deleteRelation(from_entity, to_entity, relation_type);

			if (result.changes === 0) {
				throw new HttpError(404, "Relation not found");
			}

			return jsonApiRes({ message: "Deleted" }, "status");
		});
	}

	static async deleteObservation(req: express.Request, res: express.Response) {
		await handleController(req, res, () => {
			const id = req.params.id as string;

			const result = db.knowledgeGraph.deleteObservation(id);

			if (result.changes === 0) {
				throw new HttpError(404, "Observation not found");
			}

			return jsonApiRes({ message: "Deleted", id }, "status");
		});
	}
}
