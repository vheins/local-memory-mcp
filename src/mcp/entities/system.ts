import { BaseEntity } from "../storage/base.js";

/**
 * Handles system-wide statistics and cross-entity navigation.
 */
export class SystemEntity extends BaseEntity {
	listRepos(): string[] {
		const rows = this.db
			.prepare("SELECT DISTINCT repo FROM memories UNION SELECT DISTINCT repo FROM tasks")
			.all() as any[];
		return rows.map((r) => r.repo);
	}

	listRepoNavigation(): any[] {
		const repos = this.listRepos();
		return repos.map((repo) => {
			const memoryCount = (this.db.prepare("SELECT COUNT(*) as count FROM memories WHERE repo = ?").get(repo) as any)
				.count;
			const taskCount = (this.db.prepare("SELECT COUNT(*) as count FROM tasks WHERE repo = ?").get(repo) as any).count;
			const lastActivity = (
				this.db
					.prepare(
						`
        SELECT MAX(created_at) as last FROM (
          SELECT created_at FROM memories WHERE repo = ? 
          UNION ALL 
          SELECT created_at FROM tasks WHERE repo = ?
          UNION ALL
          SELECT created_at FROM action_log WHERE repo = ?
        )
      `
					)
					.get(repo, repo, repo) as any
			).last;

			return {
				repo,
				memoryCount,
				taskCount,
				lastActivity
			};
		});
	}

	getDashboardStats(repo: string): any {
		const memoryStats = this.db
			.prepare("SELECT type, COUNT(*) as count FROM memories WHERE repo = ? GROUP BY type")
			.all(repo) as any[];
		const taskStats = this.db
			.prepare("SELECT status, COUNT(*) as count FROM tasks WHERE repo = ? GROUP BY status")
			.all(repo) as any[];
		const recentMemories = (
			this.db.prepare("SELECT * FROM memories WHERE repo = ? ORDER BY created_at DESC LIMIT 5").all(repo) as any[]
		).map((r) => this.rowToMemoryEntry(r));
		const activeTasks = (
			this.db
				.prepare(
					"SELECT * FROM tasks WHERE repo = ? AND status IN ('in_progress', 'pending', 'backlog') ORDER BY priority DESC, created_at ASC LIMIT 5"
				)
				.all(repo) as any[]
		).map((r) => this.rowToTask(r));

		return {
			memoryStats,
			taskStats,
			recentMemories,
			activeTasks
		};
	}

	getGlobalStats(): any {
		const totalMemories = (this.db.prepare("SELECT COUNT(*) as count FROM memories").get() as any).count;
		const totalTasks = (this.db.prepare("SELECT COUNT(*) as count FROM tasks").get() as any).count;
		const totalRepos = this.listRepos().length;

		return {
			totalMemories,
			totalTasks,
			totalRepos
		};
	}

	getRepoDetails(repo: string): any {
		const memoryCount = (this.db.prepare("SELECT COUNT(*) as count FROM memories WHERE repo = ?").get(repo) as any)
			.count;
		const taskCount = (this.db.prepare("SELECT COUNT(*) as count FROM tasks WHERE repo = ?").get(repo) as any).count;
		const languages = (
			this.db
				.prepare("SELECT DISTINCT language FROM memories WHERE repo = ? AND language IS NOT NULL")
				.all(repo) as any[]
		).map((r) => r.language);

		return {
			repo,
			memoryCount,
			taskCount,
			languages
		};
	}
}
