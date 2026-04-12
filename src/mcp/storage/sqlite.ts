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

let dbPathInstance = "";
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

	constructor(dbPath?: string) {
		const finalPath = dbPath ?? DB_PATH;
		dbPathInstance = finalPath;

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

		const saveDb = createSaveFunction(db, finalPath);

		db.run("PRAGMA journal_mode = WAL");
		db.run("PRAGMA synchronous = NORMAL");
		db.run("PRAGMA busy_timeout = 5000");

		const migrator = new MigrationManager(db, saveDb);
		migrator.migrate();

		Object.assign(this, {
			db,
			memories: new MemoryEntity(db, saveDb),
			tasks: new TaskEntity(db, saveDb),
			actions: new ActionEntity(db, saveDb),
			system: new SystemEntity(db, saveDb),
			summaries: new SummaryEntity(db, saveDb)
		});

		if (finalPath !== ":memory:") {
			saveDb();
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
		return dbPathInstance;
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
