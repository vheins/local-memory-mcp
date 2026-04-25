export interface Handoff {
	id: string;
	repo: string;
	from_agent: string;
	to_agent: string | null;
	task_id: string | null;
	task_code?: string | null;
	summary: string;
	context: Record<string, unknown>;
	status: "pending" | "accepted" | "rejected" | "expired";
	created_at: string;
	updated_at: string;
	expires_at: string | null;
}

export interface HandoffRow {
	id: string;
	repo: string;
	from_agent: string;
	to_agent: string | null;
	task_id: string | null;
	summary: string;
	context: string;
	status: string;
	created_at: string;
	updated_at: string;
	expires_at: string | null;
}

export interface Claim {
	id: string;
	repo: string;
	task_id: string;
	task_code?: string | null;
	agent: string;
	role: string;
	claimed_at: string;
	released_at: string | null;
	metadata: Record<string, unknown>;
}

export interface ClaimRow {
	id: string;
	repo: string;
	task_id: string;
	agent: string;
	role: string;
	claimed_at: string;
	released_at: string | null;
	metadata: string;
}
