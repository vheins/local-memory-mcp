import Database from "better-sqlite3";
import { tokenize } from "../utils/normalize";
import { MemoryEntry, Task } from "../types";

/**
 * Base class for all database entities.
 * Provdes shared access to the database instance and mapping helpers.
 */
export abstract class BaseEntity {
	constructor(protected db: Database.Database) {}

	/**
	 * Safe JSON parsing helper to avoid crashes on corrupt data
	 */
	protected safeJSONParse<T>(json: string | null | undefined, defaultValue: T): T {
		if (!json) return defaultValue;
		try {
			return JSON.parse(json);
		} catch {
			return defaultValue;
		}
	}

	/**
	 * Mapping helper for MemoryEntry
	 */
	protected rowToMemoryEntry(row: MemoryRow): MemoryEntry {
		return {
			id: row.id,
			type: row.type as MemoryType,
			title: row.title || "Untitled",
			content: row.content,
			importance: row.importance,
			agent: row.agent || "unknown",
			role: row.role || "unknown",
			model: row.model || "unknown",
			scope: {
				repo: row.repo,
				folder: row.folder || undefined,
				language: row.language || undefined
			},
			created_at: row.created_at,
			updated_at: row.updated_at,
			completed_at: row.completed_at || null,
			hit_count: row.hit_count ?? 0,
			recall_count: row.recall_count ?? 0,
			last_used_at: row.last_used_at ?? null,
			expires_at: row.expires_at ?? null,
			supersedes: row.supersedes ?? null,
			status: (row.status as "active" | "archived") || "active",
			is_global: row.is_global === 1,
			tags: this.safeJSONParse<string[]>(row.tags, []),
			metadata: this.safeJSONParse<Record<string, unknown>>(row.metadata, {})
		};
	}

	/**
	 * Mapping helper for Task
	 */
	protected rowToTask(row: TaskRow): Task {
		return {
			id: row.id,
			repo: row.repo,
			task_code: row.task_code,
			phase: row.phase || "",
			title: row.title,
			description: row.description || null,
			status: (row.status as TaskStatus) || "backlog",
			priority: (row.priority as TaskPriority) || 3,
			agent: row.agent || "unknown",
			role: row.role || "unknown",
			doc_path: row.doc_path || null,
			created_at: row.created_at,
			updated_at: row.updated_at,
			in_progress_at: row.in_progress_at || null,
			finished_at: row.finished_at || null,
			canceled_at: row.canceled_at || null,
			est_tokens: row.est_tokens || 0,
			tags: this.safeJSONParse<string[]>(row.tags, []),
			metadata: this.safeJSONParse<Record<string, unknown>>(row.metadata, {}),
			parent_id: row.parent_id || null,
			depends_on: row.depends_on || null,
			comments_count: row.comments_count || 0
		};
	}

	/**
	 * Vector math utilities (simple bag-of-words implementation)
	 */
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
