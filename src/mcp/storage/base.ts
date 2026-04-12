import Database from "better-sqlite3";
import { tokenize } from "../utils/normalize";
import {
	MemoryEntry,
	MemoryRow,
	MemoryType,
	Task,
	TaskRow,
	TaskStatus,
	TaskPriority
} from "../types/index";

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
	protected rowToMemoryEntry(row: any): MemoryEntry {
		const r = row as any;
		return {
			id: r.id,
			type: r.type as MemoryType,
			title: r.title || "Untitled",
			content: r.content,
			importance: r.importance,
			agent: r.agent || "unknown",
			role: r.role || "unknown",
			model: r.model || "unknown",
			scope: {
				repo: r.repo,
				folder: r.folder || undefined,
				language: r.language || undefined
			},
			created_at: r.created_at,
			updated_at: r.updated_at,
			completed_at: r.completed_at || null,
			hit_count: r.hit_count ?? 0,
			recall_count: r.recall_count ?? 0,
			last_used_at: r.last_used_at ?? null,
			expires_at: r.expires_at ?? null,
			supersedes: r.supersedes ?? null,
			status: (r.status as "active" | "archived") || "active",
			is_global: r.is_global === 1,
			tags: this.safeJSONParse<string[]>(r.tags, []),
			metadata: this.safeJSONParse<Record<string, unknown>>(r.metadata, {})
		};
	}

	/**
	 * Mapping helper for Task
	 */
	protected rowToTask(row: any): Task {
		const r = row as any;
		return {
			id: r.id,
			repo: r.repo,
			task_code: r.task_code,
			phase: r.phase || "",
			title: r.title,
			description: r.description || null,
			status: (r.status as TaskStatus) || "backlog",
			priority: (r.priority as TaskPriority) || 3,
			agent: r.agent || "unknown",
			role: r.role || "unknown",
			doc_path: r.doc_path || null,
			created_at: r.created_at,
			updated_at: r.updated_at,
			in_progress_at: r.in_progress_at || null,
			finished_at: r.finished_at || null,
			canceled_at: r.canceled_at || null,
			est_tokens: r.est_tokens || 0,
			tags: this.safeJSONParse<string[]>(r.tags, []),
			metadata: this.safeJSONParse<Record<string, unknown>>(r.metadata, {}),
			parent_id: r.parent_id || null,
			depends_on: r.depends_on || null,
			comments_count: r.comments_count || 0
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
