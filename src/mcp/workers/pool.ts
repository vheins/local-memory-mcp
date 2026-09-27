/**
 * Generic bounded worker_threads pool.
 *
 * A small, framework-agnostic pool over `node:worker_threads` that runs a
 * caller-supplied worker script across a bounded number of OS threads. It owns
 * a FIFO task queue, structured-clone request/response plumbing, a per-task
 * timeout, crash detection with automatic respawn, and graceful shutdown.
 *
 * Design goals (FEAT-DAEMON-002B):
 *   - NEVER wedge the caller: every accepted task settles exactly once, either
 *     with a result or a typed error (timeout / crash / worker error / closed).
 *   - Crash-resilient: an unexpected worker exit rejects the in-flight task
 *     with a RETRYABLE error and respawns a replacement worker; queued work
 *     keeps draining.
 *   - Observable: `metrics()` exposes active / idle / queued counts.
 *
 * Sizing precedence:
 *   1. explicit `size` option (when > 0)
 *   2. `WORKER_POOL_SIZE` env (see constants.ts, default 2)
 *   3. clamped to `[1, os.availableParallelism()]`
 *
 * The pool is transport-only: it makes no assumptions about the worker script
 * beyond the message protocol below. Callers wire concrete workers (indexer /
 * embedding) in a later subtask.
 *
 * Message protocol (both directions are structured-cloned):
 *   main  → worker : { id: number, payload: Req }
 *   worker → main  : { id: number, ok: true,  result: Res }
 *                  | { id: number, ok: false, error: { message, name?, stack? } }
 */

import { Worker, type Transferable, type WorkerOptions } from "node:worker_threads";
import { availableParallelism } from "node:os";
import { WORKER_POOL_SIZE } from "../utils/constants";

// ── Defaults (module-local; only WORKER_POOL_SIZE is a shared constant) ──

/** Default per-task wall-clock ceiling. `0` disables the timeout. */
export const DEFAULT_WORKER_TASK_TIMEOUT_MS = 30_000;

// ── Errors ───────────────────────────────────────────────────────────────

/**
 * Base error for every pool failure. `retryable` is an advisory hint for the
 * caller: a transient failure (crash / timeout) MAY be retried, an application
 * error surfaced by the worker or a closed pool should not be.
 */
export class WorkerPoolError extends Error {
	readonly retryable: boolean;
	readonly workerStack?: string;

	constructor(message: string, retryable = false, workerStack?: string) {
		super(message);
		this.name = "WorkerPoolError";
		this.retryable = retryable;
		this.workerStack = workerStack;
	}
}

/** The pool is shutting down or has shut down and refuses new tasks. */
export class WorkerPoolClosedError extends WorkerPoolError {
	constructor(message = "worker pool is closed") {
		super(message, false);
		this.name = "WorkerPoolClosedError";
	}
}

/** A task exceeded its per-task timeout. Retryable (may be transient load). */
export class WorkerTaskTimeoutError extends WorkerPoolError {
	constructor(message: string) {
		super(message, true);
		this.name = "WorkerTaskTimeoutError";
	}
}

/** A worker exited unexpectedly mid-task. Retryable (the pool respawns). */
export class WorkerTaskCrashError extends WorkerPoolError {
	constructor(message: string) {
		super(message, true);
		this.name = "WorkerTaskCrashError";
	}
}

/** The worker replied with an application-level error. Not retryable. */
export class WorkerTaskError extends WorkerPoolError {
	constructor(message: string, workerStack?: string) {
		super(message, false, workerStack);
		this.name = "WorkerTaskError";
	}
}

// ── Public types ─────────────────────────────────────────────────────────

export interface WorkerPoolOptions {
	/** Absolute path or file URL of the worker entry script. */
	workerPath: string | URL;
	/** Explicit pool size; overrides `WORKER_POOL_SIZE`. Clamped to the core cap. */
	size?: number;
	/** Default per-task timeout in ms (`0` disables). Defaults to 30s. */
	taskTimeoutMs?: number;
	/** Options forwarded to every `new Worker(...)` (e.g. resourceLimits). */
	workerOptions?: WorkerOptions;
}

export interface WorkerPoolRunOptions {
	/** Per-task timeout override in ms (`0` disables). */
	timeoutMs?: number;
	/** Transferable objects to move (not clone) with the request. */
	transferList?: readonly Transferable[];
}

export interface WorkerPoolMetrics {
	/** Resolved pool size (bounded worker count). */
	size: number;
	/** Workers currently executing a task. */
	active: number;
	/** Idle workers available for dispatch. */
	idle: number;
	/** Tasks waiting in the queue (not yet dispatched). */
	queued: number;
}

export interface WorkerPoolCloseOptions {
	/**
	 * `"drain"` (default): let queued + in-flight tasks finish, then stop.
	 * `"cancel"`: reject every queued task immediately; in-flight tasks finish.
	 */
	mode?: "drain" | "cancel";
}

// ── Internal types ───────────────────────────────────────────────────────

interface PendingTask {
	id: number;
	payload: unknown;
	transferList?: readonly Transferable[];
	timeoutMs: number;
	settled: boolean;
	timer?: NodeJS.Timeout;
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
}

interface WorkerErrorPayload {
	message?: string;
	name?: string;
	stack?: string;
}

type WorkerResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error?: WorkerErrorPayload };

// ── Size resolution ──────────────────────────────────────────────────────

/**
 * Clamp a requested worker count to `[1, os.availableParallelism()]`.
 * Exported for direct testing.
 */
export function clampPoolSize(requested: number): number {
	const cap = Math.max(1, availableParallelism());
	const floor = Math.max(1, Math.floor(requested));
	return Math.min(floor, cap);
}

/**
 * Resolve the pool size with the documented precedence:
 * explicit override (> 0) > `WORKER_POOL_SIZE` env (default 2) > core cap.
 * Exported for direct testing.
 */
export function resolvePoolSize(override?: number): number {
	const requested = override !== undefined && override > 0 ? override : WORKER_POOL_SIZE;
	return clampPoolSize(requested);
}

// ── Pool ─────────────────────────────────────────────────────────────────

export class WorkerPool {
	private readonly workerPath: string | URL;
	private readonly workerOptions: WorkerOptions | undefined;
	private readonly defaultTimeoutMs: number;
	private readonly size: number;

	private readonly workers: Worker[] = [];
	private readonly idle: Worker[] = [];
	private readonly busy = new Map<Worker, PendingTask>();
	private readonly queue: PendingTask[] = [];
	private readonly workerErrors = new Map<Worker, Error>();

	private nextId = 0;
	private closing = false;
	private closed = false;
	private closePromise?: Promise<void>;
	private closeResolve?: () => void;

	constructor(options: WorkerPoolOptions) {
		this.workerPath = options.workerPath;
		this.workerOptions = options.workerOptions;
		this.defaultTimeoutMs = options.taskTimeoutMs ?? DEFAULT_WORKER_TASK_TIMEOUT_MS;
		this.size = resolvePoolSize(options.size);
		for (let i = 0; i < this.size; i++) this.spawnWorker();
	}

	/** Resolved, core-capped worker count. */
	get poolSize(): number {
		return this.size;
	}

	/** Enqueue a task. Rejects immediately if the pool is closing/closed. */
	run<Req, Res>(payload: Req, options?: WorkerPoolRunOptions): Promise<Res> {
		if (this.closing || this.closed) {
			return Promise.reject(new WorkerPoolClosedError());
		}
		return new Promise<Res>((resolve, reject) => {
			const task: PendingTask = {
				id: ++this.nextId,
				payload,
				transferList: options?.transferList,
				timeoutMs: options?.timeoutMs ?? this.defaultTimeoutMs,
				settled: false,
				resolve: resolve as (value: unknown) => void,
				reject
			};
			this.queue.push(task);
			this.dispatch();
		});
	}

	/** Current pool counters. */
	metrics(): WorkerPoolMetrics {
		return {
			size: this.size,
			active: this.busy.size,
			idle: this.idle.length,
			queued: this.queue.length
		};
	}

	/**
	 * Gracefully stop the pool. Resolves once every worker is terminated.
	 * Idempotent: repeated calls return the same promise.
	 */
	close(options?: WorkerPoolCloseOptions): Promise<void> {
		if (this.closePromise) return this.closePromise;
		this.closing = true;

		if ((options?.mode ?? "drain") === "cancel") {
			const pending = this.queue.splice(0, this.queue.length);
			for (const task of pending) {
				this.failTask(task, new WorkerPoolClosedError("pool closed before task started"));
			}
		}

		this.closePromise = new Promise<void>((resolve) => {
			this.closeResolve = resolve;
		});
		this.maybeFinishClose();
		return this.closePromise;
	}

	// ── Internals ──────────────────────────────────────────────────────────

	private spawnWorker(): Worker {
		const worker = new Worker(this.workerPath, this.workerOptions);
		worker.on("message", (message: WorkerResponse) => this.handleMessage(worker, message));
		worker.on("error", (error: Error) => {
			// Required listener: without it a worker error would be re-thrown on
			// the main thread. Stash it so the subsequent `exit` reports it.
			this.workerErrors.set(worker, error);
		});
		worker.on("exit", (code: number) => this.handleExit(worker, code));
		this.workers.push(worker);
		this.idle.push(worker);
		return worker;
	}

	/** Assign queued tasks to idle workers (FIFO). */
	private dispatch(): void {
		while (this.idle.length > 0 && this.queue.length > 0) {
			const worker = this.idle.pop() as Worker;
			const task = this.queue.shift() as PendingTask;
			this.assign(worker, task);
		}
	}

	private assign(worker: Worker, task: PendingTask): void {
		this.busy.set(worker, task);
		if (task.timeoutMs > 0) {
			task.timer = setTimeout(() => this.handleTimeout(worker, task), task.timeoutMs);
			// Do not keep the event loop alive purely for a task timeout.
			task.timer.unref?.();
		}
		try {
			worker.postMessage({ id: task.id, payload: task.payload }, task.transferList ?? []);
		} catch (error) {
			this.busy.delete(worker);
			this.clearTimer(task);
			this.failTask(task, new WorkerTaskError(`failed to post task to worker: ${(error as Error).message}`));
			if (!this.closed) this.idle.push(worker);
			this.dispatch();
			this.maybeFinishClose();
		}
	}

	private handleMessage(worker: Worker, message: WorkerResponse): void {
		const task = this.busy.get(worker);
		if (!task) return; // late/duplicate message after a timeout or crash
		this.busy.delete(worker);
		this.clearTimer(task);
		task.settled = true;

		if (message && message.ok) {
			task.resolve(message.result);
		} else {
			const detail = message?.error;
			task.reject(new WorkerTaskError(detail?.message ?? "worker task failed", detail?.stack));
		}

		if (!this.closed) this.idle.push(worker);
		this.dispatch();
		this.maybeFinishClose();
	}

	private handleTimeout(worker: Worker, task: PendingTask): void {
		if (task.settled) return;
		// Detach BEFORE terminating so the resulting `exit` is treated as expected.
		this.detachWorker(worker);
		this.failTask(task, new WorkerTaskTimeoutError(`worker task timed out after ${task.timeoutMs}ms`));
		void worker.terminate();
		if (!this.closed) this.spawnWorker();
		this.dispatch();
		this.maybeFinishClose();
	}

	private handleExit(worker: Worker, code: number): void {
		const inPool = this.workers.includes(worker);
		if (!inPool) return; // already handled (intentional terminate / timeout)

		const task = this.detachWorker(worker);
		const error = this.workerErrors.get(worker);
		this.workerErrors.delete(worker);
		worker.removeAllListeners();

		if (task && !task.settled) {
			const reason = error ? error.message : `worker exited unexpectedly (code ${code})`;
			this.failTask(task, new WorkerTaskCrashError(reason));
		}

		// Respawn a replacement unless the pool is fully shut down.
		if (!this.closed && this.workers.length < this.size) {
			this.spawnWorker();
		}
		this.dispatch();
		this.maybeFinishClose();
	}

	/** Remove a worker from every tracking structure; return its in-flight task. */
	private detachWorker(worker: Worker): PendingTask | undefined {
		const idx = this.workers.indexOf(worker);
		if (idx >= 0) this.workers.splice(idx, 1);
		const idleIdx = this.idle.indexOf(worker);
		if (idleIdx >= 0) this.idle.splice(idleIdx, 1);
		const task = this.busy.get(worker);
		if (task) this.busy.delete(worker);
		return task;
	}

	private clearTimer(task: PendingTask): void {
		if (task.timer) {
			clearTimeout(task.timer);
			task.timer = undefined;
		}
	}

	private failTask(task: PendingTask, error: Error): void {
		if (task.settled) return;
		task.settled = true;
		this.clearTimer(task);
		task.reject(error);
	}

	private maybeFinishClose(): void {
		if (!this.closing || this.closed) return;
		if (this.queue.length > 0 || this.busy.size > 0) return;

		this.closed = true;
		const workers = this.workers.splice(0, this.workers.length);
		this.idle.length = 0;
		this.workerErrors.clear();

		void Promise.allSettled(
			workers.map((worker) => {
				worker.removeAllListeners();
				return worker.terminate();
			})
		).then(() => this.closeResolve?.());
	}
}
