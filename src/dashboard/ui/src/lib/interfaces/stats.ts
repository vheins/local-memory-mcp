import type { Memory } from "./memory";

export interface DashboardStats {
	total: number;
	avgImportance: string;
	totalHitCount: number;
	expiringSoon: number;
	byType: Record<string, number>;
	taskStats?: {
		total: number;
		backlog: number;
		pending: number;
		in_progress: number;
		completed: number;
		blocked: number;
	};
	todayCompleted?: number;
	todayAdded?: number;
	todayProcessed?: number;
	todayTokens?: number;
	todayAvgDuration?: number;
	timeSeries?: Record<string, Array<{ date: string; count: number }>>;
	scatterData?: Array<{ x: number; y: number }>;
	topMemories?: Memory[];
}

export interface TaskTimePeriodStats {
	completed: number;
	added: number;
	tokens: number;
	avgDuration: number;
	history: Array<{ label: string; created: number; completed: number }>;
}

export interface TaskTimeStats {
	daily: TaskTimePeriodStats;
	weekly: TaskTimePeriodStats;
	monthly: TaskTimePeriodStats;
	overall: TaskTimePeriodStats;
}
