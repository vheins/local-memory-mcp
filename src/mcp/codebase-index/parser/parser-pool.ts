/**
 * ParserPool — manages the lifecycle of tree-sitter WASM parsers.
 *
 * Key design decisions:
 * - Lazy initialization: WASM loads on first parseFile call, not at module import.
 * - Concurrent access: tree-sitter Parser is NOT reentrant, so we use a semaphore
 *   to limit concurrent parse operations. Each concurrent slot creates its own
 *   Parser instance, sharing the Language objects loaded once at init.
 * - Per-file timeout: each file parse has a configurable deadline (default 10s).
 * - Graceful degradation: parse errors are captured in ParseResult.error, never thrown.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { Parser, Language } from "web-tree-sitter";
import type { Tree, Node } from "web-tree-sitter";
import type { ParseResult, ParserPool } from "./language-visitor.js";
import { TypeScriptVisitor } from "./typescript-visitor.js";
import { logger } from "../../utils/logger.js";
import { FatalError } from "../types/errors.js";

// ── Path resolution ──────────────────────────────────────────────────

/** Resolve the project root at runtime (handles both tsx and compiled contexts). */
function resolveProjectRoot(): string {
	const moduleDir = path.dirname(fileURLToPath(import.meta.url));
	let dir = moduleDir;
	while (dir !== path.parse(dir).root) {
		if (fs.existsSync(path.join(dir, "node_modules"))) {
			return dir;
		}
		dir = path.dirname(dir);
	}
	throw new Error("Cannot locate project root (node_modules not found)");
}

/** Path to the web-tree-sitter WASM file. */
function getWasmPath(): string {
	const root = resolveProjectRoot();
	return path.join(root, "node_modules", "web-tree-sitter", "web-tree-sitter.wasm");
}

/** Path to tree-sitter-typescript WASM file. */
function getTypescriptGrammarPath(): string {
	const root = resolveProjectRoot();
	const tsDir = path.join(root, "node_modules", "tree-sitter-typescript");
	const directWasm = path.join(tsDir, "tree-sitter-typescript.wasm");
	if (fs.existsSync(directWasm)) return directWasm;
	throw new Error(`TypeScript grammar WASM not found in ${tsDir}`);
}

/** Path to tree-sitter-tsx WASM file. */
function getTsxGrammarPath(): string {
	const root = resolveProjectRoot();
	const tsxWasm = path.join(root, "node_modules", "tree-sitter-typescript", "tree-sitter-tsx.wasm");
	if (fs.existsSync(tsxWasm)) return tsxWasm;
	throw new Error(`TSX grammar WASM not found`);
}

// ── Semaphore ────────────────────────────────────────────────────────

/**
 * Simple promise-based semaphore for limiting concurrent parser access.
 * tree-sitter Parser is NOT reentrant, so each concurrent slot creates its
 * own Parser instance while sharing the Language objects loaded once at init.
 */
class Semaphore {
	private _count: number;
	private _queue: Array<() => void> = [];

	constructor(concurrency: number) {
		this._count = concurrency;
	}

	async acquire(): Promise<void> {
		if (this._count > 0) {
			this._count--;
			return;
		}
		return new Promise<void>((resolve) => {
			this._queue.push(resolve);
		});
	}

	release(): void {
		if (this._queue.length > 0) {
			const next = this._queue.shift()!;
			next();
		} else {
			this._count++;
		}
	}
}

// ── Pool options ─────────────────────────────────────────────────────

export interface ParserPoolOptions {
	/** Maximum time per file parse in milliseconds (default: 10_000). */
	parseTimeoutMs?: number;
	/** Number of concurrent parse operations (default: 4). Each slot gets its own Parser instance. */
	concurrency?: number;
}

// ── Implementation ───────────────────────────────────────────────────

const DEFAULT_PARSE_TIMEOUT_MS = 10_000;
const DEFAULT_CONCURRENCY = 4;

/** Read the parse timeout from environment, falling back to the programmatic default. */
function resolveParseTimeoutMs(override?: number): number {
	if (override !== undefined) return override;
	const env = parseInt(process.env.CODEBASE_INDEX_PARSE_TIMEOUT_MS ?? "", 10);
	if (!isNaN(env) && env > 0) return env;
	return DEFAULT_PARSE_TIMEOUT_MS;
}

/** Read concurrency from environment, falling back to the programmatic default. */
function resolveConcurrency(override?: number): number {
	if (override !== undefined && override > 0) return override;
	const env = parseInt(process.env.CODEBASE_INDEX_PARSE_CONCURRENCY ?? "", 10);
	if (!isNaN(env) && env > 0) return env;
	return DEFAULT_CONCURRENCY;
}

/** Maps file extensions to the appropriate tree-sitter language. */
const EXTENSION_LANGUAGE_MAP: Record<string, "typescript" | "tsx"> = {
	".ts": "typescript",
	".tsx": "tsx",
	".mts": "typescript",
	".cts": "typescript",
	".js": "typescript",
	".jsx": "tsx",
	".mjs": "typescript",
	".cjs": "typescript"
};

export class TreeSitterParserPool implements ParserPool {
	private initialized = false;
	private initPromise: Promise<void> | null = null;
	private semaphore: Semaphore;
	private parseTimeoutMs: number;

	// Loaded languages
	private tsLanguage: Language | null = null;
	private tsxLanguage: Language | null = null;

	constructor(options: ParserPoolOptions = {}) {
		this.parseTimeoutMs = resolveParseTimeoutMs(options.parseTimeoutMs);
		this.semaphore = new Semaphore(resolveConcurrency(options.concurrency));
	}

	// ── ParserPool contract ───────────────────────────────────────

	isInitialized(): boolean {
		return this.initialized;
	}

	async initialize(): Promise<void> {
		if (this.initialized) return;

		if (this.initPromise) {
			return this.initPromise;
		}

		this.initPromise = this._doInitialize();
		try {
			await this.initPromise;
		} finally {
			this.initPromise = null;
		}
	}

	async parseFile(filePath: string, sourceCode: string): Promise<ParseResult> {
		const startTime = performance.now();

		// Lazy-init on first call
		await this.initialize();

		// Acquire a concurrency slot
		await this.semaphore.acquire();

		try {
			return await this._parseWithTimeout(filePath, sourceCode, startTime);
		} finally {
			this.semaphore.release();
		}
	}

	// ── Private methods ───────────────────────────────────────────

	private async _doInitialize(): Promise<void> {
		const wasmPath = getWasmPath();
		logger.debug("[ParserPool] Initializing web-tree-sitter", { wasmPath });

		try {
			await Parser.init({
				locateFile(): string {
					return wasmPath;
				}
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			logger.error("[ParserPool] WASM init failed", { wasmPath, error: message });
			throw new FatalError(`WASM initialization failed: ${message}`, {
				operation: "Parser.init",
				wasmPath
			});
		}

		// Load grammars
		const tsWasmPath = getTypescriptGrammarPath();
		const tsxWasmPath = getTsxGrammarPath();

		try {
			this.tsLanguage = await Language.load(tsWasmPath);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			logger.error("[ParserPool] TypeScript grammar load failed", { tsWasmPath, error: message });
			throw new FatalError(`Failed to load TypeScript grammar: ${message}`, {
				operation: "Language.load",
				path: tsWasmPath
			});
		}

		try {
			this.tsxLanguage = await Language.load(tsxWasmPath);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			logger.error("[ParserPool] TSX grammar load failed", { tsxWasmPath, error: message });
			throw new FatalError(`Failed to load TSX grammar: ${message}`, {
				operation: "Language.load",
				path: tsxWasmPath
			});
		}

		logger.info("[ParserPool] Tree-sitter initialized", {
			tsVersion: this.tsLanguage.metadata
				? `${this.tsLanguage.metadata.major_version}.${this.tsLanguage.metadata.minor_version}.${this.tsLanguage.metadata.patch_version}`
				: "unknown",
			abiVersion: this.tsLanguage.abiVersion
		});

		this.initialized = true;
	}

	private async _parseWithTimeout(filePath: string, sourceCode: string, startTime: number): Promise<ParseResult> {
		try {
			const result = await Promise.race([
				this._doParse(filePath, sourceCode),
				new Promise<ParseResult>((_, reject) => {
					setTimeout(() => {
						reject(new Error(`Parse timeout after ${this.parseTimeoutMs}ms for: ${filePath}`));
					}, this.parseTimeoutMs);
				})
			]);

			const durationMs = Math.round(performance.now() - startTime);
			result.durationMs = durationMs;
			return result;
		} catch (err) {
			const durationMs = Math.round(performance.now() - startTime);
			const message = err instanceof Error ? err.message : String(err);
			logger.warn("[ParserPool] Parse failed", { filePath, error: message, durationMs });
			return {
				symbols: [],
				error: message,
				durationMs
			};
		}
	}

	private _doParse(filePath: string, sourceCode: string): ParseResult {
		const ext = path.extname(filePath).toLowerCase();
		const langType = EXTENSION_LANGUAGE_MAP[ext];

		if (!langType) {
			return { symbols: [], error: `Unsupported extension: ${ext}`, durationMs: 0 };
		}

		const language = langType === "tsx" ? this.tsxLanguage : this.tsLanguage;
		if (!language) {
			return { symbols: [], error: `Language not loaded for: ${langType}`, durationMs: 0 };
		}

		const parser = new Parser();
		parser.setLanguage(language);

		const tree = parser.parse(sourceCode);
		if (!tree) {
			parser.delete();
			return { symbols: [], error: "Parser returned null tree", durationMs: 0 };
		}

		const hasErrors = tree.rootNode.hasError;

		const visitor = new TypeScriptVisitor();
		const symbols = visitor.extractSymbols(tree, sourceCode);

		tree.delete();
		parser.delete();

		return {
			symbols,
			error: hasErrors ? "Parse errors detected (partial results returned)" : null,
			durationMs: 0
		};
	}
}
