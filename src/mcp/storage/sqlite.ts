import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import { MemoryEntry, Task, TaskComment, TaskStats } from "../types.js";
import { logger } from "../utils/logger.js";
import { MigrationManager } from "./migrations.js";
import { MemoryEntity } from "../entities/memory.js";
import { TaskEntity } from "../entities/task.js";
import { ActionEntity } from "../entities/action.js";
import { SystemEntity } from "../entities/system.js";
import { SummaryEntity } from "../entities/summary.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolve database path with following priority:
 * 1. MEMORY_DB_PATH env var
 * 2. standard config dir for platform
 * 3. legacy path
 * 4. local storage dir
 */
function resolveDbPath(): string {
  if (process.env.MEMORY_DB_PATH) return process.env.MEMORY_DB_PATH;

  const standardConfigDir = process.platform === "win32"
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
 * Maintains backward compatibility with the existing SQLiteStore API.
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

  public getDbPath(): string {
    return DB_PATH;
  }

  public close(): void {
    this.db.close();
  }

  // --- MEMORY DELEGATIONS ---
  
  insert(entry: MemoryEntry): void { this.memories.insert(entry); }
  update(id: string, updates: Partial<MemoryEntry>): void { this.memories.update(id, updates); }
  getById(id: string): MemoryEntry | null { return this.memories.getById(id); }
  getByIdWithStats(id: string): any | null { return this.memories.getByIdWithStats(id); }
  getByIds(ids: string[], options?: any): MemoryEntry[] { return this.memories.getByIds(ids, options); }
  searchByRepo(repo: string, query: string, type?: string, limit?: number): MemoryEntry[] { 
    return this.memories.searchByRepo(repo, query, type, limit); 
  }
  searchBySimilarity(query: string, repo: string, limit?: number, includeArchived?: boolean, currentTags?: string[]): any[] {
    return this.memories.searchBySimilarity(query, repo, limit, includeArchived, currentTags);
  }
  bulkInsertMemories(entries: MemoryEntry[]): number { return this.memories.bulkInsertMemories(entries); }
  bulkUpdateMemories(ids: string[], updates: any): number { return this.memories.bulkUpdateMemories(ids, updates); }
  bulkDeleteMemories(ids: string[]): number { return this.memories.bulkDeleteMemories(ids); }
  getRecentMemories(repo: string, limit: number, offset?: number, includeArchived?: boolean, excludeTypes?: string[]): MemoryEntry[] {
    return this.memories.getRecentMemories(repo, limit, offset, includeArchived, excludeTypes);
  }
  getTotalCount(repo: string, includeArchived?: boolean, excludeTypes?: string[]): number {
    return this.memories.getTotalCount(repo, includeArchived, excludeTypes);
  }
  incrementHitCount(id: string): void { this.memories.incrementHitCount(id); }
  incrementHitCounts(ids: string[]): void { this.memories.incrementHitCounts(ids); }
  incrementRecallCount(id: string): void { this.memories.incrementRecallCount(id); }
  getVectorCandidates(repo?: string, limit?: number): any[] { return this.memories.getVectorCandidates(repo, limit); }
  upsertVectorEmbedding(memoryId: string, vector: number[]): void { this.memories.upsertVectorEmbedding(memoryId, vector); }
  getSummary(repo: string): any { return this.summaries.getSummary(repo); }
  upsertSummary(repo: string, summary: string): void { this.summaries.upsertSummary(repo, summary); }
  listMemoriesForDashboard(options: any): any { return this.memories.listMemoriesForDashboard(options); }
  archiveExpiredMemories(force?: boolean): number { return this.memories.archiveExpiredMemories(force); }
  archiveLowScoreMemories(force?: boolean): number { return this.memories.archiveLowScoreMemories(force); }

  // --- TASK DELEGATIONS ---

  insertTask(task: Task): void { this.tasks.insertTask(task); }
  updateTask(id: string, updates: any): void { this.tasks.updateTask(id, updates); }
  deleteTask(id: string): void { this.tasks.deleteTask(id); }
  getTaskById(id: string): Task | null { return this.tasks.getTaskById(id); }
  getTaskByCode(repo: string, taskCode: string): Task | null { return this.tasks.getTaskByCode(repo, taskCode); }
  getTasksByRepo(repo: string, status?: string, limit?: number, offset?: number, search?: string): Task[] {
    return this.tasks.getTasksByRepo(repo, status, limit, offset, search);
  }
  getTasksByMultipleStatuses(repo: string, statuses: string[], limit?: number, offset?: number, search?: string): Task[] {
    return this.tasks.getTasksByMultipleStatuses(repo, statuses, limit, offset, search);
  }
  isTaskCodeDuplicate(repo: string, task_code: string, excludeId?: string): boolean {
    return this.tasks.isTaskCodeDuplicate(repo, task_code, excludeId);
  }
  bulkInsertTasks(tasks: Task[]): number { return this.tasks.bulkInsertTasks(tasks); }
  insertTaskComment(comment: TaskComment): void { this.tasks.insertTaskComment(comment); }
  updateTaskComment(id: string, updates: any): void { this.tasks.updateTaskComment(id, updates); }
  deleteTaskComment(id: string): void { this.tasks.deleteTaskComment(id); }
  getTaskCommentById(id: string): TaskComment | null { return this.tasks.getTaskCommentById(id); }
  getTaskCommentsByTaskId(taskId: string): TaskComment[] { return this.tasks.getTaskCommentsByTaskId(taskId); }
  getAllTaskCommentsByRepo(repo: string): TaskComment[] { return this.tasks.getAllTaskCommentsByRepo(repo); }
  getTaskStats(repo: string): TaskStats { return this.tasks.getTaskStats(repo); }
  getTaskTimeStats(repo: string, period: any): any { return this.tasks.getTaskTimeStats(repo, period); }
  getTaskComparisonSeries(repo: string, period: any): any[] { return this.tasks.getTaskComparisonSeries(repo, period); }

  // --- ACTION DELEGATIONS ---

  logAction(action: string, repo: string, optionsOrQuery?: any, response?: string, memoryId?: string, taskId?: string, resultCount?: number): void {
    this.actions.logAction(action, repo, optionsOrQuery, response, memoryId, taskId, resultCount);
  }
  getLastActionId(): number { return this.actions.getLastActionId(); }
  getActionsAfter(id: number): any[] { return this.actions.getActionsAfter(id); }
  getRecentActions(repo: string, limit?: number, offset?: number): any[] {
    return this.actions.getRecentActions(repo, limit, offset);
  }
  getActionStatsByDate(repo: string): any[] { return this.actions.getActionStatsByDate(repo); }
  getActionDistribution(repo: string): any[] { return this.actions.getActionDistribution(repo); }

  // --- SYSTEM DELEGATIONS ---

  listRepos(): string[] { return this.system.listRepos(); }
  listRepoNavigation(): any[] { return this.system.listRepoNavigation(); }
  getRepoDashboardStats(repo: string): any { return this.system.getDashboardStats(repo); }
  getGlobalStats(): any { return this.system.getGlobalStats(); }
  getRepoDetails(repo: string): any { return this.system.getRepoDetails(repo); }
}
