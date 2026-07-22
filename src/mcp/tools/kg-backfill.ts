import { randomUUID } from "crypto";
import { SQLiteStore } from "../storage/sqlite";
import { createMcpResponse } from "../utils/mcp-response";
import { logger } from "../utils/logger";
import { extractEntities } from "./kg-archivist";
import { KGBackfillSchema } from "./schemas";

export async function handleKGBackfill(args: unknown, db: SQLiteStore) {
	const { repo, owner, source, json } = KGBackfillSchema.parse(args);

	const stats = {
		reposScanned: 0,
		itemsProcessed: 0,
		entitiesCreated: 0,
		observationsCreated: 0,
		errors: 0
	};

	const scanRepos = repo ? [repo] : db.system.listRepoNavigation().map((r) => r.repo);
	stats.reposScanned = scanRepos.length;

	// Collect all extractions first (async, so cannot run inside DB transaction)
	type PendingOp = {
		entities: Array<{ name: string; type: string }>;
		repo: string;
		owner: string;
		observationText: string;
	};
	const pendingOps: PendingOp[] = [];

	for (const r of scanRepos) {
		const currentOwner = owner || "unknown";

		if (source === "memories" || source === "both") {
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

		if (source === "standards" || source === "both") {
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

	const summary = `${stats.reposScanned} repos, ${stats.itemsProcessed} items, ${stats.entitiesCreated} entities, ${stats.observationsCreated} observations.`;

	logger.info(`[kg-backfill] Complete: ${summary}`);

	return createMcpResponse(stats, summary, {
		contentSummary: `Backfill complete: ${summary}`,
		includeJson: json
	});
}
