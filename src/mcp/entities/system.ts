import { BaseEntity } from "../storage/base";
import { MemoryEntry, Task } from "../types";

export class SystemEntity extends BaseEntity {
	listRepos(): string[] {
		const rows = this.all<{ repo: string }>("SELECT DISTINCT repo FROM memories UNION SELECT DISTINCT repo FROM tasks");
		return rows.map((r) => r.repo);
	}

	listRepoNavigation(): {
		repo: string;
		memoryCount: number;
		taskCount: number;
		inProgressCount: number;
		pendingCount: number;
		blockedCount: number;
		backlogCount: number;
		lastActivity: string | null;
	}[] {
		const repos = this.listRepos();
		return repos.map((repo) => {
			const memoryCountRow = this.get<{ count: number }>("SELECT COUNT(*) as count FROM memories WHERE repo = ?", [
				repo
			]);
			const lastActivityRow = this.get<{ last: string | null }>(
				`SELECT MAX(created_at) as last FROM (SELECT created_at FROM memories WHERE repo = ? UNION ALL SELECT created_at FROM tasks WHERE repo = ? UNION ALL SELECT created_at FROM action_log WHERE repo = ?)`,
				[repo, repo, repo]
			);

			// Per-status task counts in a single query
			const taskStatusRows = this.all<{ status: string; count: number }>(
				"SELECT status, COUNT(*) as count FROM tasks WHERE repo = ? GROUP BY status",
				[repo]
			);
			const taskStatusMap: Record<string, number> = {};
			taskStatusRows.forEach((r) => {
				taskStatusMap[r.status] = r.count;
			});
			const taskCount = taskStatusRows.reduce((sum, r) => sum + r.count, 0);

			return {
				repo,
				memoryCount: memoryCountRow?.count ?? 0,
				taskCount,
				inProgressCount: taskStatusMap["in_progress"] ?? 0,
				pendingCount: taskStatusMap["pending"] ?? 0,
				blockedCount: taskStatusMap["blocked"] ?? 0,
				backlogCount: taskStatusMap["backlog"] ?? 0,
				lastActivity: lastActivityRow?.last ?? null
			};
		});
	}

	getDashboardStats(repo: string): {
		total: number;
		avgImportance: string;
		totalHitCount: number;
		expiringSoon: number;
		byType: Record<string, number>;
		taskStats: {
			total: number;
			backlog: number;
			todo: number;
			inProgress: number;
			completed: number;
			blocked: number;
		};
		topMemories: MemoryEntry[];
	} {
		const totalCountRow = this.get<{ count: number }>("SELECT COUNT(*) as count FROM memories WHERE repo = ?", [repo]);
		const avgImportanceRow = this.get<{ avg: number }>("SELECT AVG(importance) as avg FROM memories WHERE repo = ?", [
			repo
		]);
		const totalHitCountRow = this.get<{ count: number }>(
			"SELECT SUM(hit_count) as count FROM memories WHERE repo = ?",
			[repo]
		);
		const expiringSoonRow = this.get<{ count: number }>(
			"SELECT COUNT(*) as count FROM memories WHERE repo = ? AND expires_at IS NOT NULL AND expires_at > ? AND expires_at <= ?",
			[repo, new Date().toISOString(), new Date(Date.now() + 7 * 86400 * 1000).toISOString()]
		);

		const typeStats = this.all<{ type: string; count: number }>(
			"SELECT type, COUNT(*) as count FROM memories WHERE repo = ? GROUP BY type",
			[repo]
		);
		const byType: Record<string, number> = {};
		typeStats.forEach((t) => {
			byType[t.type] = t.count;
		});

		const taskRows = this.all<{ status: string; count: number }>(
			"SELECT status, COUNT(*) as count FROM tasks WHERE repo = ? GROUP BY status",
			[repo]
		);

		const taskStats = {
			total: 0,
			backlog: 0,
			pending: 0,
			in_progress: 0,
			completed: 0,
			blocked: 0
		};

		taskRows.forEach((r) => {
			taskStats.total += r.count;
			if (r.status === "backlog") taskStats.backlog = r.count;
			else if (r.status === "pending") taskStats.pending = r.count;
			else if (r.status === "in_progress") taskStats.in_progress = r.count;
			else if (r.status === "completed") taskStats.completed = r.count;
			else if (r.status === "blocked") taskStats.blocked = r.count;
		});

		const topMemoriesRows = this.all<Record<string, unknown>>(
			"SELECT * FROM memories WHERE repo = ? ORDER BY importance DESC, created_at DESC LIMIT 5",
			[repo]
		);
		const topMemories = topMemoriesRows.map((r) => this.rowToMemoryEntry(r));

		return {
			total: totalCountRow?.count ?? 0,
			avgImportance: (avgImportanceRow?.avg ?? 0).toFixed(1),
			totalHitCount: totalHitCountRow?.count ?? 0,
			expiringSoon: expiringSoonRow?.count ?? 0,
			byType,
			taskStats,
			topMemories
		};
	}

	getGlobalStats(): { totalMemories: number; totalTasks: number; totalRepos: number } {
		const totalMemoriesRow = this.get<{ count: number }>("SELECT COUNT(*) as count FROM memories");
		const totalTasksRow = this.get<{ count: number }>("SELECT COUNT(*) as count FROM tasks");
		const totalRepos = this.listRepos().length;

		return {
			totalMemories: totalMemoriesRow?.count ?? 0,
			totalTasks: totalTasksRow?.count ?? 0,
			totalRepos
		};
	}

	getRepoDetails(repo: string): { repo: string; memoryCount: number; taskCount: number; languages: string[] } {
		const memoryCountRow = this.get<{ count: number }>("SELECT COUNT(*) as count FROM memories WHERE repo = ?", [repo]);
		const taskCountRow = this.get<{ count: number }>("SELECT COUNT(*) as count FROM tasks WHERE repo = ?", [repo]);
		const languagesRows = this.all<{ language: string }>(
			"SELECT DISTINCT language FROM memories WHERE repo = ? AND language IS NOT NULL",
			[repo]
		);
		const languages = languagesRows.map((r) => r.language);

		return {
			repo,
			memoryCount: memoryCountRow?.count ?? 0,
			taskCount: taskCountRow?.count ?? 0,
			languages
		};
	}
}
