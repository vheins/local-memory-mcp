// Normalization layer for text processing
// Requirements: 4.1, 5.1, 17.4
import { STOPWORDS } from "./stopwords.js";

export { STOPWORDS };

export function normalize(text: string): string {
	return (
		text
			.toLowerCase()
			// Keep alphanumeric, spaces, and tech-friendly symbols (underscore, hyphen, dot)
			.replace(/[^a-z0-9\s_\-.]/g, " ")
			.replace(/\s+/g, " ")
			.trim()
	);
}

/**
 * Normalizes a repository name by removing common owner/ prefixes (e.g. 'vheins/repo' -> 'repo').
 * This prevents agents from accidentally using full GitHub paths as repo IDs.
 */
export function normalizeRepo(repo: string): string {
	if (!repo) return "";
	const parts = repo.split("/");
	// Return the last part (the repository name itself)
	return parts[parts.length - 1].trim();
}

export function tokenize(text: string): string[] {
	return normalize(text)
		.split(" ")
		.filter((token) => token.length > 0 && !STOPWORDS.has(token));
}
