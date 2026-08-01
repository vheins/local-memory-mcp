import Database from "better-sqlite3";
import {
	MemoryEntry,
	MemoryType,
	Task,
	TaskStatus,
	TaskPriority,
	CodingStandardEntry,
	CodingStandardRow,
	Handoff,
	HandoffRow,
	Claim,
	ClaimRow,
	CodebaseSymbol
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

	protected rowToMemoryEntry(row: unknown): MemoryEntry {
		const r = row as Record<string, unknown>;

		// Parse metadata JSON once — structuredData lives inside the same
		// metadata blob, so a single parse is split into both fields.
		const metadata = this.safeJSONParse<Record<string, unknown>>(r.metadata as string, {});
		const structuredData = (metadata.structuredData as Record<string, unknown> | undefined) ?? undefined;
		delete metadata.structuredData;

		return {
			id: r.id as string,
			code: (r.code as string) || undefined,
			type: r.type as MemoryType,
			title: (r.title as string) || "Untitled",
			content: r.content as string,
			importance: r.importance as number,
			agent: (r.agent as string) || "unknown",
			role: (r.role as string) || "unknown",
			model: (r.model as string) || "unknown",
			scope: {
				owner: r.owner as string,
				repo: r.repo as string,
				folder: (r.folder as string) || undefined,
				language: (r.language as string) || undefined
			},
			created_at: r.created_at as string,
			updated_at: r.updated_at as string,
			completed_at: (r.completed_at as string) || null,
			hit_count: (r.hit_count as number) ?? 0,
			recall_count: (r.recall_count as number) ?? 0,
			last_used_at: (r.last_used_at as string) ?? null,
			expires_at: (r.expires_at as string) ?? null,
			supersedes: (r.supersedes as string) ?? null,
			status: (r.status as "active" | "archived") || "active",
			is_global: r.is_global === 1,
			tags: this.safeJSONParse<string[]>(r.tags as string, []),
			metadata,
			structuredData
		};
	}

	protected rowToTask(row: unknown): Task {
		const r = row as Record<string, unknown>;
		return {
			id: r.id as string,
			owner: r.owner as string,
			repo: r.repo as string,
			task_code: r.task_code as string,
			phase: (r.phase as string) || "",
			title: r.title as string,
			description: (r.description as string) || null,
			status: (r.status as TaskStatus) || "backlog",
			priority: (r.priority as TaskPriority) || 3,
			agent: (r.agent as string) || "unknown",
			role: (r.role as string) || "unknown",
			doc_path: (r.doc_path as string) || null,
			created_at: r.created_at as string,
			updated_at: r.updated_at as string,
			in_progress_at: (r.in_progress_at as string) || null,
			finished_at: (r.finished_at as string) || null,
			canceled_at: (r.canceled_at as string) || null,
			est_tokens: (r.est_tokens as number) || 0,
			commit_id: (r.commit_id as string) || null,
			changed_files: this.safeJSONParse<string[]>(r.changed_files as string, []),
			tags: this.safeJSONParse<string[]>(r.tags as string, []),
			suggested_skills: this.safeJSONParse<string[]>(r.suggested_skills as string, []),
			metadata: this.safeJSONParse<Record<string, unknown>>(r.metadata as string, {}),
			parent_id: (r.parent_id as string) || null,
			depends_on: (r.depends_on as string) || null,
			parent_code: (r.parent_code as string) || null,
			depends_on_code: (r.depends_on_code as string) || null,
			coordination: {
				active_claim_count: (r.active_claim_count as number) || 0,
				active_claim_agent: (r.active_claim_agent as string) || null,
				active_claim_role: (r.active_claim_role as string) || null,
				active_claim_claimed_at: (r.active_claim_claimed_at as string) || null,
				pending_handoff_count: (r.pending_handoff_count as number) || 0,
				pending_handoff_id: (r.pending_handoff_id as string) || null,
				pending_handoff_summary: (r.pending_handoff_summary as string) || null,
				pending_handoff_to_agent: (r.pending_handoff_to_agent as string) || null,
				pending_handoff_created_at: (r.pending_handoff_created_at as string) || null
			},
			comments_count: (r.comments_count as number) || 0
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
	protected rowToSymbol(row: unknown): CodebaseSymbol {
		const r = row as Record<string, unknown>;
		return {
			id: r.id as string,
			repo: r.repo as string,
			file_path: r.file_path as string,
			name: r.name as string,
			kind: r.kind as string,
			exported: (r.exported as number) === 1,
			default_export: (r.default_export as number) === 1,
			start_line: (r.start_line as number) ?? null,
			start_col: (r.start_col as number) ?? null,
			end_line: (r.end_line as number) ?? null,
			end_col: (r.end_col as number) ?? null,
			signature: (r.signature as string) ?? null,
			doc_comment: (r.doc_comment as string) ?? null,
			parent_symbol_id: (r.parent_symbol_id as string) ?? null,
			created_at: r.created_at as string,
			updated_at: r.updated_at as string
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
