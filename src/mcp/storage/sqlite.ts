import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import os from "os";
import { MigrationManager } from "./migrations";
import { MemoryEntity } from "../entities/memory";
import { TaskEntity } from "../entities/task";
import { ActionEntity } from "../entities/action";
import { SystemEntity } from "../entities/system";
import { SummaryEntity } from "../entities/summary";
import { HandoffEntity } from "../entities/handoff";
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
	public tasks: TaskEntity;
	public actions: ActionEntity;
	public system: SystemEntity;
	public summaries: SummaryEntity;
	public handoffs: HandoffEntity;
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
		this.db.pragma("busy_timeout = 30000");   // increased: 30s
		this.db.pragma("foreign_keys = ON");
		this.db.pragma("wal_autocheckpoint = 100"); // more frequent: every 100 pages

		// Run integrity check and WAL checkpoint on startup
		if (finalPath !== ":memory:") {
			this._startupChecks(finalPath);
		}

		const migrator = new MigrationManager(this.db);
		migrator.migrate();
		migrator.addMemoryCodeColumn();

		this.memories = new MemoryEntity(this.db);
		this.tasks = new TaskEntity(this.db);
		this.actions = new ActionEntity(this.db);
		this.system = new SystemEntity(this.db);
		this.summaries = new SummaryEntity(this.db);
		this.handoffs = new HandoffEntity(this.db);
		this.lock = new WriteLock(finalPath);
	}

	/**
	 * Run on startup: checkpoint WAL and verify integrity.
	 * If integrity check fails, attempt to restore from backup.
	 */
	private _startupChecks(dbPath: string): void {
		try {
			// Flush any pending WAL data into the main DB file
			this.db.pragma("wal_checkpoint(TRUNCATE)");
			logger.debug("[SQLiteStore] WAL checkpoint completed on startup");
		} catch (err) {
			logger.warn("[SQLiteStore] WAL checkpoint failed on startup", { error: String(err) });
		}

		try {
			const result = this.db.pragma("integrity_check") as { integrity_check: string }[];
			const ok = result.length === 1 && result[0].integrity_check === "ok";
			if (!ok) {
				logger.error("[SQLiteStore] Integrity check FAILED", { result });
				this._attemptRecovery(dbPath);
			} else {
				logger.debug("[SQLiteStore] Integrity check passed");
			}
		} catch (err) {
			logger.error("[SQLiteStore] Integrity check threw error", { error: String(err) });
			this._attemptRecovery(dbPath);
		}
	}

	/**
	 * Attempt to recover from a corrupt DB by restoring the latest backup.
	 */
	private _attemptRecovery(dbPath: string): void {
		const backupPath = dbPath + ".backup";
		if (fs.existsSync(backupPath)) {
			logger.warn("[SQLiteStore] Attempting recovery from backup", { backupPath });
			try {
				// Mark current file as corrupt before overwriting
				const corruptPath = `${dbPath}.corrupt_${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}`;
				fs.copyFileSync(dbPath, corruptPath);
				fs.copyFileSync(backupPath, dbPath);
				logger.warn("[SQLiteStore] Recovery successful. Corrupt file saved to", { corruptPath });
			} catch (err) {
				logger.error("[SQLiteStore] Recovery failed", { error: String(err) });
			}
		} else {
			logger.error("[SQLiteStore] No backup found for recovery. DB may be corrupt.");
		}
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
				this.db.pragma("wal_checkpoint(TRUNCATE)");
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
