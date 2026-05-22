import { BaseEntity } from "../storage/base";
import { TaskStats } from "../types";

export class TaskStatsEntity extends BaseEntity {
	getTaskStats(repo: string): TaskStats {
		const rows = this.all<{ status: string; count: number }>(
			"SELECT status, COUNT(*) as count FROM tasks WHERE repo = ? GROUP BY status",
			[repo]
		);
		const stats: TaskStats = { total: 0, backlog: 0, todo: 0, inProgress: 0, completed: 0, blocked: 0, canceled: 0 };
		rows.forEach((r) => {
			const count = r.count;
			stats.total += count;
			if (r.status === "backlog") stats.backlog = count;
			else if (r.status === "pending") stats.todo = count;
			else if (r.status === "in_progress") stats.inProgress = count;
			else if (r.status === "completed") stats.completed = count;
			else if (r.status === "blocked") stats.blocked = count;
			else if (r.status === "canceled") stats.canceled = count;
		});
		return stats;
	}

	getTaskTimeStats(
		repo: string | null,
		period: "daily" | "weekly" | "monthly" | "overall"
	): { completed: number; tokens: number; avgDuration: number; added: number } {
		let dateFilter = "";
		if (period === "daily") dateFilter = "AND date(COALESCE(finished_at, updated_at)) = date('now')";
		else if (period === "weekly") dateFilter = "AND date(COALESCE(finished_at, updated_at)) >= date('now', '-7 days')";
		else if (period === "monthly")
			dateFilter = "AND date(COALESCE(finished_at, updated_at)) >= date('now', '-30 days')";

		const repoWhere = repo ? "repo = ?" : "1=1";
		const repoParams = repo ? [repo] : [];

		const stats = this.get<{ completed_count: number; total_tokens: number; avg_duration_seconds: number }>(
			`SELECT 
				COUNT(*) as completed_count,
				SUM(est_tokens) as total_tokens,
				AVG(
					CASE 
						WHEN in_progress_at IS NOT NULL AND finished_at IS NOT NULL 
						THEN (julianday(finished_at) - julianday(in_progress_at)) * 86400.0 
						ELSE NULL 
					END
				) as avg_duration_seconds
			FROM tasks 
			WHERE ${repoWhere}
			AND status = 'completed' 
			${dateFilter}`,
			repoParams
		);

		let addedDateFilter = "";
		if (period === "daily") addedDateFilter = "AND date(created_at) = date('now')";
		else if (period === "weekly") addedDateFilter = "AND date(created_at) >= date('now', '-7 days')";
		else if (period === "monthly") addedDateFilter = "AND date(created_at) >= date('now', '-30 days')";

		const added = this.get<{ count: number }>(
			`SELECT COUNT(*) as count FROM tasks WHERE ${repoWhere} ${addedDateFilter}`,
			repoParams
		);

		const avgDurationMinutes = stats?.avg_duration_seconds ? stats.avg_duration_seconds / 60 : 0;

		return {
			completed: stats?.completed_count || 0,
			tokens: stats?.total_tokens || 0,
			avgDuration: avgDurationMinutes,
			added: added?.count || 0
		};
	}

	getTaskComparisonSeries(
		repo: string | null,
		period: "daily" | "weekly" | "monthly" | "overall"
	): { label: string; created: number; completed: number }[] {
		let labelFormat: string;
		let dateFilter: string;

		if (period === "daily") {
			labelFormat = "%H:00";
			dateFilter = "date(COALESCE(finished_at, created_at)) = date('now')";
		} else if (period === "weekly") {
			labelFormat = "%Y-%m-%d";
			dateFilter = "date(COALESCE(finished_at, created_at)) >= date('now', '-6 days')";
		} else if (period === "monthly") {
			labelFormat = "W%W";
			dateFilter = "date(COALESCE(finished_at, created_at)) >= date('now', '-30 days')";
		} else {
			labelFormat = "%Y-%m";
			dateFilter = "1=1";
		}

		const createdDateFilter = dateFilter.replace("COALESCE(finished_at, created_at)", "created_at");
		const completedDateFilter = dateFilter.replace(
			"COALESCE(finished_at, created_at)",
			"COALESCE(finished_at, updated_at)"
		);
		const createdRepoFilter = repo ? "repo = ? AND " : "";
		const completedRepoFilter = repo ? "repo = ? AND " : "";

		const query = `
			SELECT label, SUM(created) as created, SUM(completed) as completed
			FROM (
				SELECT strftime(?, created_at) as label, 1 as created, 0 as completed 
				FROM tasks 
				WHERE ${createdRepoFilter}${createdDateFilter}
				UNION ALL
				SELECT strftime(?, COALESCE(finished_at, updated_at)) as label, 0 as created, 1 as completed 
				FROM tasks 
				WHERE ${completedRepoFilter}status = 'completed' AND ${completedDateFilter}
			)
			GROUP BY label
			ORDER BY label ASC
			LIMIT 100
		`;

		const params: Array<string | null> = [labelFormat];
		if (repo) params.push(repo);
		params.push(labelFormat);
		if (repo) params.push(repo);

		return this.all<{ label: string; created: number; completed: number }>(query, params);
	}
}
