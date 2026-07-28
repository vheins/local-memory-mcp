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
