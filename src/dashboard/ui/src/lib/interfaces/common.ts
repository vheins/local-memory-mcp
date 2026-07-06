export interface Pagination {
	page: number;
	pageSize: number;
	totalItems: number;
	totalPages: number;
}

export interface KGNode {
	id: string;
	name: string;
	type: string;
	description?: string;
	memoryCount?: number;
}

export interface KGEdge {
	source: string;
	target: string;
	relation_type: string;
}

export interface KGEntity {
	name: string;
	type: string;
	description?: string;
	repo: string;
	created_at: string;
	updated_at: string;
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
