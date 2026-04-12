export interface Task {
	id: string;
	repo: string;
	task_code: string;
	phase: string;
	title: string;
	description: string;
	status: string;
	priority: number;
	agent?: string;
	role?: string;
	created_at: string;
	updated_at: string;
	finished_at?: string;
	in_progress_at?: string;
	est_tokens?: number;
	tags?: string[];
	metadata?: Record<string, unknown>;
	parent_id?: string;
	depends_on?: string;
	comments?: TaskComment[];
}

export interface TaskComment {
	id: string;
	task_id: string;
	repo: string;
	comment: string;
	agent?: string;
	role?: string;
	model?: string;
	previous_status?: string;
	next_status?: string;
	created_at: string;
}
