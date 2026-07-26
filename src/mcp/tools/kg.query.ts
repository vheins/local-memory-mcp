import { SQLiteStore } from "../storage/sqlite";
import { VectorStore } from "../types";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";
import { QueryGraphSchema } from "./schemas";
import { logger } from "../utils/logger";

// ── Types ──────────────────────────────────────────────────────────────────

interface EntityRow {
	name: string;
	type: string;
	description: string | null;
}

interface RelationRow {
	from_entity: string;
	to_entity: string;
	relation_type: string;
}

interface SymbolRow {
	name: string;
	kind: string;
	file_path: string;
	start_line: number | null;
	end_line: number | null;
}

interface FileRow {
	file_path: string;
	language: string | null;
	lines: number;
}

interface QueryGraphResult {
	entities: Array<{
		name: string;
		type: string;
		description?: string;
	}>;
	relations: Array<{
		from: string;
		to: string;
		type: string;
	}>;
}

// ── Handler ────────────────────────────────────────────────────────────────

export async function handleQueryGraph(
	params: Record<string, unknown>,
	db: SQLiteStore,
	_vectors: VectorStore
): Promise<McpResponse> {
	const validated = QueryGraphSchema.parse(params);
	const { owner, repo, type_filter, json } = validated;
	const ownerVal = owner ?? "";

	const typeFilterPattern = type_filter ? `%${type_filter.toLowerCase()}%` : null;

	// ── A. Entities from memory KG ─────────────────────────────────────
	const entityRows: EntityRow[] = ownerVal
		? db.db
				.prepare<unknown[], EntityRow>(`SELECT name, type, description FROM entities WHERE owner = ? AND repo = ?`)
				.all(ownerVal, repo)
		: db.db.prepare<unknown[], EntityRow>(`SELECT name, type, description FROM entities WHERE repo = ?`).all(repo);

	// ── B. Relations from memory KG ────────────────────────────────────
	const relationRows: RelationRow[] = ownerVal
		? db.db
				.prepare<unknown[], RelationRow>(
					`SELECT from_entity, to_entity, relation_type FROM relations WHERE owner = ? AND repo = ?`
				)
				.all(ownerVal, repo)
		: db.db
				.prepare<unknown[], RelationRow>(`SELECT from_entity, to_entity, relation_type FROM relations WHERE repo = ?`)
				.all(repo);

	// ── C. Symbols from codebase index ─────────────────────────────────
	let symbolRows: SymbolRow[];
	if (typeFilterPattern) {
		symbolRows = db.db
			.prepare<unknown[], SymbolRow>(
				`SELECT name, kind, file_path, start_line, end_line
				 FROM codebase_symbols
				 WHERE repo = ? AND LOWER(kind) LIKE ?`
			)
			.all(repo, typeFilterPattern);
	} else {
		symbolRows = db.db
			.prepare<unknown[], SymbolRow>(
				`SELECT name, kind, file_path, start_line, end_line
				 FROM codebase_symbols
				 WHERE repo = ?`
			)
			.all(repo);
	}

	// ── D. Files from codebase index ───────────────────────────────────
	let fileRows: FileRow[];
	if (typeFilterPattern) {
		fileRows = db.db
			.prepare<unknown[], FileRow>(
				`SELECT file_path, language, lines
				 FROM codebase_files
				 WHERE repo = ? AND LOWER(language) LIKE ?`
			)
			.all(repo, typeFilterPattern);
	} else {
		fileRows = db.db
			.prepare<unknown[], FileRow>(
				`SELECT file_path, language, lines
				 FROM codebase_files
				 WHERE repo = ?`
			)
			.all(repo);
	}

	// ── Build result ───────────────────────────────────────────────────

	const entities: QueryGraphResult["entities"] = [];
	const relations: QueryGraphResult["relations"] = [];

	// A: Memory KG entities
	for (const row of entityRows) {
		if (typeFilterPattern && !row.type.toLowerCase().includes(type_filter!.toLowerCase())) {
			continue;
		}
		entities.push({
			name: row.name,
			type: row.type,
			description: row.description ?? undefined
		});
	}

	// B: Memory KG relations
	for (const row of relationRows) {
		relations.push({
			from: row.from_entity,
			to: row.to_entity,
			type: row.relation_type
		});
	}

	// C: Symbols → entities
	const symbolFileMap = new Map<string, string[]>();
	for (const row of symbolRows) {
		const entityName = `${row.kind}:${row.name}`;
		entities.push({
			name: entityName,
			type: row.kind,
			description: `Defined in ${row.file_path}:${row.start_line ?? "?"}-${row.end_line ?? "?"}`
		});

		// Track defined_in relation: symbol → file
		const files = symbolFileMap.get(entityName) ?? [];
		files.push(row.file_path);
		symbolFileMap.set(entityName, files);
	}

	// D: Files → entities
	const fileSet = new Set<string>();
	for (const row of fileRows) {
		fileSet.add(row.file_path);
		entities.push({
			name: row.file_path,
			type: "codebase_file",
			description: `Language: ${row.language ?? "unknown"}, Lines: ${row.lines}`
		});
	}

	// E: Query-time relations: defined_in (symbol → file)
	for (const [entityName, filePaths] of symbolFileMap) {
		for (const fp of filePaths) {
			// Only add the relation if the file is in the file set (exists in result)
			if (fileSet.has(fp)) {
				relations.push({
					from: entityName,
					to: fp,
					type: "defined_in"
				});
			}
		}
	}

	logger.info("[Tool] query_graph", {
		repo,
		entityCount: entities.length,
		relationCount: relations.length
	});

	const result: QueryGraphResult = { entities, relations };

	return createMcpResponse(
		result,
		`Query graph for "${repo}": ${entities.length} entities, ${relations.length} relations.`,
		{ structuredContentPathHint: "entities,relations", includeJson: json }
	);
}
