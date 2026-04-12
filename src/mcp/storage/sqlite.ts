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
let saveDbFn: (() => void) | null = null;

function createSaveFunction(db: SqlJsDatabase, dbPath?: string): () => void {
	return () => {
		if (dbPath && dbPath !== ":memory:") {
			const data = db.export();
			const buffer = Buffer.from(data);
			fs.writeFileSync(dbPath, buffer);
		}
	};
}

export class SQLiteStore {
	public db: SqlJsDatabase;
	public memories: MemoryEntity;
	public tasks: TaskEntity;
	public actions: ActionEntity;
	public system: SystemEntity;
	public summaries: SummaryEntity;

	private constructor() {
		this.db = {} as SqlJsDatabase;
		this.memories = {} as MemoryEntity;
		this.tasks = {} as TaskEntity;
		this.actions = {} as ActionEntity;
		this.system = {} as SystemEntity;
		this.summaries = {} as SummaryEntity;
	}

	static async create(dbPath?: string): Promise<SQLiteStore> {
		const finalPath = dbPath ?? DB_PATH;
		dbPathInstance = finalPath;

		const SQL = await initSqlJs();

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

		const store = Object.create(SQLiteStore.prototype);
		store.db = db;
		store.memories = new MemoryEntity(db, saveDb);
		store.tasks = new TaskEntity(db, saveDb);
		store.actions = new ActionEntity(db, saveDb);
		store.system = new SystemEntity(db, saveDb);
		store.summaries = new SummaryEntity(db, saveDb);

		if (finalPath !== ":memory:") {
			saveDb();
		}

		if (process.env.MCP_SERVER !== "true") {
			process.stderr.write(`${new Date().toISOString()} [INFO     ] SQLiteStore initialized at ${finalPath}\n`);
		}

		return store;
	}

	getDbPath(): string {
		return dbPathInstance;
	}

	close(): void {
		if (saveDbFn) {
			saveDbFn();
		}
		this.db.close();
	}
}
