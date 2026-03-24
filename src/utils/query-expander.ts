import { tokenize, normalize } from "./normalize.js";

const KEYWORD_EXPANSION: Record<string, string[]> = {
  database: ["sql", "orm", "query", "migration", "schema", "postgresql", "mysql"],
  auth: ["authentication", "login", "password", "jwt", "token", "session", "oauth"],
  login: ["auth", "authentication", "password", "jwt", "session", "credential"],
  api: ["rest", "endpoint", "controller", "route", "request", "response"],
  test: ["testing", "unit", "integration", "vitest", "jest", "mock"],
  model: ["entity", "schema", "relation", "eloquent", "migration"],
  frontend: ["ui", "react", "vue", "component", "tailwind", "css"],
  backend: ["server", "api", "controller", "service", "database"],
  security: ["encryption", "hash", "csrf", "xss", "sanitize", "validation"],
  performance: ["cache", "optimization", "index", "query", "lazy", "eager"],
  deployment: ["docker", "nginx", "ci", "cd", "pipeline", "deploy"],
};

function expandKeyword(keyword: string): string[] {
  const normalized = normalize(keyword).toLowerCase();
  return KEYWORD_EXPANSION[normalized] || [];
}

function extractIntentKeywords(prompt: string): string[] {
  const tokens = tokenize(prompt);
  
  const important = tokens.filter((t) => {
    if (t.length < 3) return false;
    const stopWords = [
      "need", "want", "how", "what", "when", "where", "why",
      "using", "with", "implement", "create", "build", "make",
      "have", "get", "find", "look", "search", "trying",
    ];
    return !stopWords.includes(t);
  });

  const expanded: string[] = [];
  for (const token of important) {
    expanded.push(token);
    const expansions = expandKeyword(token);
    expanded.push(...expansions);
  }

  return [...new Set(expanded)];
}

export function expandQuery(query: string, prompt?: string): string {
  const normalizedQuery = normalize(query);
  const queryTokens = normalizedQuery.split(/\s+/).filter((t) => t.length > 0);

  if (!prompt) {
    return queryTokens.join(" ");
  }

  const intentKeywords = extractIntentKeywords(prompt);

  const combined = new Set<string>([...queryTokens, ...intentKeywords]);

  const result = Array.from(combined).slice(0, 10).join(" ");

  return result.length > 3 ? result : queryTokens.join(" ");
}
