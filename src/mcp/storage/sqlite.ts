import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import os from "os";
import { MigrationManager } from "./migrations";
import { MemoryEntity } from "../entities/memory";
import { MemoryVectorEntity } from "../entities/memory.vector";
import { MemoryArchiveEntity } from "../entities/memory.archive";
import { TaskEntity } from "../entities/task";
import { TaskCommentEntity } from "../entities/task-comment";
import { TaskStatsEntity } from "../entities/task-stats";
import { ActionEntity } from "../entities/action";
import { SystemEntity } from "../entities/system";
import { SummaryEntity } from "../entities/summary";
import { StandardEntity } from "../entities/standard";
import { HandoffEntity } from "../entities/handoff";
import { CodebaseFileEntity } from "../entities/codebase-file";
import { CodebaseSymbolEntity } from "../entities/codebase-symbol";
import { WriteLock } from "./write-lock";
import { logger } from "../utils/logger";

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

export class SQLiteStore {
	public db: Database.Database;
	public memories: MemoryEntity;
	public memoryVectors: MemoryVectorEntity;
	public memoryArchives: MemoryArchiveEntity;
	public tasks: TaskEntity;
	public taskComments: TaskCommentEntity;
	public taskStats: TaskStatsEntity;
	public actions: ActionEntity;
	public system: SystemEntity;
	public summaries: SummaryEntity;
	public standards: StandardEntity;
	public handoffs: HandoffEntity;
	public codebaseFiles: CodebaseFileEntity;
	public codebaseSymbols: CodebaseSymbolEntity;
	public lock: WriteLock;
	private dbPathInstance: string;

	constructor(dbPath?: string) {
		const finalPath = dbPath ?? DB_PATH;
		this.dbPathInstance = finalPath;

		if (finalPath !== ":memory:") {
			const dbDir = path.dirname(finalPath);
			if (!fs.existsSync(dbDir)) {
				fs.mkdirSync(dbDir, { recursive: true });
			}
		}

		this.db = new Database(finalPath);
		this.db.pragma("journal_mode = WAL");
		this.db.pragma("synchronous = FULL");
		this.db.pragma("busy_timeout = 30000"); // increased: 30s
		this.db.pragma("foreign_keys = ON");
		this.db.pragma("wal_autocheckpoint = 100"); // more frequent: every 100 pages

		// Lightweight WAL checkpoint on startup (passive — does not block readers)
		if (finalPath !== ":memory:") {
			try {
				this.db.pragma("wal_checkpoint(PASSIVE)");
			} catch (err) {
				logger.warn("[SQLiteStore] WAL checkpoint failed on startup", { error: String(err) });
			}
		}

		const migrator = new MigrationManager(this.db);
		migrator.migrate();

		this.memories = new MemoryEntity(this.db);
		this.memoryVectors = new MemoryVectorEntity(this.db);
		this.memoryArchives = new MemoryArchiveEntity(this.db);
		this.tasks = new TaskEntity(this.db);
		this.taskComments = new TaskCommentEntity(this.db);
		this.taskStats = new TaskStatsEntity(this.db);
		this.actions = new ActionEntity(this.db);
		this.system = new SystemEntity(this.db);
		this.summaries = new SummaryEntity(this.db);
		this.standards = new StandardEntity(this.db);
		this.handoffs = new HandoffEntity(this.db);
		this.codebaseFiles = new CodebaseFileEntity(this.db);
		this.codebaseSymbols = new CodebaseSymbolEntity(this.db);
		this.lock = new WriteLock(finalPath);
	}

	/**
	 * Create a timestamped backup of the DB file.
	 * Called automatically after successful writes (via withWrite).
	 */
	backup(): void {
		if (this.dbPathInstance === ":memory:") return;
		try {
			// Checkpoint first so backup has latest data
			this.db.pragma("wal_checkpoint(PASSIVE)");
			const backupPath = this.dbPathInstance + ".backup";
			fs.copyFileSync(this.dbPathInstance, backupPath);
		} catch (err) {
			logger.warn("[SQLiteStore] Backup failed", { error: String(err) });
		}
	}

	/**
	 * Execute a write operation under the file lock.
	 * This is the ONLY way writes should be performed.
	 *
	 * @example
	 * await db.withWrite(() => db.tasks.insertTask(task));
	 */
	async withWrite<T>(fn: () => Promise<T> | T): Promise<T> {
		return this.lock.withLock(fn);
	}

	/**
	 * Checkpoint WAL so dashboard (and other readers) see latest data.
	 * Called by dashboard controllers before reads.
	 */
	async refresh(): Promise<void> {
		try {
			this.db.pragma("wal_checkpoint(PASSIVE)");
		} catch (err) {
			logger.warn("[SQLiteStore] refresh checkpoint failed", { error: String(err) });
		}
	}

	async ready(): Promise<void> {
		// No-op: better-sqlite3 is synchronous
	}

	static async create(dbPath?: string): Promise<SQLiteStore> {
		return new SQLiteStore(dbPath);
	}

	getDbPath(): string {
		return this.dbPathInstance;
	}

	close(): void {
		if (this.db && this.db.open) {
			try {
				this.db.pragma("wal_checkpoint(PASSIVE)");
			} catch {
				// best effort
			}
			this.db.close();
		}
	}
}

export async function createTestStore(): Promise<SQLiteStore> {
	return new SQLiteStore(":memory:");
}
