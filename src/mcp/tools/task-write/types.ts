import { TaskStatus } from "../../types";
import { ElicitationRequestHandler } from "../../elicitation";
import { SessionContext } from "../../session";

// ---------------------------------------------------------------------------
// Shared types for task-write operations
// ---------------------------------------------------------------------------

export type TaskWriteOptions = {
	session?: SessionContext;
	elicit?: ElicitationRequestHandler;
};

export type TaskWriteParams = {
	owner: string;
	repo: string;
	json: boolean;
	interactive?: boolean;

	// Identification (for update)
	id?: string;
	ids?: string[];
	code?: string;

	// Mutable fields
	phase?: string;
	title?: string;
	description?: string;
	status?: TaskStatus;
	priority?: number;
	agent?: string;
	role?: string;
	model?: string;
	comment?: string;
	doc_path?: string;
	tags?: string[];
	suggested_skills?: string[];
	metadata?: Record<string, unknown>;
	decision_refs?: string[];
	parent_id?: string;
	depends_on?: string;
	est_tokens?: number;
	commit_id?: string;
	changed_files?: string[];
	force?: boolean;

	// Bulk
	tasks?: Record<string, unknown>[];
};

export type ItemInfer = "create" | "update";
