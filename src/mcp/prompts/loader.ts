import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import matter from "gray-matter";
import type { LoadedPrompt } from "../interfaces";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findPromptDir(): string {
	const candidates = [
		// Production: /dist/prompts (sibling of dist/mcp/)
		["../../prompts", "../../prompts"],
		// Dev: /src/mcp/prompts/definitions (next to loader.ts)
		["./definitions", "./definitions"]
	]
		.map(([prod, dev]) => {
			// Try production path first
			const prodPath = path.resolve(__dirname, prod);
			if (fs.existsSync(prodPath) && fs.readdirSync(prodPath).some((f) => f.endsWith(".md"))) {
				return prodPath;
			}
			// Then try dev path
			const devPath = path.resolve(__dirname, dev);
			if (fs.existsSync(devPath) && fs.readdirSync(devPath).some((f) => f.endsWith(".md"))) {
				return devPath;
			}
			return null;
		})
		.filter(Boolean);

	if (candidates[0]) {
		return candidates[0]!;
	}

	// Final fallback
	return path.resolve(__dirname, "./definitions");
}

const PROMPT_DIR = findPromptDir();

export function listPromptFiles(): string[] {
	if (!fs.existsSync(PROMPT_DIR)) return [];
	return fs
		.readdirSync(PROMPT_DIR)
		.filter((file) => file.endsWith(".md"))
		.map((file) => file.replace(/\.md$/, ""))
		.sort();
}

export function loadPromptFromMarkdown(name: string): LoadedPrompt {
	const filePath = path.join(PROMPT_DIR, `${name}.md`);
	if (!fs.existsSync(filePath)) {
		throw new Error(`Prompt file not found: ${filePath}`);
	}
	const fileContent = fs.readFileSync(filePath, "utf-8");
	const { data, content } = matter(fileContent);

	return {
		name: data.name || name,
		description: data.description || "",
		arguments: data.arguments || [],
		agent: data.agent,
		content: content.trim()
	};
}
