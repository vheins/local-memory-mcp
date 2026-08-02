import Database from "better-sqlite3";
import {
	MemoryEntry,
	MemoryRow,
	Task,
	TaskRow,
	CodingStandardEntry,
	CodingStandardRow,
	Handoff,
	HandoffRow,
	Claim,
	ClaimRow,
	CodebaseSymbol,
	CodebaseSymbolRow,
	MEMORY_STATUS_ACTIVE,
	TASK_STATUS_BACKLOG
} from "../types/index";

export abstract class BaseEntity {
	constructor(protected db: Database.Database) {}

	protected transaction<T>(fn: () => T): T {
		// BEGIN IMMEDIATE grabs the SQLite write lock at transaction start, so a
		// read-then-write body can never hit SQLITE_BUSY_SNAPSHOT (immediate,
		// busy_timeout-immune) when another process commits mid-transaction
		// (TASK-064 / MEM-475). Better-sqlite3 v12 API: transaction(fn).immediate().
		return this.db.transaction(fn).immediate();
	}

	protected run(sql: string, params: unknown[] = []): { changes: number } {
		const stmt = this.db.prepare(sql);
		const result = stmt.run(...(params as (string | number | null | Buffer)[]));
		return { changes: result.changes };
	}

	protected exec(sql: string): void {
		this.db.exec(sql);
	}

	protected all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
		const stmt = this.db.prepare(sql);
		return stmt.all(...(params as (string | number | null | Buffer)[])) as T[];
	}

	protected get<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | undefined {
		const stmt = this.db.prepare(sql);
		return stmt.get(...(params as (string | number | null | Buffer)[])) as T | undefined;
	}

	protected safeJSONParse<T>(json: string | null | undefined, defaultValue: T): T {
		if (!json) return defaultValue;
		try {
			return JSON.parse(json);
		} catch {
			return defaultValue;
		}
	}

	protected rowToMemoryEntry(row: MemoryRow): MemoryEntry {
		// Parse metadata JSON once — structuredData lives inside the same
		// metadata blob, so a single parse is split into both fields.
		const metadata = this.safeJSONParse<Record<string, unknown>>(row.metadata, {});
		const structuredData = (metadata.structuredData as Record<string, unknown> | undefined) ?? undefined;
		delete metadata.structuredData;

		return {
			id: row.id,
			code: row.code || undefined,
			type: row.type,
			title: row.title || "Untitled",
			content: row.content,
			importance: row.importance,
			agent: row.agent || "unknown",
			role: row.role || "unknown",
			model: row.model || "unknown",
			scope: {
				owner: row.owner,
				repo: row.repo,
				branch: row.branch ?? undefined,
				folder: row.folder ?? undefined,
				language: row.language ?? undefined
			},
			created_at: row.created_at,
			updated_at: row.updated_at,
			completed_at: row.completed_at ?? null,
			hit_count: row.hit_count ?? 0,
			recall_count: row.recall_count ?? 0,
			last_used_at: row.last_used_at ?? null,
			expires_at: row.expires_at ?? null,
			supersedes: row.supersedes ?? null,
			status: row.status || MEMORY_STATUS_ACTIVE,
			is_global: row.is_global === 1,
			tags: this.safeJSONParse<string[]>(row.tags, []),
			metadata,
			structuredData
		};
	}

	protected rowToTask(row: TaskRow): Task {
		return {
			id: row.id,
			owner: row.owner,
			repo: row.repo,
			task_code: row.task_code,
			phase: row.phase || "",
			title: row.title,
			description: row.description || null,
			status: row.status || TASK_STATUS_BACKLOG,
			priority: row.priority || 3,
			agent: row.agent || "unknown",
			role: row.role || "unknown",
			doc_path: row.doc_path ?? null,
			created_at: row.created_at,
			updated_at: row.updated_at,
			in_progress_at: row.in_progress_at ?? null,
			finished_at: row.finished_at ?? null,
			canceled_at: row.canceled_at ?? null,
			est_tokens: row.est_tokens || 0,
			commit_id: row.commit_id ?? null,
			changed_files: this.safeJSONParse<string[]>(row.changed_files, []),
			tags: this.safeJSONParse<string[]>(row.tags, []),
			suggested_skills: this.safeJSONParse<string[]>(row.suggested_skills, []),
			metadata: this.safeJSONParse<Record<string, unknown>>(row.metadata, {}),
			parent_id: row.parent_id ?? null,
			depends_on: row.depends_on ?? null,
			parent_code: row.parent_code ?? null,
			depends_on_code: row.depends_on_code ?? null,
			coordination: {
				active_claim_count: row.active_claim_count ?? 0,
				active_claim_agent: row.active_claim_agent ?? null,
				active_claim_role: row.active_claim_role ?? null,
				active_claim_claimed_at: row.active_claim_claimed_at ?? null,
				pending_handoff_count: row.pending_handoff_count ?? 0,
				pending_handoff_id: row.pending_handoff_id ?? null,
				pending_handoff_summary: row.pending_handoff_summary ?? null,
				pending_handoff_to_agent: row.pending_handoff_to_agent ?? null,
				pending_handoff_created_at: row.pending_handoff_created_at ?? null
			},
			comments_count: row.comments_count || 0
		};
	}

	/**
	 * Row mapper for coding_standards rows (shared by StandardEntity).
	 * Single source of truth — do not redefine in subclasses.
	 */
	protected rowToEntry(row: CodingStandardRow): CodingStandardEntry {
		return {
			id: row.id,
			code: row.code ?? undefined,
			title: row.title,
			content: row.content,
			parent_id: row.parent_id ?? null,
			context: row.context,
			version: row.version,
			language: row.language ?? null,
			stack: this.safeJSONParse<string[]>(row.stack, []),
			is_global: row.is_global === 1,
			owner: row.owner,
			repo: row.repo ?? null,
			tags: this.safeJSONParse<string[]>(row.tags, []),
			metadata: this.safeJSONParse<Record<string, unknown>>(row.metadata, {}),
			created_at: row.created_at,
			updated_at: row.updated_at,
			hit_count: row.hit_count ?? 0,
			last_used_at: row.last_used_at ?? null,
			agent: row.agent,
			model: row.model
		};
	}

	/**
	 * Row mapper for codebase_symbols rows (shared by CodebaseSymbolEntity).
	 */
	protected rowToSymbol(row: CodebaseSymbolRow): CodebaseSymbol {
		return {
			id: row.id,
			repo: row.repo,
			file_path: row.file_path,
			name: row.name,
			kind: row.kind,
			exported: row.exported === 1,
			default_export: row.default_export === 1,
			start_line: row.start_line,
			start_col: row.start_col,
			end_line: row.end_line,
			end_col: row.end_col,
			signature: row.signature,
			doc_comment: row.doc_comment,
			parent_symbol_id: row.parent_symbol_id,
			created_at: row.created_at,
			updated_at: row.updated_at
		};
	}

	/**
	 * Row mapper for handoffs rows (shared by HandoffEntity). Accepts rows
	 * joined with tasks (task_code present) and plain handoff rows.
	 */
	protected rowToHandoff(row: HandoffRow): Handoff {
		return {
			id: row.id,
			owner: row.owner,
			repo: row.repo,
			from_agent: row.from_agent,
			to_agent: row.to_agent ?? null,
			task_id: row.task_id ?? null,
			task_code: "task_code" in row ? ((row as HandoffRow & { task_code?: string | null }).task_code ?? null) : null,
			summary: row.summary,
			context: this.safeJSONParse<Record<string, unknown>>(row.context, {}),
			status: row.status as Handoff["status"],
			created_at: row.created_at,
			updated_at: row.updated_at,
			expires_at: row.expires_at ?? null
		};
	}

	/**
	 * Row mapper for claims rows (shared by HandoffEntity). Accepts rows
	 * joined with tasks (task_code present) and plain claim rows.
	 */
	protected rowToClaim(row: ClaimRow): Claim {
		return {
			id: row.id,
			owner: row.owner,
			repo: row.repo,
			task_id: row.task_id,
			task_code: "task_code" in row ? ((row as ClaimRow & { task_code?: string | null }).task_code ?? null) : null,
			agent: row.agent,
			role: row.role,
			claimed_at: row.claimed_at,
			released_at: row.released_at ?? null,
			metadata: this.safeJSONParse<Record<string, unknown>>(row.metadata, {})
		};
	}
}
