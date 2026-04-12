import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import os from "os";
import { logger } from "../utils/logger";
import { MigrationManager } from "./migrations";
import { MemoryEntity } from "../entities/memory";
import { TaskEntity } from "../entities/task";
import { ActionEntity } from "../entities/action";
import { SystemEntity } from "../entities/system";
import { SummaryEntity } from "../entities/summary";

/**
 * Resolve database path with following priority:
 * 1. MEMORY_DB_PATH env var
 * 2. standard config dir for platform
 * 3. legacy path
 * 4. local storage dir
 */
function resolveDbPath(): string {
	if (process.env.MEMORY_DB_PATH) return process.env.MEMORY_DB_PATH;

	const standardConfigDir =
		process.platform === "win32"
			? path.join(os.homedir(), ".local-memory-mcp")
			: process.platform === "darwin"
				? path.join(os.homedir(), "Library", "Application Support", "local-memory-mcp")
				: path.join(os.homedir(), ".config", "local-memory-mcp");

	const standardPath = path.join(standardConfigDir, "memory.db");
	if (fs.existsSync(standardPath)) return standardPath;

	const legacyPath = path.join(os.homedir(), ".config", "local-memory-mcp", "memory.db");
	if (fs.existsSync(legacyPath)) return legacyPath;

	const localCwdFile = path.join(process.cwd(), "storage", "memory.db");
	if (fs.existsSync(localCwdFile)) return localCwdFile;

	return standardPath;
}

const DB_PATH = resolveDbPath();

/**
 * COORDINATOR: Orchestrates database operations by delegating to specialized entities.
 * Exposes specialized entity properties for all database interactions.
 */
export class SQLiteStore {
	private db: Database.Database;

	public memories: MemoryEntity;
	public tasks: TaskEntity;
	public actions: ActionEntity;
	public system: SystemEntity;
	public summaries: SummaryEntity;

	constructor(dbPath?: string) {
		const finalPath = dbPath ?? DB_PATH;
		const dbDir = path.dirname(finalPath);

		if (!fs.existsSync(dbDir)) {
			fs.mkdirSync(dbDir, { recursive: true });
		}

		this.db = new Database(finalPath);
		this.db.pragma("journal_mode = WAL");
		this.db.pragma("synchronous = NORMAL");
		this.db.pragma("busy_timeout = 5000");

		// Run migrations
		const migrator = new MigrationManager(this.db);
		migrator.migrate();

		// Initialize entities
		this.memories = new MemoryEntity(this.db);
		this.tasks = new TaskEntity(this.db);
		this.actions = new ActionEntity(this.db);
		this.system = new SystemEntity(this.db);
		this.summaries = new SummaryEntity(this.db);

		logger.info(`SQLiteStore initialized at ${finalPath}`);
	}

	/**
	 * Returns the current database file path.
	 */
	public getDbPath(): string {
		return this.db.name;
	}

	/**
	 * Closes the database connection.
	 */
	public close(): void {
		this.db.close();
	}
}
