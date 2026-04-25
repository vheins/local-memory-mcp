export interface McpToolResponse<T = unknown> {
	content?: Array<{ type: string; text?: string }>;
	isError?: boolean;
	structuredContent?: T;
}

export interface CodingStandard {
	id: string;
	title: string;
	content: string;
	parent_id?: string | null;
	context: string;
	version: string;
	language: string | null;
	stack: string[];
	is_global: boolean;
	repo: string | null;
	tags: string[];
	metadata: Record<string, unknown>;
	created_at: string;
	updated_at: string;
	hit_count?: number;
	last_used_at?: string | null;
	agent?: string;
	model?: string;
}

export interface StandardSearchResult {
	schema: "standard-search";
	query: string;
	count: number;
	total: number;
	offset: number;
	limit: number;
	results: {
		columns: string[];
		rows: unknown[][];
	};
}

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

export interface HandoffListResult {
	schema: "handoff-list";
	handoffs: {
		columns: string[];
		rows: unknown[][];
	};
	count: number;
	offset: number;
}

export interface TaskClaim {
	id: string;
	repo: string;
	task_id: string;
	task_code?: string;
	agent: string;
	role: string;
	claimed_at: string;
	released_at: string | null;
	metadata: Record<string, unknown>;
}

export interface ClaimListResult {
	schema: "claim-list";
	claims: {
		columns: string[];
		rows: unknown[][];
	};
	count: number;
	offset: number;
}
