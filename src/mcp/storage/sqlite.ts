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
		this.db.pragma("synchronous = NORMAL");
		this.db.pragma("busy_timeout = 5000");
		this.db.pragma("foreign_keys = ON");

		const migrator = new MigrationManager(this.db);
		migrator.migrate();
		migrator.addMemoryCodeColumn();

		this.memories = new MemoryEntity(this.db);
		this.tasks = new TaskEntity(this.db);
		this.actions = new ActionEntity(this.db);
		this.system = new SystemEntity(this.db);
		this.summaries = new SummaryEntity(this.db);
	}

	async ready(): Promise<void> {
		// No-op: better-sqlite3 is synchronous
	}

	async refresh(): Promise<void> {
		// No-op: better-sqlite3 reads/writes directly to file
	}

	static async create(dbPath?: string): Promise<SQLiteStore> {
		return new SQLiteStore(dbPath);
	}

	getDbPath(): string {
		return this.dbPathInstance;
	}

	close(): void {
		if (this.db && this.db.open) {
			this.db.close();
		}
	}
}

export async function createTestStore(): Promise<SQLiteStore> {
	return new SQLiteStore(":memory:");
}
