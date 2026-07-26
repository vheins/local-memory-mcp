import { randomUUID } from "crypto";
import path from "path";
import { SQLiteStore } from "../storage/sqlite";
import { createMcpResponse } from "../utils/mcp-response";
import { logger } from "../utils/logger";
import { extractEntities } from "./kg-archivist";
import { KGBackfillSchema } from "./schemas";
import type { CodebaseSymbol } from "../types/codebase-symbol";
import type { CodebaseFile } from "../types/codebase-file";

// ── Types ───────────────────────────────────────────────────────────────

interface CodebaseBackfillResult {
	entitiesCreated: number;
	relationsCreated: number;
	observationsCreated: number;
	errors: string[];
}

// ── Symbol kind → KG entity type mapping ────────────────────────────────

const SYMBOL_ENTITY_TYPE: Record<string, string> = {
	function: "codebase_symbol_function",
	class: "codebase_symbol_class",
	interface: "codebase_symbol_interface",
	type: "codebase_symbol_type",
	enum: "codebase_symbol_enum",
	variable: "codebase_symbol_variable"
};

const DEFAULT_SYMBOL_ENTITY_TYPE = "codebase_symbol_unknown";

function mapSymbolKind(kind: string): string {
	return SYMBOL_ENTITY_TYPE[kind] ?? DEFAULT_SYMBOL_ENTITY_TYPE;
}

// ── Codebase backfill ───────────────────────────────────────────────────

/**
 * Backfill Knowledge Graph entities, observations, and relations from the
 * codebase index (symbols and files).
 *
 * For each symbol:
 *   - Entity with name `{kind}:{name}` and type `codebase_symbol_{kind}`
 *   - Observation: "Defined in {file_path}:{start_line}-{end_line}"
 *   - If signature exists: "Signature: {signature}"
 *
 * For each file:
 *   - Entity with name being the file path and type `codebase_file`
 *   - Observations: "Language: {language}", "Lines: {lines}"
 *
 * Relations:
 *   - Each symbol → its containing file : `defined_in`
 *   - Parent directory → file                : `contains`
 */
async function backfillFromCodebaseIndex(
	owner: string,
	repo: string,
	db: SQLiteStore
): Promise<CodebaseBackfillResult> {
	const result: CodebaseBackfillResult = {
		entitiesCreated: 0,
		relationsCreated: 0,
		observationsCreated: 0,
		errors: []
	};

	const symbols = db.codebaseSymbols.getSymbolsByRepo(repo);
	const files = db.codebaseFiles.getFilesByRepo(repo);

	if (symbols.length === 0 && files.length === 0) {
		logger.info(`[kg-backfill] No codebase index data for repo "${repo}" — skipping`);
		return result;
	}

	logger.info(`[kg-backfill] Codebase: ${symbols.length} symbols, ${files.length} files in repo "${repo}"`);

	// Build file-path → file map for quick lookup
	const fileMap = new Map<string, CodebaseFile>();
	for (const f of files) {
		fileMap.set(f.file_path, f);
	}

	const now = new Date().toISOString();

	// ── Prepare SQL statements ──────────────────────────────────────
	const insertEntity = db.db.prepare(
		`INSERT OR IGNORE INTO entities (name, type, description, repo, owner, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`
	);

	const insertObservation = db.db.prepare(
		`INSERT INTO observations (id, entity_name, observation, repo, owner, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`
	);

	const insertRelation = db.db.prepare(
		`INSERT OR IGNORE INTO relations (from_entity, to_entity, relation_type, repo, owner, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`
	);

	// ── Collect operation data (no writes yet) ──────────────────────
	type EntityOp = { name: string; type: string; description: string | null };
	type ObservationOp = { id: string; entityName: string; text: string };
	type RelationOp = { fromEntity: string; toEntity: string; relationType: string };

	const entitiesToInsert: EntityOp[] = [];
	const observationsToInsert: ObservationOp[] = [];
	const relationsToInsert: RelationOp[] = [];

	// Track entities already queued to avoid duplicate dir inserts
	const queuedEntityNames = new Set<string>();

	function queueEntity(name: string, type: string, description: string | null): void {
		if (queuedEntityNames.has(name)) return;
		queuedEntityNames.add(name);
		entitiesToInsert.push({ name, type, description });
	}

	// ── Process symbols ─────────────────────────────────────────────
	for (const sym of symbols) {
		const entityName = `${sym.kind}:${sym.name}`;
		const entityType = mapSymbolKind(sym.kind);
		const filePath = sym.file_path;

		queueEntity(entityName, entityType, `Symbol defined in ${filePath}`);

		// Observation: location
		if (sym.start_line !== null || sym.end_line !== null) {
			const location = `Defined in ${filePath}:${sym.start_line ?? "?"}-${sym.end_line ?? "?"}`;
			observationsToInsert.push({
				id: randomUUID(),
				entityName,
				text: location
			});
		} else {
			const location = `Defined in ${filePath}`;
			observationsToInsert.push({
				id: randomUUID(),
				entityName,
				text: location
			});
		}

		// Observation: signature
		if (sym.signature) {
			observationsToInsert.push({
				id: randomUUID(),
				entityName,
				text: `Signature: ${sym.signature}`
			});
		}

		// Relation: symbol → file (defined_in)
		const fileEntityName = filePath;
		queueEntity(fileEntityName, "codebase_file", null);
		relationsToInsert.push({
			fromEntity: entityName,
			toEntity: fileEntityName,
			relationType: "defined_in"
		});
	}

	// ── Process files (file entities may already be queued by symbols) ─
	for (const f of files) {
		const fileEntityName = f.file_path;

		// Entity is queued above if referenced by a symbol; still ensure it exists
		queueEntity(fileEntityName, "codebase_file", null);

		// Observations
		if (f.language) {
			observationsToInsert.push({
				id: randomUUID(),
				entityName: fileEntityName,
				text: `Language: ${f.language}`
			});
		}
		observationsToInsert.push({
			id: randomUUID(),
			entityName: fileEntityName,
			text: `Lines: ${f.lines}`
		});

		// Relations: parent directory → file (contains)
		const dir = path.dirname(f.file_path);
		if (dir && dir !== ".") {
			queueEntity(dir, "codebase_directory", null);
			relationsToInsert.push({
				fromEntity: dir,
				toEntity: fileEntityName,
				relationType: "contains"
			});
		}
	}

	// ── Execute all inserts in a single transaction ────────────────
	const transaction = db.db.transaction(() => {
		for (const ent of entitiesToInsert) {
			insertEntity.run(ent.name, ent.type, ent.description, repo, owner, now, now);
			result.entitiesCreated++;
		}

		for (const obs of observationsToInsert) {
			try {
				insertObservation.run(obs.id, obs.entityName, obs.text, repo, owner, now);
				result.observationsCreated++;
			} catch (err) {
				result.errors.push(`observation ${obs.entityName}: ${String(err)}`);
			}
		}

		for (const rel of relationsToInsert) {
			try {
				insertRelation.run(rel.fromEntity, rel.toEntity, rel.relationType, repo, owner, now);
				result.relationsCreated++;
			} catch (err) {
				result.errors.push(`relation ${rel.fromEntity}→${rel.toEntity}: ${String(err)}`);
			}
		}
	});

	try {
		transaction();
	} catch (err) {
		result.errors.push(`transaction failed: ${String(err)}`);
		logger.error("[kg-backfill] Codebase backfill transaction failed", { repo, error: String(err) });
	}

	logger.info(
		`[kg-backfill] Codebase result for "${repo}": ${result.entitiesCreated} entities, ${result.observationsCreated} observations, ${result.relationsCreated} relations`
	);

	return result;
}

// ── Main handler ───────────────────────────────────────────────────────

export async function handleKGBackfill(args: unknown, db: SQLiteStore) {
	const { repo, owner, source, json } = KGBackfillSchema.parse(args);

	const stats = {
		reposScanned: 0,
		itemsProcessed: 0,
		entitiesCreated: 0,
		observationsCreated: 0,
		relationsCreated: 0,
		errors: 0
	};

	const scanRepos = repo ? [repo] : db.system.listRepoNavigation().map((r) => r.repo);
	stats.reposScanned = scanRepos.length;

	// Determine which backfills to run
	const runMemories = source === "memories" || source === "all";
	const runStandards = source === "standards" || source === "all";
	const runCodebase = source === "codebase" || source === "all";

	// ── Memories / Standards backfill (NLP-based) ───────────────────
	// These use async NLP extraction, so collect pending ops first.
	if (runMemories || runStandards) {
		type PendingOp = {
			entities: Array<{ name: string; type: string }>;
			repo: string;
			owner: string;
			observationText: string;
		};
		const pendingOps: PendingOp[] = [];

		for (const r of scanRepos) {
			const currentOwner = owner || "unknown";

			if (runMemories) {
				const rows = db.db.prepare("SELECT title, content FROM memories WHERE repo = ?").all(r) as Array<{
					title: string | null;
					content: string;
				}>;

				for (let i = 0; i < rows.length; i++) {
					const row = rows[i];
					const text = `${row.content || ""} ${row.title || ""}`;
					try {
						const entities = await extractEntities(text);
						if (entities.length > 0) {
							pendingOps.push({
								entities,
								repo: r,
								owner: currentOwner,
								observationText: `Mentioned in memory: ${row.title || "untitled"}`
							});
						}
					} catch {
						stats.errors++;
					}
					stats.itemsProcessed++;

					if ((i + 1) % 100 === 0) {
						logger.info(`[kg-backfill] Processed ${i + 1}/${rows.length} memories in repo "${r}"`);
					}
				}
			}

			if (runStandards) {
				const rows = db.db.prepare("SELECT title, content FROM coding_standards WHERE repo = ?").all(r) as Array<{
					title: string;
					content: string;
				}>;

				for (let i = 0; i < rows.length; i++) {
					const row = rows[i];
					const text = `${row.content || ""} ${row.title || ""}`;
					try {
						const entities = await extractEntities(text);
						if (entities.length > 0) {
							pendingOps.push({
								entities,
								repo: r,
								owner: currentOwner,
								observationText: `Mentioned in standard: ${row.title || "untitled"}`
							});
						}
					} catch {
						stats.errors++;
					}
					stats.itemsProcessed++;
				}
			}
		}

		// DB inserts in a single transaction
		const insertEntity = db.db.prepare(
			`INSERT OR IGNORE INTO entities (name, type, description, repo, owner, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
		);
		const insertObservation = db.db.prepare(
			`INSERT INTO observations (id, entity_name, observation, repo, owner, created_at)
			 VALUES (?, ?, ?, ?, ?, ?)`
		);

		const now = new Date().toISOString();

		const transaction = db.db.transaction(() => {
			for (const op of pendingOps) {
				for (const ent of op.entities) {
					insertEntity.run(ent.name, ent.type, null, op.repo, op.owner, now, now);
					stats.entitiesCreated++;
					insertObservation.run(randomUUID(), ent.name, op.observationText, op.repo, op.owner, now);
					stats.observationsCreated++;
				}
			}
		});
		transaction();
	}

	// ── Codebase index backfill ─────────────────────────────────────
	if (runCodebase) {
		for (const r of scanRepos) {
			const currentOwner = owner || "unknown";
			const codebaseResult = await backfillFromCodebaseIndex(currentOwner, r, db);
			stats.entitiesCreated += codebaseResult.entitiesCreated;
			stats.observationsCreated += codebaseResult.observationsCreated;
			stats.relationsCreated += codebaseResult.relationsCreated;
			stats.errors += codebaseResult.errors.length;

			if (codebaseResult.errors.length > 0) {
				logger.warn("[kg-backfill] Codebase backfill had errors", {
					repo: r,
					errorCount: codebaseResult.errors.length
				});
			}
		}
	}

	const summary = `${stats.reposScanned} repos, ${stats.itemsProcessed} items, ${stats.entitiesCreated} entities, ${stats.observationsCreated} observations, ${stats.relationsCreated} relations.`;

	logger.info(`[kg-backfill] Complete: ${summary}`);

	return createMcpResponse(stats, summary, {
		contentSummary: `Backfill complete for repo "${repo}": ${stats.entitiesCreated} entities, ${stats.observationsCreated} observations, ${stats.relationsCreated} relations.`,
		includeJson: json
	});
}
