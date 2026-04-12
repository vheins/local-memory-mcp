export type TaskStatus = "backlog" | "pending" | "in_progress" | "completed" | "canceled" | "blocked";
export type TaskPriority = 1 | 2 | 3 | 4 | 5;

export interface TaskStats {
	total: number;
	backlog: number;
	todo: number;
	inProgress: number;
	completed: number;
	blocked: number;
	canceled: number;
}

export interface Task {
	id: string;
	repo: string;
	task_code: string;
	phase: string;
	title: string;
	description: string | null;
	status: TaskStatus;
	priority: TaskPriority;
	agent: string;
	role: string;
	doc_path: string | null;
	created_at: string;
	updated_at: string;
	in_progress_at: string | null;
	finished_at: string | null;
	canceled_at: string | null;
	est_tokens: number;
	tags: string[];
	metadata: Record<string, unknown>;
	parent_id: string | null;
	depends_on: string | null;
	comments?: TaskComment[];
	comments_count?: number;
}

export interface TaskComment {
	id: string;
	task_id: string;
	repo: string;
	comment: string;
	agent: string;
	role: string;
	model: string;
	previous_status: TaskStatus | null;
	next_status: TaskStatus | null;
	created_at: string;
}

export interface TaskRow {
	id: string;
	repo: string;
	task_code: string;
	phase: string;
	title: string;
	description: string | null;
	status: TaskStatus;
	priority: TaskPriority;
	agent: string;
	role: string;
	doc_path: string | null;
	created_at: string;
	updated_at: string;
	in_progress_at: string | null;
	finished_at: string | null;
	canceled_at: string | null;
	est_tokens: number;
	tags: string;
	metadata: string;
	parent_id: string | null;
	depends_on: string | null;
	comments_count: number;
}

export type TaskRowParsed = Omit<Task, "tags" | "metadata" | "comments_count"> & {
	tags: string[];
	metadata: Record<string, unknown>;
	comments_count: number;
};
