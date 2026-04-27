import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import matter from "gray-matter";
import type { LoadedPrompt } from "../interfaces";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findPromptDir(): string {
	const candidates = [
		// Production if chunked into dist/
		"./prompts",
		// Production if inlined into dist/mcp/
		"../prompts",
		// Dev: /src/mcp/prompts/definitions (next to loader.ts)
		"./definitions"
	].map((relPath) => path.resolve(__dirname, relPath));

	for (const dir of candidates) {
		if (fs.existsSync(dir)) {
			const files = fs.readdirSync(dir);
			if (files.some((f) => f.endsWith(".md"))) {
				return dir;
			}
		}
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

function findServerInstructionsDir(): string {
	const candidates = [
		// Production if chunked into dist/
		"./prompts/server",
		// Production if inlined into dist/mcp/
		"../prompts/server",
		// Dev: /src/mcp/prompts/server (next to loader.ts)
		"./server"
	].map((relPath) => path.resolve(__dirname, relPath));

	for (const dir of candidates) {
		if (fs.existsSync(dir)) {
			const filePath = path.join(dir, "instructions.md");
			if (fs.existsSync(filePath)) {
				return dir;
			}
		}
	}

	// Final fallback
	return path.resolve(__dirname, "./server");
}

const SERVER_DIR = findServerInstructionsDir();

export function loadServerInstructions(): string {
	const filePath = path.join(SERVER_DIR, "instructions.md");
	if (!fs.existsSync(filePath)) {
		throw new Error(`Server instructions file not found: ${filePath}`);
	}
	const fileContent = fs.readFileSync(filePath, "utf-8");
	const { content } = matter(fileContent);
	return content.trim();
}
