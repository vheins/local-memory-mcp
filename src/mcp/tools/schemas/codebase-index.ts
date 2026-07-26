import { z } from "zod";
import { normalizeRepo } from "../../utils/normalize";

export const IndexRepoSchema = z.object({
	owner: z.string().min(1),
	repo: z.string().min(1).transform(normalizeRepo),
	repoPath: z.string().min(1, "repoPath is required"),
	force: z.boolean().optional(),
	includeGlobs: z.array(z.string()).optional(),
	excludeGlobs: z.array(z.string()).optional()
});

export const IndexStatusSchema = z.object({
	owner: z.string().min(1),
	repo: z.string().min(1).transform(normalizeRepo),
	repoPath: z.string().optional()
});

export const GetArchitectureSchema = z.object({
	owner: z.string().min(1),
	repo: z.string().min(1).transform(normalizeRepo),
	depth: z.coerce.number().min(1).max(5).default(2),
	includeSymbolCounts: z.coerce.boolean().default(true)
});

export const GetFileSymbolsSchema = z.object({
	owner: z.string().min(1),
	repo: z.string().min(1).transform(normalizeRepo),
	filePath: z.string().min(1, "filePath is required")
});

export const TraceSymbolSchema = z.object({
	name: z.string().optional(),
	symbol: z.string().optional(),
	owner: z.string().min(1),
	repo: z.string().min(1).transform(normalizeRepo).optional(),
	includeReferences: z.boolean().default(true)
});

export const SearchSymbolsSchema = z.object({
	query: z.string().optional().default(""),
	owner: z.string().min(1),
	repo: z.string().min(1).transform(normalizeRepo).optional(),
	kind: z.string().optional(),
	filePath: z.string().optional(),
	exportedOnly: z.boolean().optional(),
	limit: z.coerce.number().min(1).max(200).default(50),
	offset: z.coerce.number().min(0).default(0)
});

export const CodebaseSearchSchema = z.object({
	query: z.string().min(2, "query is required"),
	owner: z.string().min(1),
	repo: z.string().min(1).transform(normalizeRepo).optional(),
	kind: z.string().optional(),
	filePath: z.string().optional(),
	limit: z.coerce.number().min(1).max(100).default(20),
	offset: z.coerce.number().min(0).default(0)
});
