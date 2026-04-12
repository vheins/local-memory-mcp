import { execSync } from "child_process";
import path from "path";

export function resolveGitScope(cwd = process.cwd()) {
	// 1. Try git root
	try {
		const root = execSync("git rev-parse --show-toplevel", {
			cwd,
			stdio: ["ignore", "pipe", "ignore"]
		})
			.toString()
			.trim();

		const repo = path.basename(root);

		let branch: string | undefined;
		try {
			branch = execSync("git rev-parse --abbrev-ref HEAD", {
				cwd,
				stdio: ["ignore", "pipe", "ignore"]
			})
				.toString()
				.trim();
		} catch {}

		return {
			repo,
			branch
		};
	} catch {}

	// 2. Fallback: project folder
	const fallback = path.basename(cwd);

	if (fallback) {
		return {
			repo: fallback
		};
	}

	throw new Error("Unable to resolve project scope (no git repo, no folder)");
}
