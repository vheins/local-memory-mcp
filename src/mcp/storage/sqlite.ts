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
import { CodebaseReferenceEntity } from "../entities/codebase-reference";
import { KnowledgeGraphEntity } from "../entities/knowledge-graph";
import { WriteLock } from "./write-lock";
import { logger } from "../utils/logger";
import { WAL_CHECKPOINT_INTERVAL_MS } from "../utils/constants";

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
	public codebaseReferences: CodebaseReferenceEntity;
	public knowledgeGraph: KnowledgeGraphEntity;
	public lock: WriteLock;
	private dbPathInstance: string;
	/** Last wall-clock time a WAL checkpoint ran (throttles refresh()). */
	private lastCheckpointAt = 0;

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
		// synchronous=NORMAL is SQLite's documented recommendation under WAL:
		// FULL performs 2 fsyncs per commit for crash-durability of the very
		// last transaction, which WAL already provides for all prior commits
		// (NORMAL risks losing only the most recent commit on OS/power loss,
		// never corruption). FULL was a rollback-journal concern; keeping it
		// under WAL doubles write fsyncs for no integrity gain. See
		// https://sqlite.org/wal.html#synchronous.
		this.db.pragma("synchronous = NORMAL");
		// busy_timeout = 5000 (was 30000): fail fast instead of blocking the
		// event loop for 30s per contention. Correctness under multi-process
		// writes comes from BEGIN IMMEDIATE transactions (base.ts) + the
		// WriteLock mutex (write-lock.ts), NOT from a long busy wait
		// (TASK-064 / MEM-475).
		this.db.pragma("busy_timeout = 5000");
		this.db.pragma("foreign_keys = ON");
		// wal_autocheckpoint = 1000 (was 100): checkpoint every ~4MB instead of
		// every ~400KB — frequent sync checkpoints on the writing connection
		// under multi-writer traffic caused checkpoint thrash (TASK-064).
		this.db.pragma("wal_autocheckpoint = 1000");

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
		this.codebaseReferences = new CodebaseReferenceEntity(this.db);
		this.knowledgeGraph = new KnowledgeGraphEntity(this.db);
		this.lock = new WriteLock(finalPath);
	}

	/**
	 * Execute a (single-transaction) write operation, relying on SQLite's
	 * BEGIN IMMEDIATE + busy_timeout for mutual exclusion.
	 *
	 * FAST PATH (OPT-PERF-09): no proper-lockfile acquire/release and no
	 * intra-process promise chain — each mutation is an atomic synchronous
	 * BEGIN IMMEDIATE transaction, so SQLite's own single-writer protocol
	 * already excludes concurrent writers.
	 *
	 * @example
	 * await db.withWrite(() => db.tasks.insertTask(task));
	 */
	async withWrite<T>(fn: () => Promise<T> | T): Promise<T> {
		return this.lock.withLock(fn);
	}

	/**
	 * Execute a COMPOUND write sequence under the proper-lockfile — reserved
	 * for genuinely cross-process compound mutations (a body of several
	 * BEGIN IMMEDIATE transactions that must not interleave with another
	 * process's same-class sequence), e.g. the maintenance sweep, codebase
	 * indexing writer, and task→memory archival.
	 *
	 * @example
	 * await db.withExclusiveWrite(() => { db.tasks.deleteTask(id); db.actions.prune(); });
	 */
	async withExclusiveWrite<T>(fn: () => Promise<T> | T): Promise<T> {
		return this.lock.withExclusiveLock(fn);
	}

	/**
	 * Checkpoint WAL so dashboard (and other readers) see latest data.
	 * Called by dashboard controllers before reads.
	 *
	 * Throttled: WAL readers see committed data without any checkpoint, so a
	 * per-request checkpoint would only pay WAL-shrink cost on every request.
	 * Checkpoints are therefore limited to one per WAL_CHECKPOINT_INTERVAL_MS
	 * (10s default) — the first call in each window still checkpoints, so a
	 * long-idle server never regresses visibility.
	 */
	async refresh(): Promise<void> {
		const now = Date.now();
		if (now - this.lastCheckpointAt < WAL_CHECKPOINT_INTERVAL_MS) return;
		this.lastCheckpointAt = now;
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
