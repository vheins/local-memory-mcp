import express from "express";
import { db } from "../lib/context";
import { jsonApiRes, jsonApiError, getAttributes } from "../lib/jsonApi";

export class KGController {
	static async listEntities(req: express.Request, res: express.Response) {
		try {
			await db.refresh();
			const repo = req.query.repo as string;
			if (!repo) return res.status(400).json(jsonApiError("repo is required", 400));

			const type = req.query.type as string | undefined;
			const search = req.query.search as string | undefined;

			let sql = "SELECT * FROM entities WHERE repo = ?";
			const params: unknown[] = [repo];

			if (type) {
				sql += " AND type = ?";
				params.push(type);
			}
			if (search) {
				sql += " AND name LIKE ?";
				params.push(`%${search}%`);
			}
			sql += " ORDER BY name";

			const items = db.db.prepare(sql).all(...params);
			res.json(jsonApiRes(items, "entity"));
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			res.status(500).json(jsonApiError(message));
		}
	}

	static async getEntity(req: express.Request, res: express.Response) {
		try {
			await db.refresh();
			const name = req.params.name;

			const entity = db.db.prepare("SELECT * FROM entities WHERE name = ?").get(name) as
				| Record<string, unknown>
				| undefined;
			if (!entity) return res.status(404).json(jsonApiError("Entity not found", 404));

			const relations = db.db
				.prepare("SELECT * FROM relations WHERE from_entity = ? OR to_entity = ? ORDER BY relation_type")
				.all(name, name);

			const observations = db.db
				.prepare("SELECT * FROM observations WHERE entity_name = ? ORDER BY created_at DESC")
				.all(name);

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

			const items = db.db.prepare("SELECT * FROM relations WHERE repo = ? ORDER BY from_entity, to_entity").all(repo);

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

			const nodes = db.db
				.prepare(
					`SELECT e.name, e.type, e.description, COUNT(o.id) as memoryCount
					 FROM entities e
					 LEFT JOIN observations o ON o.entity_name = e.name
					 WHERE e.repo = ?
					 GROUP BY e.name
					 ORDER BY e.name`
				)
				.all(repo);

			const edges = db.db
				.prepare(
					"SELECT from_entity as source, to_entity as target, relation_type FROM relations WHERE repo = ? ORDER BY from_entity, to_entity"
				)
				.all(repo);

			res.json(jsonApiRes({ id: `graph-${repo}`, nodes, edges }, "graph"));
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
			db.db
				.prepare(
					`INSERT INTO entities (name, type, description, repo, owner, created_at, updated_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?)`
				)
				.run(name, type || "unknown", description || null, repo || "", owner || "", now, now);

			const entity = db.db.prepare("SELECT * FROM entities WHERE name = ?").get(name);
			res.json(jsonApiRes(entity, "entity"));
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			res.status(500).json(jsonApiError(message));
		}
	}

	static async deleteEntity(req: express.Request, res: express.Response) {
		try {
			await db.refresh();
			const name = req.params.name;

			const existing = db.db.prepare("SELECT name FROM entities WHERE name = ?").get(name);
			if (!existing) return res.status(404).json(jsonApiError("Entity not found", 404));

			db.db.prepare("DELETE FROM entities WHERE name = ?").run(name);
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

			const fromExists = db.db.prepare("SELECT 1 FROM entities WHERE name = ?").get(from_entity);
			if (!fromExists) {
				return res.status(400).json(jsonApiError(`Source entity '${from_entity}' not found`, 400));
			}

			const toExists = db.db.prepare("SELECT 1 FROM entities WHERE name = ?").get(to_entity);
			if (!toExists) {
				return res.status(400).json(jsonApiError(`Target entity '${to_entity}' not found`, 400));
			}

			const now = new Date().toISOString();
			db.db
				.prepare(
					`INSERT INTO relations (from_entity, to_entity, relation_type, repo, owner, created_at)
					 VALUES (?, ?, ?, ?, ?, ?)`
				)
				.run(from_entity, to_entity, relation_type, repo || "", owner || "", now);

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

			const result = db.db
				.prepare("DELETE FROM relations WHERE from_entity = ? AND to_entity = ? AND relation_type = ?")
				.run(from_entity, to_entity, relation_type);

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
			const id = req.params.id;

			const result = db.db.prepare("DELETE FROM observations WHERE id = ?").run(id);

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
