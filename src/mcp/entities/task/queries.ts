/**
 * Builds the coordination select subquery fragment used in task queries.
 * Returns a SQL fragment with active claim and pending handoff subqueries.
 */
export function buildCoordinationSelect(alias = "t"): string {
	return `
			(SELECT COUNT(*) FROM claims c WHERE c.task_id = ${alias}.id AND c.released_at IS NULL) as active_claim_count,
			(SELECT c.agent FROM claims c WHERE c.task_id = ${alias}.id AND c.released_at IS NULL ORDER BY c.claimed_at DESC LIMIT 1) as active_claim_agent,
			(SELECT c.role FROM claims c WHERE c.task_id = ${alias}.id AND c.released_at IS NULL ORDER BY c.claimed_at DESC LIMIT 1) as active_claim_role,
			(SELECT c.claimed_at FROM claims c WHERE c.task_id = ${alias}.id AND c.released_at IS NULL ORDER BY c.claimed_at DESC LIMIT 1) as active_claim_claimed_at,
			(SELECT COUNT(*) FROM handoffs h WHERE h.task_id = ${alias}.id AND h.status = 'pending') as pending_handoff_count,
			(SELECT h.id FROM handoffs h WHERE h.task_id = ${alias}.id AND h.status = 'pending' ORDER BY h.created_at DESC LIMIT 1) as pending_handoff_id,
			(SELECT h.summary FROM handoffs h WHERE h.task_id = ${alias}.id AND h.status = 'pending' ORDER BY h.created_at DESC LIMIT 1) as pending_handoff_summary,
			(SELECT h.to_agent FROM handoffs h WHERE h.task_id = ${alias}.id AND h.status = 'pending' ORDER BY h.created_at DESC LIMIT 1) as pending_handoff_to_agent,
			(SELECT h.created_at FROM handoffs h WHERE h.task_id = ${alias}.id AND h.status = 'pending' ORDER BY h.created_at DESC LIMIT 1) as pending_handoff_created_at
		`;
}

/**
 * Generates ORDER BY clause for task queries that sorts by status priority
 * (in_progress first, then pending, backlog, blocked, canceled, completed last).
 */
export function taskStatusOrderBy(): string {
	return `
		CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END ASC,
		CASE WHEN t.status = 'completed' THEN t.updated_at ELSE NULL END DESC,
		CASE WHEN t.status = 'in_progress' THEN 0
			WHEN t.status = 'pending' THEN 1
			WHEN t.status = 'backlog' THEN 2
			WHEN t.status = 'blocked' THEN 3
			WHEN t.status = 'canceled' THEN 4
			ELSE 5 END ASC,
		t.priority DESC,
		t.created_at ASC
	`;
}

/**
 * Builds the shared task SELECT skeleton (TASK-112) used by every task row
 * query: `t.*` plus the joined depends_on_code/parent_code, the coordination
 * select, and (optionally) a batched comments_count subquery. A schema change
 * to the row shape is made here once.
 *
 * @param alias            Table alias for the tasks row (default "t").
 * @param includeComments  When true (default) appends the comments_count
 *                         subquery. The single-row methods that fetch comments
 *                         separately pass false to keep the SQL identical to
 *                         the pre-refactor form.
 */
export function taskSelectSkeleton(alias = "t", includeComments = true): string {
	const commentsCount = includeComments
		? `,\n\t\t\t(SELECT COUNT(*) FROM task_comments WHERE task_id = ${alias}.id) as comments_count`
		: "";
	return `SELECT ${alias}.*, d.task_code as depends_on_code, p.task_code as parent_code,
		${buildCoordinationSelect(alias)}${commentsCount}
		FROM tasks ${alias}
		LEFT JOIN tasks d ON ${alias}.depends_on = d.id
		LEFT JOIN tasks p ON ${alias}.parent_id = p.id
	`;
}

/**
 * WHERE fragment for owner/repo scoping shared by task list and count queries
 * (TASK-112). Pass `alias` (e.g. "t") for queries that join the row skeleton,
 * or undefined for bare `tasks` counts.
 */
export function taskRepoFilter(
	alias: string | undefined,
	owner: string | undefined,
	repo: string
): { clause: string; params: string[] } {
	const a = alias ? `${alias}.` : "";
	if (owner) {
		return { clause: `${a}owner = ? AND ${a}repo = ?`, params: [owner, repo] };
	}
	return { clause: `${a}repo = ?`, params: [repo] };
}

/**
 * Optional single-status filter fragment (` AND t.status = ?`) shared by
 * getTasksByRepo/countTasks (TASK-112). Returns null when no status filter
 * applies so callers keep WHERE assembly identical to the pre-refactor form.
 */
export function taskStatusFilter(alias: string | undefined, status: string | undefined): string | null {
	if (!status) return null;
	const a = alias ? `${alias}.` : "";
	return ` AND ${a}status = ?`;
}

/**
 * Optional multi-status filter fragment (` AND t.status IN (?, ...)`) shared
 * by getTasksByMultipleStatuses/countTasksByMultipleStatuses (TASK-112).
 * Returns null when statuses is empty (callers guard with an early return
 * before calling).
 */
export function taskStatusesFilter(alias: string | undefined, statuses: string[]): string | null {
	if (statuses.length === 0) return null;
	const a = alias ? `${alias}.` : "";
	return ` AND ${a}status IN (${statuses.map(() => "?").join(",")})`;
}

/**
 * Optional search filter fragment (` AND (t.title LIKE ? OR ...)`) shared by
 * task list and count queries (TASK-112). Returns null when no search term is
 * present. Callers must push `%term%` three times (title/description/task_code).
 */
export function taskSearchFilter(alias: string | undefined, search: string | undefined): string | null {
	if (!search) return null;
	const a = alias ? `${alias}.` : "";
	return ` AND (${a}title LIKE ? OR ${a}description LIKE ? OR ${a}task_code LIKE ?)`;
}
