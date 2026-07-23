/**
 * ParserPool — manages the lifecycle of tree-sitter WASM parsers for multiple
 * languages.
 *
 * Architecture (v2):
 * - Language registry: declarative config per language (extensions, WASM paths,
 *   visitor factory). Adding a new language = adding one entry to createRegistry().
 * - Reverse maps: extension → config (O(1) lookup), grammar path → loaded Language.
 * - All grammars are loaded eagerly during _doInitialize().
 * - _doParse() looks up the config by file extension, finds the loaded grammar,
 *   instantiates the visitor, and calls extractSymbols(tree, sourceCode).
 *
 * Key design decisions:
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
import type { ParseResult, ParserPool, LanguageVisitor } from "./language-visitor.js";
import { TypeScriptVisitor } from "./typescript-visitor.js";
import { GoVisitor } from "./visitors/go-visitor.js";
import { PythonVisitor } from "./visitors/python-visitor.js";
import { PhpVisitor } from "./visitors/php-visitor.js";
import { DartVisitor } from "./visitors/dart-visitor.js";
import { RustVisitor } from "./visitors/rust-visitor.js";
import { JavaVisitor } from "./visitors/java-visitor.js";
import { RubyVisitor } from "./visitors/ruby-visitor.js";
import { KotlinVisitor } from "./visitors/kotlin-visitor.js";
import { SwiftVisitor } from "./visitors/swift-visitor.js";
import { CVisitor } from "./visitors/c-visitor.js";
import { CppVisitor } from "./visitors/cpp-visitor.js";
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

/**
 * Resolve a tree-sitter grammar WASM file path.
 * Searches: {packageDir}/{wasmFilename}, then {packageDir}/wasm/{wasmFilename}.
 */
function getGrammarPath(packageName: string, wasmFilename: string): string {
	const root = resolveProjectRoot();
	const pkgDir = path.join(root, "node_modules", packageName);
	const directPath = path.join(pkgDir, wasmFilename);
	if (fs.existsSync(directPath)) return directPath;

	const altPath = path.join(pkgDir, "wasm", wasmFilename);
	if (fs.existsSync(altPath)) return altPath;

	throw new Error(`Grammar WASM not found: ${wasmFilename} in ${pkgDir}`);
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

// ── Language config ──────────────────────────────────────────────────

interface LanguageConfig {
	/** Unique identifier for this language entry (e.g. "typescript", "go"). */
	languageId: string;
	/** File extensions this config handles. */
	extensions: string[];
	/** WASM grammar file paths (some languages need multiple, e.g. TS + TSX). */
	grammarWasms: string[];
	/** Factory function to create a new visitor instance. */
	createVisitor: () => LanguageVisitor;
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

export class TreeSitterParserPool implements ParserPool {
	private initialized = false;
	private initPromise: Promise<void> | null = null;
	private initError: Error | null = null;
	private semaphore: Semaphore;
	private parseTimeoutMs: number;

	// Grammar cache: WASM file path → loaded Language
	private loadedGrammars = new Map<string, Language>();

	// Cached registry built once at construction time
	private readonly registry: LanguageConfig[] = TreeSitterParserPool.createRegistry();

	// Reverse maps
	private extToConfig = new Map<string, LanguageConfig>();

	constructor(options: ParserPoolOptions = {}) {
		this.parseTimeoutMs = resolveParseTimeoutMs(options.parseTimeoutMs);
		this.semaphore = new Semaphore(resolveConcurrency(options.concurrency));
		this.buildRegistryMaps();
	}

	// ── Registry construction ─────────────────────────────────────

	private static createRegistry(): LanguageConfig[] {
		const tsGrammar = getGrammarPath("tree-sitter-typescript", "tree-sitter-typescript.wasm");
		const tsxGrammar = getGrammarPath("tree-sitter-typescript", "tree-sitter-tsx.wasm");

		return [
			{
				languageId: "typescript",
				extensions: [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"],
				grammarWasms: [tsGrammar],
				createVisitor: () => new TypeScriptVisitor()
			},
			{
				languageId: "tsx",
				extensions: [".tsx", ".jsx"],
				grammarWasms: [tsxGrammar],
				createVisitor: () => new TypeScriptVisitor()
			},
			{
				languageId: "go",
				extensions: [".go"],
				grammarWasms: [getGrammarPath("tree-sitter-go", "tree-sitter-go.wasm")],
				createVisitor: () => new GoVisitor()
			},
			{
				languageId: "python",
				extensions: [".py"],
				grammarWasms: [getGrammarPath("tree-sitter-python", "tree-sitter-python.wasm")],
				createVisitor: () => new PythonVisitor()
			},
			{
				languageId: "php",
				extensions: [".php"],
				grammarWasms: [getGrammarPath("tree-sitter-php", "tree-sitter-php_only.wasm")],
				createVisitor: () => new PhpVisitor()
			},
			{
				languageId: "dart",
				extensions: [".dart"],
				grammarWasms: [getGrammarPath("tree-sitter-dart", "tree-sitter-dart.wasm")],
				createVisitor: () => new DartVisitor()
			},
			{
				languageId: "rust",
				extensions: [".rs"],
				grammarWasms: [getGrammarPath("tree-sitter-rust", "tree-sitter-rust.wasm")],
				createVisitor: () => new RustVisitor()
			},
			{
				languageId: "java",
				extensions: [".java"],
				grammarWasms: [getGrammarPath("tree-sitter-java", "tree-sitter-java.wasm")],
				createVisitor: () => new JavaVisitor()
			},
			{
				languageId: "ruby",
				extensions: [".rb"],
				grammarWasms: [getGrammarPath("tree-sitter-ruby", "tree-sitter-ruby.wasm")],
				createVisitor: () => new RubyVisitor()
			},
			{
				languageId: "kotlin",
				extensions: [".kt", ".kts"],
				grammarWasms: [getGrammarPath("tree-sitter-kotlin", "tree-sitter-kotlin.wasm")],
				createVisitor: () => new KotlinVisitor()
			},
			{
				languageId: "swift",
				extensions: [".swift"],
				grammarWasms: [getGrammarPath("tree-sitter-swift", "tree-sitter-swift.wasm")],
				createVisitor: () => new SwiftVisitor()
			},
			{
				languageId: "c",
				extensions: [".c", ".h"],
				grammarWasms: [getGrammarPath("tree-sitter-c", "tree-sitter-c.wasm")],
				createVisitor: () => new CVisitor()
			},
			{
				languageId: "cpp",
				extensions: [".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx"],
				grammarWasms: [getGrammarPath("tree-sitter-cpp", "tree-sitter-cpp.wasm")],
				createVisitor: () => new CppVisitor()
			}
		];
	}

	/** Build the O(1) extension → config and languageId → visitor factory maps. */
	private buildRegistryMaps(): void {
		for (const config of this.registry) {
			for (const ext of config.extensions) {
				if (this.extToConfig.has(ext)) {
					logger.warn(`[ParserPool] Duplicate extension mapping: ${ext}`);
				}
				this.extToConfig.set(ext, config);
			}
		}
	}

	/**
	 * Remove all extension → config mappings that reference a failed WASM path.
	 * Called when a grammar fails to load — prevents runtime errors on parse.
	 */
	private removeConfigsForWasm(wasmPath: string): void {
		for (const [ext, config] of this.extToConfig.entries()) {
			if (config.grammarWasms.includes(wasmPath)) {
				this.extToConfig.delete(ext);
			}
		}
	}

	// ── ParserPool contract ───────────────────────────────────────

	isInitialized(): boolean {
		return this.initialized;
	}

	async initialize(): Promise<void> {
		if (this.initialized) return;
		if (this.initError) throw this.initError;

		if (this.initPromise) {
			return this.initPromise;
		}

		this.initPromise = this._doInitialize();
		try {
			await this.initPromise;
		} catch (err) {
			this.initError = err instanceof Error ? err : new Error(String(err));
			throw err;
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

		// Collect all unique WASM paths from the registry
		const uniqueWasms = new Set<string>();
		for (const config of this.registry) {
			for (const w of config.grammarWasms) {
				uniqueWasms.add(w);
			}
		}

		// Load all grammars in parallel (graceful degradation: skip incompatible WASMs)
		let loadedCount = 0;
		let skippedCount = 0;
		const results = await Promise.allSettled(
			Array.from(uniqueWasms).map(async (wasmPath) => {
				try {
					const lang = await Language.load(wasmPath);
					return { wasmPath, lang, ok: true as const };
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					return { wasmPath, error: message, ok: false as const };
				}
			})
		);

		for (const result of results) {
			if (result.status === "fulfilled" && result.value.ok) {
				this.loadedGrammars.set(result.value.wasmPath, result.value.lang);
				loadedCount++;
				logger.debug("[ParserPool] Grammar loaded", { wasmPath: result.value.wasmPath });
			} else {
				skippedCount++;
				const wasmPath = result.status === "fulfilled" ? result.value.wasmPath : "unknown";
				const message =
					result.status === "fulfilled"
						? result.value.error
						: result.reason instanceof Error
							? result.reason.message
							: String(result.reason);
				logger.warn("[ParserPool] Grammar load failed — skipping language", {
					wasmPath,
					error: message
				});
				// Remove configs that depend on this WASM from the extension map
				if (result.status === "fulfilled") {
					this.removeConfigsForWasm(result.value.wasmPath);
				}
			}
		}

		if (loadedCount === 0) {
			throw new FatalError("No grammars could be loaded. Check WASM compatibility.", {
				operation: "Language.load",
				attempted: Array.from(uniqueWasms)
			});
		}

		logger.info("[ParserPool] Tree-sitter initialized", {
			grammarCount: uniqueWasms.size,
			languageCount: this.registry.length
		});

		this.initialized = true;
	}

	private async _parseWithTimeout(filePath: string, sourceCode: string, startTime: number): Promise<ParseResult> {
		try {
			const result = this._doParse(filePath, sourceCode);
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
		const config = this.extToConfig.get(ext);

		if (!config) {
			return { symbols: [], error: `Unsupported extension: ${ext}`, durationMs: 0 };
		}

		// Find the grammar WASM that was loaded for this config
		// (pick the first one — works for single-grammar languages; for TS, both
		// TS and TSX grammars are loaded separately as distinct configs)
		const wasmPath = config.grammarWasms[0];
		if (!wasmPath) {
			return { symbols: [], error: `No grammar configured for: ${config.languageId}`, durationMs: 0 };
		}

		const language = this.loadedGrammars.get(wasmPath);
		if (!language) {
			return { symbols: [], error: `Language not loaded for: ${config.languageId}`, durationMs: 0 };
		}

		const parser = new Parser();
		parser.setLanguage(language);

		const parseStart = Date.now();
		const tree = parser.parse(sourceCode, null, {
			progressCallback: (): boolean => {
				return Date.now() - parseStart > this.parseTimeoutMs;
			}
		});
		if (!tree) {
			parser.delete();
			return {
				symbols: [],
				error: "Parse timeout or parser returned null tree",
				durationMs: 0
			};
		}

		const hasErrors = tree.rootNode.hasError;

		const visitor = config.createVisitor();
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
