import initSqlJs, { Database as SqlJsDatabase } from "sql.js";
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

let sqlJsReady: Promise<void> | null = null;
let sqlJsModule: Awaited<ReturnType<typeof initSqlJs>> | null = null;

async function getSqlJs() {
	if (!sqlJsModule) {
		sqlJsModule = await initSqlJs();
	}
	await sqlJsReady;
	return sqlJsModule;
}

function createSaveFunction(db: SqlJsDatabase, dbPath?: string): () => void {
	return () => {
		if (dbPath && dbPath !== ":memory:") {
			const data = db.export();
			const buffer = Buffer.from(data);
			fs.writeFileSync(dbPath, buffer);
		}
	};
}

function warmUpSqlJs() {
	if (!sqlJsReady) {
		sqlJsReady = (async () => {
			sqlJsModule = await initSqlJs();
		})();
	}
	return sqlJsReady;
}

export class SQLiteStore {
	public db: SqlJsDatabase;
	public memories: MemoryEntity;
	public tasks: TaskEntity;
	public actions: ActionEntity;
	public system: SystemEntity;
	public summaries: SummaryEntity;
	private _ready: Promise<void>;
	private lastLoadedAt: number = 0;
	private saveDbPtr?: () => void;
	private dbPathInstance: string;

	constructor(dbPath?: string) {
		const finalPath = dbPath ?? DB_PATH;
		this.dbPathInstance = finalPath;

		warmUpSqlJs();

		this.db = {} as SqlJsDatabase;
		this.memories = {} as MemoryEntity;
		this.tasks = {} as TaskEntity;
		this.actions = {} as ActionEntity;
		this.system = {} as SystemEntity;
		this.summaries = {} as SummaryEntity;

		this._ready = this._init(finalPath);
	}

	private async _init(finalPath: string): Promise<void> {
		const SQL = await getSqlJs();

		let db: SqlJsDatabase;
		if (finalPath === ":memory:") {
			db = new SQL.Database();
		} else {
			const dbDir = path.dirname(finalPath);
			if (!fs.existsSync(dbDir)) {
				fs.mkdirSync(dbDir, { recursive: true });
			}

			if (fs.existsSync(finalPath)) {
				const fileBuffer = fs.readFileSync(finalPath);
				db = new SQL.Database(fileBuffer);
			} else {
				db = new SQL.Database();
			}
		}

		this.saveDbPtr = createSaveFunction(db, finalPath);
		const wrappedSaveDb = () => {
			if (this.saveDbPtr) {
				this.saveDbPtr();
				this.lastLoadedAt = Date.now();
			}
		};

		db.run("PRAGMA journal_mode = WAL");
		db.run("PRAGMA synchronous = NORMAL");
		db.run("PRAGMA busy_timeout = 5000");
		const migrator = new MigrationManager(db, wrappedSaveDb);
		migrator.migrate();
		migrator.addMemoryCodeColumn();

		Object.assign(this, {
			db,
			memories: new MemoryEntity(db, wrappedSaveDb),
			tasks: new TaskEntity(db, wrappedSaveDb),
			actions: new ActionEntity(db, wrappedSaveDb),
			system: new SystemEntity(db, wrappedSaveDb),
			summaries: new SummaryEntity(db, wrappedSaveDb)
		});

		this.lastLoadedAt = Date.now();

		if (finalPath !== ":memory:") {
			wrappedSaveDb();
		}
	}

	async refresh(force = false): Promise<void> {
		const path = this.getDbPath();
		if (path === ":memory:") return;

		try {
			const stats = fs.statSync(path);
			const mtime = stats.mtimeMs;

			if (force || mtime > this.lastLoadedAt) {
				const SQL = await getSqlJs();
				const fileBuffer = fs.readFileSync(path);
				const newDb = new SQL.Database(fileBuffer);

				const wrappedSaveDb = () => {
					if (this.saveDbPtr) {
						this.saveDbPtr();
						this.lastLoadedAt = Date.now();
					}
				};

				this.db = newDb;
				this.memories = new MemoryEntity(newDb, wrappedSaveDb);
				this.tasks = new TaskEntity(newDb, wrappedSaveDb);
				this.actions = new ActionEntity(newDb, wrappedSaveDb);
				this.system = new SystemEntity(newDb, wrappedSaveDb);
				this.summaries = new SummaryEntity(newDb, wrappedSaveDb);
				this.lastLoadedAt = Date.now();
			}
		} catch (e) {
			console.error("Failed to refresh database from disk:", e);
		}
	}

	async ready(): Promise<void> {
		await this._ready;
	}

	static async create(dbPath?: string): Promise<SQLiteStore> {
		const store = new SQLiteStore(dbPath);
		await store.ready();
		return store;
	}

	getDbPath(): string {
		return this.dbPathInstance;
	}

	close(): void {
		if (this.db && this.db.close) {
			this.db.close();
		}
	}
}

export async function createTestStore(): Promise<SQLiteStore> {
	return SQLiteStore.create(":memory:");
}
