export type MemoryType =
	| "code_fact"
	| "decision"
	| "mistake"
	| "pattern"
	| "task_archive";

export type MemoryScope = {
	repo: string;
	branch?: string;
	folder?: string;
	language?: string;
};

export type MemoryEntry = {
	id: string;
	code?: string;
	type: MemoryType;
	title: string;
	content: string;
	importance: number;
	agent: string;
	role: string;
	model: string;
	scope: MemoryScope;
	created_at: string;
	updated_at: string;
	completed_at: string | null;
	hit_count: number;
	recall_count: number;
	last_used_at: string | null;
	expires_at: string | null;
	supersedes: string | null;
	status: "active" | "archived";
	tags: string[];
	metadata: Record<string, unknown>;
	is_global: boolean;
};

export type MemoryRow = {
	id: string;
	code?: string;
	type: MemoryType;
	title: string;
	content: string;
	importance: number;
	agent: string;
	role: string;
	model: string;
	repo: string;
	branch?: string;
	folder?: string;
	language?: string;
	created_at: string;
	updated_at: string;
	completed_at: string | null;
	expires_at: string | null;
	supersedes: string | null;
	status: "active" | "archived";
	is_global: number;
	tags: string;
	metadata: string;
};

export type MemoryRowParsed = Omit<MemoryEntry, "hit_count" | "recall_count" | "last_used_at"> & {
	is_global: boolean;
	tags: string[];
	metadata: Record<string, unknown>;
};

export type CodingStandardEntry = {
	id: string;
	code?: string;
	title: string;
	content: string;
	parent_id: string | null;
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
	hit_count: number;
	last_used_at: string | null;
	agent: string;
	model: string;
};

export type CodingStandardRow = {
	id: string;
	code?: string;
	title: string;
	content: string;
	parent_id: string | null;
	context: string;
	version: string;
	language: string | null;
	stack: string | null;
	is_global: number;
	repo: string | null;
	tags: string | null;
	metadata: string | null;
	created_at: string;
	updated_at: string;
	hit_count: number;
	last_used_at: string | null;
	agent: string;
	model: string;
};
