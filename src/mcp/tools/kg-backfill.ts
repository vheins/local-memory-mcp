import { randomUUID } from "crypto";
import { SQLiteStore } from "../storage/sqlite";
import { createMcpResponse } from "../utils/mcp-response";
import { logger } from "../utils/logger";
import { extractEntities } from "./kg-archivist";
import { KGBackfillSchema } from "./schemas";

export async function handleKGBackfill(args: unknown, db: SQLiteStore) {
	const { repo, owner, source } = KGBackfillSchema.parse(args);

	const stats = {
		reposScanned: 0,
		itemsProcessed: 0,
		entitiesCreated: 0,
		observationsCreated: 0,
		errors: 0
	};

	const scanRepos = repo ? [repo] : db.system.listRepoNavigation().map((r) => r.repo);
	stats.reposScanned = scanRepos.length;

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
		for (const r of scanRepos) {
			const currentOwner = owner || "unknown";

			if (source === "memories" || source === "both") {
				const rows = db.db.prepare("SELECT title, content FROM memories WHERE repo = ?").all(r) as Array<{
					title: string | null;
					content: string;
				}>;

				for (let i = 0; i < rows.length; i++) {
					const row = rows[i];
					const content = `${row.content || ""} ${row.title || ""}`;
					let entities: Array<{ name: string; type: string }>;
					try {
						entities = extractEntities(content);
					} catch {
						stats.errors++;
						continue;
					}

					for (const ent of entities) {
						insertEntity.run(ent.name, ent.type, null, r, currentOwner, now, now);
						stats.entitiesCreated++;
						insertObservation.run(
							randomUUID(),
							ent.name,
							`Mentioned in memory: ${row.title || "untitled"}`,
							r,
							currentOwner,
							now
						);
						stats.observationsCreated++;
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
					const content = `${row.content || ""} ${row.title || ""}`;
					let entities: Array<{ name: string; type: string }>;
					try {
						entities = extractEntities(content);
					} catch {
						stats.errors++;
						continue;
					}

					for (const ent of entities) {
						insertEntity.run(ent.name, ent.type, null, r, currentOwner, now, now);
						stats.entitiesCreated++;
						insertObservation.run(
							randomUUID(),
							ent.name,
							`Mentioned in standard: ${row.title || "untitled"}`,
							r,
							currentOwner,
							now
						);
						stats.observationsCreated++;
					}
					stats.itemsProcessed++;
				}
			}
		}
	});

	transaction();

	const summary = `${stats.reposScanned} repos, ${stats.itemsProcessed} items, ${stats.entitiesCreated} entities, ${stats.observationsCreated} observations.`;

	logger.info(`[kg-backfill] Complete: ${summary}`);

	return createMcpResponse(stats, summary, {
		contentSummary: `Backfill complete: ${summary}`
	});
}
