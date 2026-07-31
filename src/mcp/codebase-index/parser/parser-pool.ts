/**
 * ParserPool — manages the lifecycle of tree-sitter WASM parsers for multiple
 * languages.
 *
 * Architecture (v2):
 * - Language registry lives in language-routing.ts (declarative config per
 *   language).
 * - Worker pool / concurrency control lives in worker-pool.ts.
 * - This file owns the TreeSitterParserPool class: lazy init, grammar caching,
 *   parse dispatch, and timeout enforcement.
 *
 * Key design decisions:
 * - Concurrent access: tree-sitter Parser is NOT reentrant, so we use a semaphore
 *   to limit concurrent parse operations. Each concurrent slot creates its own
 *   Parser instance, sharing the Language objects loaded once at init.
 * - Per-file timeout: each file parse has a configurable deadline (default 10s).
 * - Graceful degradation: parse errors are captured in ParseResult.error, never thrown.
 */

import { performance } from "node:perf_hooks";
import path from "node:path";
import { Parser, Language } from "web-tree-sitter";
import type { ParseResult, ParserPool } from "./language-visitor.js";
import {
	type LanguageConfig,
	getWasmPath,
	createRegistry,
	buildGenericCatchAll,
	buildRegistryMaps,
	removeConfigsForWasm
} from "./language-routing.js";
import { Semaphore, resolveParseTimeoutMs, resolveConcurrency } from "./worker-pool.js";
import { logger } from "../../utils/logger.js";
import { FatalError } from "../types/errors.js";

// ── Pool options ─────────────────────────────────────────────────────

export interface ParserPoolOptions {
	/** Maximum time per file parse in milliseconds (default: 10_000). */
	parseTimeoutMs?: number;
	/** Number of concurrent parse operations (default: 4). Each slot gets its own Parser instance. */
	concurrency?: number;
}

// ── Implementation ───────────────────────────────────────────────────

export class TreeSitterParserPool implements ParserPool {
	private initialized = false;
	private initPromise: Promise<void> | null = null;
	private initError: Error | null = null;
	private semaphore: Semaphore;
	private parseTimeoutMs: number;

	// Grammar cache: WASM file path → loaded Language
	private loadedGrammars = new Map<string, Language>();

	// Cached registry built once at construction time
	private registry: LanguageConfig[] = createRegistry();

	// Reverse maps
	private extToConfig = new Map<string, LanguageConfig>();
	/** Fallback map for extensionless files (keyed by lowercase basename). */
	private basenameToConfig = new Map<string, LanguageConfig>();

	constructor(options: ParserPoolOptions = {}) {
		this.parseTimeoutMs = resolveParseTimeoutMs(options.parseTimeoutMs);
		this.semaphore = new Semaphore(resolveConcurrency(options.concurrency));
		// Append the generic catch-all for any extension not handled by a tree-sitter grammar
		this.registry.push(buildGenericCatchAll(this.registry));
		const maps = buildRegistryMaps(this.registry);
		this.extToConfig = maps.extToConfig;
		this.basenameToConfig = maps.basenameToConfig;
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

		logger.debug("[ParserPool] WASM initialized, grammars will be loaded lazily");

		this.initialized = true;
	}

	/**
	 * Lazy-load a tree-sitter grammar WASM on first use.
	 * Subsequent calls for the same WASM path return the cached Language.
	 */
	private async getOrLoadGrammar(wasmPath: string): Promise<Language> {
		const existing = this.loadedGrammars.get(wasmPath);
		if (existing) return existing;

		try {
			const lang = await Language.load(wasmPath);
			this.loadedGrammars.set(wasmPath, lang);
			logger.debug("[ParserPool] Grammar loaded", { wasmPath });
			return lang;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			logger.warn("[ParserPool] Grammar load failed — skipping language", { wasmPath, error: message });
			removeConfigsForWasm(this.extToConfig, wasmPath);
			throw new Error(`Failed to load grammar: ${wasmPath} — ${message}`, { cause: err });
		}
	}

	private async _parseWithTimeout(filePath: string, sourceCode: string, startTime: number): Promise<ParseResult> {
		try {
			const result = await this._doParse(filePath, sourceCode);
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

	private async _doParse(filePath: string, sourceCode: string): Promise<ParseResult> {
		const ext = path.extname(filePath).toLowerCase();
		let config = this.extToConfig.get(ext);

		// Fallback: extensionless files (Dockerfile, Makefile, Justfile, Containerfile)
		if (!config && ext === "") {
			const basename = path.basename(filePath).toLowerCase();
			config = this.basenameToConfig.get(basename);
		}

		if (!config) {
			return { symbols: [], error: `Unsupported extension: ${ext || "(none)"}`, durationMs: 0 };
		}

		// Non-tree-sitter visitors: no grammar wasm needed, create visitor directly
		if (config.grammarWasms.length === 0) {
			const visitor = config.createVisitor();
			const symbols = visitor.extractSymbols(null, sourceCode);
			return { symbols, error: null, durationMs: 0 };
		}

		// Find the grammar WASM for this config
		// (pick the first one — works for single-grammar languages; for TS, both
		// TS and TSX grammars are loaded separately as distinct configs)
		const wasmPath = config.grammarWasms[0];
		if (!wasmPath) {
			return { symbols: [], error: `No grammar configured for: ${config.languageId}`, durationMs: 0 };
		}

		// Lazy-load the grammar on first use
		let language: Language;
		try {
			language = await this.getOrLoadGrammar(wasmPath);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			// Error already logged (warn) by getOrLoadGrammar — this catch
			// converts the thrown error into the graceful per-file fallback.
			logger.debug("[ParserPool] Grammar unavailable — graceful fallback", { filePath, error: message });
			return { symbols: [], error: message, durationMs: 0 };
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
