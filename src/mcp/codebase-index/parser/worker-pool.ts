/**
 * Worker pool — concurrency limiter and configuration for tree-sitter parsing.
 *
 * tree-sitter Parser is NOT reentrant, so each concurrent slot creates its own
 * Parser instance while sharing the Language objects loaded once at init.
 */

// ── Defaults ──────────────────────────────────────────────────────────

/** Default maximum time per file parse in milliseconds. */
export const DEFAULT_PARSE_TIMEOUT_MS = 10_000;

/** Default number of concurrent parse operations. */
export const DEFAULT_CONCURRENCY = 4;

// ── Configuration resolution ──────────────────────────────────────────

/** Read the parse timeout from environment, falling back to the programmatic default. */
export function resolveParseTimeoutMs(override?: number): number {
	if (override !== undefined) return override;
	const env = parseInt(process.env.CODEBASE_INDEX_PARSE_TIMEOUT_MS ?? "", 10);
	if (!isNaN(env) && env > 0) return env;
	return DEFAULT_PARSE_TIMEOUT_MS;
}

/** Read concurrency from environment, falling back to the programmatic default. */
export function resolveConcurrency(override?: number): number {
	if (override !== undefined && override > 0) return override;
	const env = parseInt(process.env.CODEBASE_INDEX_PARSE_CONCURRENCY ?? "", 10);
	if (!isNaN(env) && env > 0) return env;
	return DEFAULT_CONCURRENCY;
}

// ── Semaphore ─────────────────────────────────────────────────────────

/**
 * Simple promise-based semaphore for limiting concurrent parser access.
 * tree-sitter Parser is NOT reentrant, so each concurrent slot creates its
 * own Parser instance while sharing the Language objects loaded once at init.
 */
export class Semaphore {
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
