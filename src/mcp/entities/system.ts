import { BaseEntity } from "../storage/base.js";
import { MemoryEntry, Task } from "../types.js";

/**
 * Handles system-wide statistics and cross-entity navigation.
 */
export class SystemEntity extends BaseEntity {
	listRepos(): string[] {
		const rows = this.db.prepare("SELECT DISTINCT repo FROM memories UNION SELECT DISTINCT repo FROM tasks").all() as { repo: string }[];
		return rows.map((r) => r.repo);
	}

	listRepoNavigation(): { repo: string; memoryCount: number; taskCount: number; lastActivity: string | null }[] {
		const repos = this.listRepos();
		return repos.map((repo) => {
			const memoryCount = (this.db.prepare("SELECT COUNT(*) as count FROM memories WHERE repo = ?").get(repo) as { count: number })
				.count;
			const taskCount = (this.db.prepare("SELECT COUNT(*) as count FROM tasks WHERE repo = ?").get(repo) as { count: number }).count;
			const lastActivity = (
				this.db
					.prepare(`
        SELECT MAX(created_at) as last FROM (
          SELECT created_at FROM memories WHERE repo = ? 
          UNION ALL 
          SELECT created_at FROM tasks WHERE repo = ?
          UNION ALL
          SELECT created_at FROM action_log WHERE repo = ?
        )
      `)
					.get(repo, repo, repo) as { last: string | null }
			).last;

			return {
				repo,
				memoryCount,
				taskCount,
				lastActivity
			};
		});
	}

	getDashboardStats(repo: string): { memoryStats: { type: string; count: number }[]; taskStats: { status: string; count: number }[]; recentMemories: MemoryEntry[]; activeTasks: Task[] } {
		const memoryStats = this.db
			.prepare("SELECT type, COUNT(*) as count FROM memories WHERE repo = ? GROUP BY type")
			.all(repo) as { type: string; count: number }[];
		const taskStats = this.db
			.prepare("SELECT status, COUNT(*) as count FROM tasks WHERE repo = ? GROUP BY status")
			.all(repo) as { status: string; count: number }[];
		const recentMemories = (
			this.db.prepare("SELECT * FROM memories WHERE repo = ? ORDER BY created_at DESC LIMIT 5").all(repo) as MemoryEntry[]
		).map((r) => this.rowToMemoryEntry(r));
		const activeTasks = (
			this.db
				.prepare(
					"SELECT * FROM tasks WHERE repo = ? AND status IN ('in_progress', 'pending', 'backlog') ORDER BY priority DESC, created_at ASC LIMIT 5"
				)
				.all(repo) as Task[]
		).map((r) => this.rowToTask(r));

		return {
			memoryStats,
			taskStats,
			recentMemories,
			activeTasks
		};
	}

	getGlobalStats(): { totalMemories: number; totalTasks: number; totalRepos: number } {
		const totalMemories = (this.db.prepare("SELECT COUNT(*) as count FROM memories").get() as { count: number }).count;
		const totalTasks = (this.db.prepare("SELECT COUNT(*) as count FROM tasks").get() as { count: number }).count;
		const totalRepos = this.listRepos().length;

		return {
			totalMemories,
			totalTasks,
			totalRepos
		};
	}

	getRepoDetails(repo: string): { repo: string; memoryCount: number; taskCount: number; languages: string[] } {
		const memoryCount = (this.db.prepare("SELECT COUNT(*) as count FROM memories WHERE repo = ?").get(repo) as { count: number })
			.count;
		const taskCount = (this.db.prepare("SELECT COUNT(*) as count FROM tasks WHERE repo = ?").get(repo) as { count: number }).count;
		const languages = (
			this.db
				.prepare("SELECT DISTINCT language FROM memories WHERE repo = ? AND language IS NOT NULL")
				.all(repo) as { language: string }[]
		).map((r) => r.language);

		return {
			repo,
			memoryCount,
			taskCount,
			languages
		};
	}
}
