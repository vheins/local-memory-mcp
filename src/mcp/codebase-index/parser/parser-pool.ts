/**
 * ParserPool — manages the lifecycle of tree-sitter WASM parsers.
 *
 * Key design decisions:
 * - Lazy initialization: WASM loads on first parseFile call, not at module import.
 * - Sequential access: tree-sitter parsers are NOT reentrant, so we use a simple
 *   promise-based mutex to serialize parse operations.
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

// ── Mutex ────────────────────────────────────────────────────────────

/**
 * Simple promise-based mutex for serializing parser access.
 * tree-sitter Parser is NOT reentrant — concurrent parse calls corrupt state.
 */
class Mutex {
	private _locked = false;
	private _queue: Array<() => void> = [];

	async lock(): Promise<void> {
		if (!this._locked) {
			this._locked = true;
			return;
		}
		return new Promise<void>((resolve) => {
			this._queue.push(resolve);
		});
	}

	unlock(): void {
		if (this._queue.length > 0) {
			const next = this._queue.shift()!;
			next();
		} else {
			this._locked = false;
		}
	}
}

// ── Pool options ─────────────────────────────────────────────────────

export interface ParserPoolOptions {
	/** Maximum time per file parse in milliseconds (default: 10_000). */
	parseTimeoutMs?: number;
}

// ── Implementation ───────────────────────────────────────────────────

const DEFAULT_PARSE_TIMEOUT_MS = 10_000;

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
	private mutex = new Mutex();
	private parseTimeoutMs: number;

	// Loaded languages
	private tsLanguage: Language | null = null;
	private tsxLanguage: Language | null = null;

	constructor(options: ParserPoolOptions = {}) {
		this.parseTimeoutMs = options.parseTimeoutMs ?? DEFAULT_PARSE_TIMEOUT_MS;
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

		// Serialize parser access
		await this.mutex.lock();

		try {
			return await this._parseWithTimeout(filePath, sourceCode, startTime);
		} finally {
			this.mutex.unlock();
		}
	}

	// ── Private methods ───────────────────────────────────────────

	private async _doInitialize(): Promise<void> {
		const wasmPath = getWasmPath();
		logger.debug("[ParserPool] Initializing web-tree-sitter", { wasmPath });

		await Parser.init({
			locateFile(): string {
				return wasmPath;
			}
		});

		// Load grammars
		const tsWasmPath = getTypescriptGrammarPath();
		const tsxWasmPath = getTsxGrammarPath();

		this.tsLanguage = await Language.load(tsWasmPath);
		this.tsxLanguage = await Language.load(tsxWasmPath);

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
