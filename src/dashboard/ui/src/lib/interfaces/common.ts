export interface Pagination {
	page: number;
	pageSize: number;
	totalItems: number;
	totalPages: number;
}

export interface RecentAction {
	id: number;
	action: string;
	query?: string;
	response?: string;
	memory_id?: string;
	memory_title?: string;
	memory_type?: string;
	task_id?: string;
	task_title?: string;
	task_code?: string;
	result_count?: number;
	created_at: string;
	burstCount?: number;
}
