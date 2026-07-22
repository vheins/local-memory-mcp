import { z } from "zod";

export const IndexRepoSchema = z.object({
	repo: z.string().min(1, "repo is required"),
	repoPath: z.string().min(1, "repoPath is required"),
	force: z.boolean().optional(),
	includeGlobs: z.array(z.string()).optional(),
	excludeGlobs: z.array(z.string()).optional()
});

export const IndexStatusSchema = z.object({
	repo: z.string().min(1, "repo is required")
});
