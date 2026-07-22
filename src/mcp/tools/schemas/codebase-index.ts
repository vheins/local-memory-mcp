import { z } from "zod";

export const IndexRepoSchema = z.object({
	repo: z.string().min(1, "repo is required"),
	repoPath: z.string().min(1, "repoPath is required"),
	force: z.boolean().optional(),
	includeGlobs: z.array(z.string()).optional(),
	excludeGlobs: z.array(z.string()).optional()
});

export const IndexStatusSchema = z.object({
	repo: z.string().min(1, "repo is required"),
	repoPath: z.string().optional()
});

export const GetArchitectureSchema = z.object({
	repo: z.string().min(1, "repo is required"),
	depth: z.coerce.number().min(1).max(5).default(2),
	includeSymbolCounts: z.boolean().default(true)
});

export const GetFileSymbolsSchema = z.object({
	repo: z.string().min(1, "repo is required"),
	filePath: z.string().min(1, "filePath is required")
});

export const TraceSymbolSchema = z.object({
	name: z.string().min(1, "name is required"),
	repo: z.string().optional(),
	includeReferences: z.boolean().default(true)
});

export const SearchSymbolsSchema = z.object({
	query: z.string().optional().default(""),
	repo: z.string().optional(),
	kind: z.string().optional(),
	filePath: z.string().optional(),
	exportedOnly: z.boolean().optional(),
	limit: z.coerce.number().min(1).max(200).default(50),
	offset: z.coerce.number().min(0).default(0)
});
