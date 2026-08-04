import { db } from "../lib/context";
import { ServiceError } from "../lib/jsonApi";
import { KG_MAX_GRAPH_EDGES } from "../../mcp/utils/constants";
import type { KgEntityRow, KgRelationRow, KgObservationRow } from "../../mcp/entities/knowledge-graph";

/**
 * Knowledge-graph service layer.
 *
 * Owns ALL db.knowledgeGraph.* access for the dashboard KG endpoints:
 * entity/relation/observation CRUD, graph assembly (incl. the includeEdges
 * skip and the LIMIT+1 truncation probe), and the write-lock boundaries
 * (TASK-102 — every mutation crosses `db.withWrite`, reads stay outside).
 * Controllers delegate here instead of touching `db` directly.
 */

export interface KgListResult<T> {
	items: T[];
	total: number;
}

/** Wire payload for GET /api/kg/graph — `data` is passed to jsonApiRes, `totalItems` feeds pagination meta. */
export interface KgGraphResult {
	data: {
		id: string;
		nodes: Array<{ name: string; type: string }>;
		edges: Array<{ source: string; target: string; relation_type: string }>;
		truncated: boolean;
	};
	totalItems: number;
}

export const KgService = {
	listEntities(
		repo: string,
		type: string | undefined,
		search: string | undefined,
		limit: number,
		offset: number
	): KgListResult<KgEntityRow> {
		const total = db.knowledgeGraph.countEntities(repo, { type, search });
		const items = db.knowledgeGraph.listEntities(repo, { type, search, limit, offset });
		return { items, total };
	},

	getEntity(name: string): {
		id: string;
		entity: KgEntityRow;
		relations: KgRelationRow[];
		observations: KgObservationRow[];
	} {
		const entity = db.knowledgeGraph.getEntityByName(name);
		if (!entity) throw new ServiceError(404, "Entity not found");

		const relations = db.knowledgeGraph.getRelationsByName(name);
		const observations = db.knowledgeGraph.getObservationsByName(name);

		return { id: entity.name, entity, relations, observations };
	},

	listRelations(repo: string, limit: number, offset: number): KgListResult<KgRelationRow> {
		const total = db.knowledgeGraph.countRelations(repo);
		const items = db.knowledgeGraph.listRelations(repo, { limit, offset });
		return { items, total };
	},

	/**
	 * Graph payload for a repo. Optional `includeEdges` (TASK-197): consumers
	 * that only need the node set can skip the edge fetch + truncation probe
	 * entirely. When included, a LIMIT+1 probe detects whether the edge set
	 * exceeds KG_MAX_GRAPH_EDGES (TASK-148 pattern) and slices to the cap.
	 *
	 * Optional `graphLimit` (TASK-212): the top-N-by-degree view. When set,
	 * ignores page/pageSize and returns the N highest-degree nodes in one
	 * shot (`listGraphNodes` is degree-ordered); when absent, the legacy
	 * paginated window (`limit`/`offset`) is unchanged for backward compat.
	 */
	listGraph(repo: string, limit: number, offset: number, includeEdges: boolean, graphLimit?: number): KgGraphResult {
		const nodesTotal = db.knowledgeGraph.countGraphNodes(repo);
		const nodes = db.knowledgeGraph.listGraphNodes(repo, {
			limit: graphLimit ?? limit,
			offset: graphLimit !== undefined ? 0 : offset
		});

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

		return {
			data: { id: `graph-${repo}`, nodes, edges, truncated },
			totalItems: nodesTotal
		};
	},

	async createEntity(attributes: {
		name: string;
		type?: string;
		description?: string | null;
		repo?: string;
		owner?: string;
	}): Promise<KgEntityRow> {
		const { name, type, description, repo, owner } = attributes;

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
		return entity as KgEntityRow;
	},

	async deleteEntity(name: string): Promise<{ message: string; name: string }> {
		if (!db.knowledgeGraph.entityExists(name)) {
			throw new ServiceError(404, "Entity not found");
		}

		await db.withWrite(() => db.knowledgeGraph.deleteEntity(name));
		return { message: "Deleted", name };
	},

	async createRelation(attributes: {
		from_entity: string;
		to_entity: string;
		relation_type: string;
		repo?: string;
		owner?: string;
	}): Promise<{ from_entity: string; to_entity: string; relation_type: string }> {
		const { from_entity, to_entity, relation_type, repo, owner } = attributes;

		if (!db.knowledgeGraph.entityExists(from_entity)) {
			throw new ServiceError(400, `Source entity '${from_entity}' not found`);
		}

		if (!db.knowledgeGraph.entityExists(to_entity)) {
			throw new ServiceError(400, `Target entity '${to_entity}' not found`);
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
				throw new ServiceError(409, "Relation already exists");
			}
			throw err;
		}

		return { from_entity, to_entity, relation_type };
	},

	async deleteRelation(from_entity: string, to_entity: string, relation_type: string): Promise<{ message: string }> {
		const result = await db.withWrite(() => db.knowledgeGraph.deleteRelation(from_entity, to_entity, relation_type));

		if (result.changes === 0) {
			throw new ServiceError(404, "Relation not found");
		}

		return { message: "Deleted" };
	},

	async deleteObservation(id: string): Promise<{ message: string; id: string }> {
		const result = await db.withWrite(() => db.knowledgeGraph.deleteObservation(id));

		if (result.changes === 0) {
			throw new ServiceError(404, "Observation not found");
		}

		return { message: "Deleted", id };
	}
};
