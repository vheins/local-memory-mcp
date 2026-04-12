export interface RepoMeta {
	repo: string;
	memory_count: number;
	task_count?: number;
	pending_count?: number;
	in_progress_count?: number;
	blocked_count?: number;
	backlog_count?: number;
	last_updated_at?: string;
}

export interface ReferenceItem {
	type: "tool" | "prompt" | "resource";
	data: {
		name: string;
		description?: string;
		inputSchema?: {
			type: string;
			properties?: Record<string, { type: string; description?: string }>;
			required?: string[];
		};
		arguments?: Array<{
			name: string;
			description?: string;
			required?: boolean;
		}>;
		messages?: Array<{
			role: string;
			content: string | { text: string };
		}>;
		uri?: string;
		mimeType?: string;
	};
}

export interface ReferenceDataState {
	tools: ReferenceItem[];
	prompts: ReferenceItem[];
	resources: ReferenceItem[];
}

export interface HealthData {
	connected: boolean;
	uptime: number;
	version: string;
	memoryCount: number;
	dbPath: string;
}
