import Database from "better-sqlite3";
import { tokenize } from "../utils/normalize";
import { MemoryEntry, MemoryType, Task, TaskStatus, TaskPriority } from "../types/index";

export abstract class BaseEntity {
	constructor(protected db: Database.Database) {}

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
			metadata: this.safeJSONParse<Record<string, unknown>>(r.metadata as string, {})
		};
	}

	protected rowToTask(row: unknown): Task {
		const r = row as Record<string, unknown>;
		return {
			id: r.id as string,
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
			tags: this.safeJSONParse<string[]>(r.tags as string, []),
			metadata: this.safeJSONParse<Record<string, unknown>>(r.metadata as string, {}),
			parent_id: (r.parent_id as string) || null,
			depends_on: (r.depends_on as string) || null,
			comments_count: (r.comments_count as number) || 0
		};
	}

	protected computeVector(text: string): Record<string, number> {
		const tokens = tokenize(text);
		const vector: Record<string, number> = {};
		tokens.forEach((token) => {
			vector[token] = (vector[token] || 0) + 1;
		});
		return vector;
	}

	protected cosineSimilarity(v1: Record<string, number>, v2: Record<string, number>): number {
		const keys1 = Object.keys(v1);
		const keys2 = Object.keys(v2);
		if (!keys1.length || !keys2.length) return 0;

		let dotProduct = 0;
		for (const key of keys1) {
			if (v2[key]) dotProduct += v1[key] * v2[key];
		}

		let mag1 = 0;
		for (const key of keys1) mag1 += v1[key] * v1[key];

		let mag2 = 0;
		for (const key of keys2) mag2 += v2[key] * v2[key];

		const mag = Math.sqrt(mag1) * Math.sqrt(mag2);
		return mag === 0 ? 0 : dotProduct / mag;
	}
}
