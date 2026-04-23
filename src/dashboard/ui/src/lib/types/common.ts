export type Theme = "light" | "dark";

export type MemoryType =
	| "code_fact"
	| "decision"
	| "mistake"
	| "pattern"
	| "file_claim"
	| "task_archive";

export type TaskStatus = "backlog" | "pending" | "in_progress" | "completed" | "canceled" | "blocked";

export type TaskPriority = 1 | 2 | 3 | 4 | 5;
