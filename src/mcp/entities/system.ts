import { BaseEntity } from "../storage/base";
import { MemoryEntry, Task } from "../types";

export class SystemEntity extends BaseEntity {
	listRepos(): string[] {
		const rows = this.all<{ repo: string }>("SELECT DISTINCT repo FROM memories UNION SELECT DISTINCT repo FROM tasks");
		return rows.map((r) => r.repo);
	}

	listRepoNavigation(): { repo: string; memoryCount: number; taskCount: number; lastActivity: string | null }[] {
		const repos = this.listRepos();
		return repos.map((repo) => {
			const memoryCountRow = this.get<{ count: number }>("SELECT COUNT(*) as count FROM memories WHERE repo = ?", [
				repo
			]);
			const taskCountRow = this.get<{ count: number }>("SELECT COUNT(*) as count FROM tasks WHERE repo = ?", [repo]);
			const lastActivityRow = this.get<{ last: string | null }>(
				`SELECT MAX(created_at) as last FROM (SELECT created_at FROM memories WHERE repo = ? UNION ALL SELECT created_at FROM tasks WHERE repo = ? UNION ALL SELECT created_at FROM action_log WHERE repo = ?)`,
				[repo, repo, repo]
			);

			return {
				repo,
				memoryCount: memoryCountRow?.count ?? 0,
				taskCount: taskCountRow?.count ?? 0,
				lastActivity: lastActivityRow?.last ?? null
			};
		});
	}

	getDashboardStats(repo: string): {
		memoryStats: { type: string; count: number }[];
		taskStats: { status: string; count: number }[];
		recentMemories: MemoryEntry[];
		activeTasks: Task[];
	} {
		const memoryStats = this.all<{ type: string; count: number }>(
			"SELECT type, COUNT(*) as count FROM memories WHERE repo = ? GROUP BY type",
			[repo]
		);
		const taskStats = this.all<{ status: string; count: number }>(
			"SELECT status, COUNT(*) as count FROM tasks WHERE repo = ? GROUP BY status",
			[repo]
		);
		const recentMemoriesRows = this.all<Record<string, unknown>>(
			"SELECT * FROM memories WHERE repo = ? ORDER BY created_at DESC LIMIT 5",
			[repo]
		);
		const recentMemories = recentMemoriesRows.map((r) => this.rowToMemoryEntry(r));
		const activeTasksRows = this.all<Record<string, unknown>>(
			"SELECT * FROM tasks WHERE repo = ? AND status IN ('in_progress', 'pending', 'backlog') ORDER BY priority DESC, created_at ASC LIMIT 5",
			[repo]
		);
		const activeTasks = activeTasksRows.map((r) => this.rowToTask(r));

		return {
			memoryStats,
			taskStats,
			recentMemories,
			activeTasks
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
