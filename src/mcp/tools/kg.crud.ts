import { SQLiteStore } from "../storage/sqlite";
import { VectorStore } from "../types";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";
import { logger } from "../utils/logger";
import {
	CreateEntitySchema,
	DeleteEntitySchema,
	CreateRelationSchema,
	DeleteRelationSchema,
	DeleteObservationSchema
} from "./schemas";

// ── Create Entity ─────────────────────────────────────────────────────────

export async function handleCreateEntity(
	params: Record<string, unknown>,
	db: SQLiteStore,
	_vectors: VectorStore
): Promise<McpResponse> {
	const validated = CreateEntitySchema.parse(params);
	const { name, type, description, owner, repo, json } = validated;

	const now = new Date().toISOString();

	try {
		const txn = db.db.transaction(() => {
			db.db
				.prepare(
					`INSERT INTO entities (name, type, description, repo, owner, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
				)
				.run(name, type, description ?? null, repo ?? "", owner ?? "", now, now);
		});
		txn();
	} catch (error: unknown) {
		const err = error as Error & { code?: string };
		if (err.code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
			const response = createMcpResponse(
				{
					success: false,
					error: "ENTITY_ALREADY_EXISTS",
					message: `Entity '${name}' already exists in this repo.`
				},
				`Entity '${name}' already exists.`,
				{ includeJson: json }
			);
			response.isError = true;
			return response;
		}
		logger.error("[Tool] create_entity failed", { error: String(error) });
		throw error;
	}

	logger.info("[Tool] create_entity", { repo: repo ?? "", entity: name });

	return createMcpResponse(
		{
			success: true,
			entity: { name, type, description, repo: repo ?? "", owner: owner ?? "" }
		},
		`Created entity '${name}' (${type}) in repo "${repo ?? ""}".`,
		{
			structuredContentPathHint: "entity",
			includeJson: json
		}
	);
}

// ── Delete Entity ─────────────────────────────────────────────────────────

export async function handleDeleteEntity(
	params: Record<string, unknown>,
	db: SQLiteStore,
	_vectors: VectorStore
): Promise<McpResponse> {
	const validated = DeleteEntitySchema.parse(params);
	const { name, owner: _owner, repo, json } = validated;

	let changes = 0;
	try {
		const txn = db.db.transaction(() => {
			const result = db.db.prepare(`DELETE FROM entities WHERE name = ?`).run(name);
			changes = result.changes;
		});
		txn();
	} catch (error: unknown) {
		const err = error as Error & { code?: string };
		logger.error("[Tool] delete_entity failed", { error: String(error) });

		if (err.code === "SQLITE_CONSTRAINT_FOREIGNKEY" || err.code === "SQLITE_CONSTRAINT") {
			const response = createMcpResponse(
				{
					success: false,
					error: "ENTITY_IN_USE",
					message: `Entity '${name}' is referenced by existing relations and cannot be deleted.`
				},
				`Entity '${name}' is in use and cannot be deleted.`,
				{ includeJson: json }
			);
			response.isError = true;
			return response;
		}

		const response = createMcpResponse(
			{
				success: false,
				error: "DELETE_FAILED",
				message: `Failed to delete entity '${name}'.`
			},
			`Failed to delete entity '${name}'.`,
			{ includeJson: json }
		);
		response.isError = true;
		return response;
	}

	logger.info("[Tool] delete_entity", { repo: repo ?? "", entity: name, changes });

	if (changes === 0) {
		return createMcpResponse(
			{
				success: false,
				error: "ENTITY_NOT_FOUND",
				message: `Entity '${name}' not found.`
			},
			`Entity '${name}' not found.`,
			{ includeJson: json }
		);
	}

	return createMcpResponse(
		{
			success: true,
			deletedCount: changes
		},
		`Deleted entity '${name}' and its cascade (relations, observations).`,
		{
			structuredContentPathHint: "deletedCount",
			includeJson: json
		}
	);
}

// ── Create Relation ───────────────────────────────────────────────────────

export async function handleCreateRelation(
	params: Record<string, unknown>,
	db: SQLiteStore,
	_vectors: VectorStore
): Promise<McpResponse> {
	const validated = CreateRelationSchema.parse(params);
	const { from_entity, to_entity, relation_type, owner, repo, json } = validated;

	const now = new Date().toISOString();

	try {
		const txn = db.db.transaction(() => {
			// Verify both entities exist (inside transaction for atomicity)
			const fromExists = db.db.prepare(`SELECT 1 FROM entities WHERE name = ?`).get(from_entity);
			if (!fromExists) {
				throw new Error("FROM_ENTITY_NOT_FOUND");
			}

			const toExists = db.db.prepare(`SELECT 1 FROM entities WHERE name = ?`).get(to_entity);
			if (!toExists) {
				throw new Error("TO_ENTITY_NOT_FOUND");
			}

			db.db
				.prepare(
					`INSERT INTO relations (from_entity, to_entity, relation_type, repo, owner, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
				)
				.run(from_entity, to_entity, relation_type, repo ?? "", owner ?? "", now);
		});
		txn();
	} catch (error: unknown) {
		const err = error as Error & { code?: string };

		if (err.message === "FROM_ENTITY_NOT_FOUND") {
			const response = createMcpResponse(
				{
					success: false,
					error: "FROM_ENTITY_NOT_FOUND",
					message: `Source entity '${from_entity}' not found. Create it first.`
				},
				`Source entity '${from_entity}' not found.`,
				{ includeJson: json }
			);
			response.isError = true;
			return response;
		}

		if (err.message === "TO_ENTITY_NOT_FOUND") {
			const response = createMcpResponse(
				{
					success: false,
					error: "TO_ENTITY_NOT_FOUND",
					message: `Target entity '${to_entity}' not found. Create it first.`
				},
				`Target entity '${to_entity}' not found.`,
				{ includeJson: json }
			);
			response.isError = true;
			return response;
		}

		if (err.code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
			const response = createMcpResponse(
				{
					success: false,
					error: "RELATION_ALREADY_EXISTS",
					message: `Relation '${from_entity} →[${relation_type}]→ ${to_entity}' already exists.`
				},
				`Relation already exists.`,
				{ includeJson: json }
			);
			response.isError = true;
			return response;
		}

		// FK violation: one of the entities was removed before the INSERT
		if (err.code === "SQLITE_CONSTRAINT_FOREIGNKEY" || err.code === "SQLITE_CONSTRAINT") {
			const response = createMcpResponse(
				{
					success: false,
					error: "ENTITY_NOT_FOUND",
					message: `Entity not found — cannot create relation.`
				},
				`Entity not found — cannot create relation.`,
				{ includeJson: json }
			);
			response.isError = true;
			return response;
		}

		logger.error("[Tool] create_relation failed", { error: String(error) });
		throw error;
	}

	logger.info("[Tool] create_relation", {
		repo: repo ?? "",
		from: from_entity,
		to: to_entity,
		type: relation_type
	});

	return createMcpResponse(
		{
			success: true,
			relation: { from_entity, to_entity, relation_type }
		},
		`Created relation '${from_entity} —[${relation_type}]→ ${to_entity}' in repo "${repo ?? ""}".`,
		{
			structuredContentPathHint: "relation",
			includeJson: json
		}
	);
}

// ── Delete Relation ───────────────────────────────────────────────────────

export async function handleDeleteRelation(
	params: Record<string, unknown>,
	db: SQLiteStore,
	_vectors: VectorStore
): Promise<McpResponse> {
	const validated = DeleteRelationSchema.parse(params);
	const { from_entity, to_entity, relation_type, owner: _owner, repo, json } = validated;

	let changes = 0;
	try {
		const txn = db.db.transaction(() => {
			const result = db.db
				.prepare(`DELETE FROM relations WHERE from_entity = ? AND to_entity = ? AND relation_type = ?`)
				.run(from_entity, to_entity, relation_type);
			changes = result.changes;
		});
		txn();
	} catch (error: unknown) {
		logger.error("[Tool] delete_relation failed", { error: String(error) });

		const response = createMcpResponse(
			{
				success: false,
				error: "DELETE_FAILED",
				message: `Failed to delete relation '${from_entity} →[${relation_type}]→ ${to_entity}'.`
			},
			`Failed to delete relation.`,
			{ includeJson: json }
		);
		response.isError = true;
		return response;
	}

	logger.info("[Tool] delete_relation", {
		repo: repo ?? "",
		from: from_entity,
		to: to_entity,
		type: relation_type,
		changes
	});

	if (changes === 0) {
		return createMcpResponse(
			{
				success: false,
				error: "RELATION_NOT_FOUND",
				message: `Relation '${from_entity} →[${relation_type}]→ ${to_entity}' not found.`
			},
			`Relation not found.`,
			{ includeJson: json }
		);
	}

	return createMcpResponse(
		{
			success: true,
			deletedCount: changes
		},
		`Deleted relation '${from_entity} —[${relation_type}]→ ${to_entity}'.`,
		{
			structuredContentPathHint: "deletedCount",
			includeJson: json
		}
	);
}

// ── Delete Observation ────────────────────────────────────────────────────

export async function handleDeleteObservation(
	params: Record<string, unknown>,
	db: SQLiteStore,
	_vectors: VectorStore
): Promise<McpResponse> {
	const validated = DeleteObservationSchema.parse(params);
	const { id, owner: _owner, repo, json } = validated;

	let changes = 0;
	try {
		const txn = db.db.transaction(() => {
			const result = db.db.prepare(`DELETE FROM observations WHERE id = ?`).run(id);
			changes = result.changes;
		});
		txn();
	} catch (error: unknown) {
		logger.error("[Tool] delete_observation failed", { error: String(error) });

		const response = createMcpResponse(
			{
				success: false,
				error: "DELETE_FAILED",
				message: `Failed to delete observation '${id}'.`
			},
			`Failed to delete observation '${id}'.`,
			{ includeJson: json }
		);
		response.isError = true;
		return response;
	}

	logger.info("[Tool] delete_observation", { repo: repo ?? "", id, changes });

	if (changes === 0) {
		return createMcpResponse(
			{
				success: false,
				error: "OBSERVATION_NOT_FOUND",
				message: `Observation '${id}' not found.`
			},
			`Observation '${id}' not found.`,
			{ includeJson: json }
		);
	}

	return createMcpResponse(
		{
			success: true,
			deletedCount: changes
		},
		`Deleted observation '${id}'.`,
		{
			structuredContentPathHint: "deletedCount",
			includeJson: json
		}
	);
}
