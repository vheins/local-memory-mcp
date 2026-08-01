import express from "express";
import { db } from "../lib/context";
import { jsonApiRes, jsonApiError, getAttributes } from "../lib/jsonApi";
import { KG_MAX_GRAPH_EDGES } from "../../mcp/utils/constants";

export class KGController {
	static async listEntities(req: express.Request, res: express.Response) {
		try {
			await db.refresh();
			const repo = req.query.repo as string;
			if (!repo) return res.status(400).json(jsonApiError("repo is required", 400));

			const type = req.query.type as string | undefined;
			const search = req.query.search as string | undefined;

			const items = db.knowledgeGraph.listEntities(repo, { type, search });
			res.json(jsonApiRes(items, "entity"));
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			res.status(500).json(jsonApiError(message));
		}
	}

	static async getEntity(req: express.Request, res: express.Response) {
		try {
			await db.refresh();
			const name = req.params.name as string;

			const entity = db.knowledgeGraph.getEntityByName(name);
			if (!entity) return res.status(404).json(jsonApiError("Entity not found", 404));

			const relations = db.knowledgeGraph.getRelationsByName(name);
			const observations = db.knowledgeGraph.getObservationsByName(name);

			res.json(jsonApiRes({ id: entity.name, entity, relations, observations }, "entity"));
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			res.status(500).json(jsonApiError(message));
		}
	}

	static async listRelations(req: express.Request, res: express.Response) {
		try {
			await db.refresh();
			const repo = req.query.repo as string;
			if (!repo) return res.status(400).json(jsonApiError("repo is required", 400));

			const items = db.knowledgeGraph.listRelations(repo);

			res.json(jsonApiRes(items, "relation"));
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			res.status(500).json(jsonApiError(message));
		}
	}

	static async listGraph(req: express.Request, res: express.Response) {
		try {
			await db.refresh();
			const repo = req.query.repo as string;
			if (!repo) return res.status(400).json(jsonApiError("repo is required", 400));

			const nodes = db.knowledgeGraph.listGraphNodes(repo);
			const edges = db.knowledgeGraph.listGraphEdges(repo);

			// Server-side edge cap (TASK-070): the response shape stays
			// `{ nodes, edges }`; `truncated` flags when the edge list was
			// clipped to KG_MAX_GRAPH_EDGES (client can show "showing top N").
			const truncated = edges.length >= KG_MAX_GRAPH_EDGES;

			res.json(jsonApiRes({ id: `graph-${repo}`, nodes, edges, truncated }, "graph"));
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			res.status(500).json(jsonApiError(message));
		}
	}

	static async createEntity(req: express.Request, res: express.Response) {
		try {
			await db.refresh();
			const attributes = getAttributes(req);
			const { name, type, description, repo, owner } = attributes;

			if (!name) return res.status(400).json(jsonApiError("name is required", 400));

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
			res.json(jsonApiRes(entity, "entity"));
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			res.status(500).json(jsonApiError(message));
		}
	}

	static async deleteEntity(req: express.Request, res: express.Response) {
		try {
			await db.refresh();
			const name = req.params.name as string;

			if (!db.knowledgeGraph.entityExists(name)) {
				return res.status(404).json(jsonApiError("Entity not found", 404));
			}

			db.knowledgeGraph.deleteEntity(name);
			res.json(jsonApiRes({ message: "Deleted", name }, "status"));
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			res.status(500).json(jsonApiError(message));
		}
	}

	static async createRelation(req: express.Request, res: express.Response) {
		try {
			await db.refresh();
			const attributes = getAttributes(req);
			const { from_entity, to_entity, relation_type, repo, owner } = attributes;

			if (!from_entity || !to_entity || !relation_type) {
				return res.status(400).json(jsonApiError("from_entity, to_entity, and relation_type are required", 400));
			}

			if (!db.knowledgeGraph.entityExists(from_entity)) {
				return res.status(400).json(jsonApiError(`Source entity '${from_entity}' not found`, 400));
			}

			if (!db.knowledgeGraph.entityExists(to_entity)) {
				return res.status(400).json(jsonApiError(`Target entity '${to_entity}' not found`, 400));
			}

			const now = new Date().toISOString();
			db.knowledgeGraph.createRelation({
				from_entity,
				to_entity,
				relation_type,
				repo: repo || "",
				owner: owner || "",
				created_at: now
			});

			res.json(jsonApiRes({ from_entity, to_entity, relation_type }, "relation"));
		} catch (err: unknown) {
			const sqlerr = err as Error & { code?: string };
			if (sqlerr.code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
				return res.status(409).json(jsonApiError("Relation already exists", 409));
			}
			const message = err instanceof Error ? err.message : "Internal server error";
			res.status(500).json(jsonApiError(message));
		}
	}

	static async deleteRelation(req: express.Request, res: express.Response) {
		try {
			await db.refresh();
			const attributes = getAttributes(req);
			const { from_entity, to_entity, relation_type } = attributes;

			if (!from_entity || !to_entity || !relation_type) {
				return res.status(400).json(jsonApiError("from_entity, to_entity, and relation_type are required", 400));
			}

			const result = db.knowledgeGraph.deleteRelation(from_entity, to_entity, relation_type);

			if (result.changes === 0) {
				return res.status(404).json(jsonApiError("Relation not found", 404));
			}

			res.json(jsonApiRes({ message: "Deleted" }, "status"));
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			res.status(500).json(jsonApiError(message));
		}
	}

	static async deleteObservation(req: express.Request, res: express.Response) {
		try {
			await db.refresh();
			const id = req.params.id as string;

			const result = db.knowledgeGraph.deleteObservation(id);

			if (result.changes === 0) {
				return res.status(404).json(jsonApiError("Observation not found", 404));
			}

			res.json(jsonApiRes({ message: "Deleted", id }, "status"));
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			res.status(500).json(jsonApiError(message));
		}
	}
}
