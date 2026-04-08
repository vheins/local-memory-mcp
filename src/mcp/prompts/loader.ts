import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import matter from "gray-matter";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROMPT_DIR = path.join(__dirname, "definitions");

export interface LoadedPrompt {
  name: string;
  description: string;
  arguments: any[];
  content: string;
  agent?: string;
}

export function listPromptFiles(): string[] {
  if (!fs.existsSync(PROMPT_DIR)) return [];
  return fs.readdirSync(PROMPT_DIR)
    .filter(file => file.endsWith(".md"))
    .map(file => file.replace(/\.md$/, ""));
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
