export interface CodebaseFile {
	id: string;
	repo: string;
	file_path: string;
	language: string | null;
	checksum: string | null;
	lines: number;
	size_bytes: number;
	last_indexed_at: string | null;
	created_at: string;
	updated_at: string;
}

export interface CodebaseFileInsert {
	repo: string;
	file_path: string;
	language?: string | null;
	checksum?: string | null;
	lines?: number;
	size_bytes?: number;
}
