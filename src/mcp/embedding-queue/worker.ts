/**
 * In-process lease-based embedding/KG worker (TASK-013 / MEM-368).
 *
 * Runs in BOTH the MCP server and the dashboard. It claims batches of
 * `queue_jobs` (K=32 by default) with an atomic SQLite UPDATE (60s lease),
 * embeds the snapshot payloads with batched ONNX inference, runs compromise
 * KG extraction, then conditionally completes each job. The worker never
 * holds the proper-lockfile write lock — only brief SQLite writes for
 * claim/complete/fail — so writes stay fast while enrichment drains in the
 * background.
 *
 * SQLITE-safety of the unlocked writes (TASK-064 / MEM-475): claim/complete/
 * fail are single conditional UPDATE statements, which cannot hit
 * SQLITE_BUSY_SNAPSHOT (no stale read snapshot) and wait at most
 * busy_timeout=5000 for a transient writer; backfillMissingVectors is a
 * read-then-write transaction and therefore runs with BEGIN IMMEDIATE
 * (enqueue.ts). The idle poll loop uses exponential backoff + jitter so two
 * workers never busy-spin or thundering-herd the same poll times.
 *
 * SQLITE_BUSY tolerance (TASK-457): a sibling process (dashboard / another
 * per-client MCP server / the codebase indexer) holding the write lock past
 * busy_timeout surfaces as a better-sqlite3 SqliteError with `code`
 * 'SQLITE_BUSY' or 'SQLITE_BUSY_SNAPSHOT' on any of the outbox writes. Those
 * are TRANSIENT — they are never a job attempt and never poison: the cycle
 * backs off with jitter instead of logging a fatal "cycle failed", a per-job
 * BUSY releases the claim (attempts/backoff untouched) so it is retried, and
 * the outbox writes are wrapped so their own BUSY can never kill the cycle.
 *
 * Crash-safety: a lease expires after 60s; the next claim cycle (or startup
 * reconcile) re-queues the job. KG observation inserts are idempotent
 * (unique index + INSERT OR IGNORE), so reprocessing never duplicates data.
 * Startup also backfills rows with missing/stale vectors and sweeps finished
 * rows (purge).
 */
import { performance } from "node:perf_hooks";
import { RealVectorStore } from "../storage/vectors";
import { SQLiteStore } from "../storage/sqlite";
import { logger } from "../utils/logger";
import { DurationSeries, metrics } from "../utils/metrics";
import {
	EMBEDDING_QUEUE_BACKFILL_CAP,
	EMBEDDING_QUEUE_BACKFILL_MIN_QUEUE,
	EMBEDDING_QUEUE_BACKOFF_BASE_MS,
	EMBEDDING_QUEUE_BACKOFF_MAX_MS,
	EMBEDDING_QUEUE_BATCH_SIZE,
	EMBEDDING_QUEUE_DONE_TTL_MS,
	EMBEDDING_QUEUE_LEASE_MS,
	EMBEDDING_QUEUE_NON_EMPTY_BACKOFF_STREAK,
	EMBEDDING_QUEUE_POISON_THRESHOLD,
	EMBEDDING_QUEUE_POISON_TTL_MS,
	EMBEDDING_QUEUE_POLL_INTERVAL_MS,
	EMBEDDING_QUEUE_MAX_POLL_INTERVAL_MS,
	EMBEDDING_QUEUE_PURGE_INTERVAL_MS
} from "../utils/constants";
import { Outbox } from "./outbox";
import { EmbeddingJobPayload, EmbeddingWorkerStats, QueueJobKind, QueueJobRow } from "./types";
import {
	parsePayload as parseJobPayload,
	loadExistingEntityIds as loadExistingIds,
	applyJob as applyJobToStore
} from "./worker-jobs";

/**
 * better-sqlite3 surfaces SQLite lock contention as a SqliteError with a
 * string `code`: 'SQLITE_BUSY' (busy_timeout expired while waiting for a
 * writer), 'SQLITE_BUSY_SNAPSHOT' (a read-then-write transaction hit a
 * concurrent commit — thrown immediately, busy_timeout-immune), or
 * 'SQLITE_BUSY_RECOVERY' (extended 261 — another process is mid-recovery,
 * also transient). All three mean another process holds the SQLite write
 * lock, NOT that the current job failed, so they are TRANSIENT (TASK-457):
 * never count as a job attempt, never poison a job, never abort the worker
 * cycle as a fatal error. Mirrors the isSqliteError pattern in
 * entities/task/validation.ts.
 */
export function isBusyError(err: unknown): boolean {
	if (err && typeof err === "object" && "code" in err) {
		const code = (err as { code?: unknown }).code;
		return code === "SQLITE_BUSY" || code === "SQLITE_BUSY_SNAPSHOT" || code === "SQLITE_BUSY_RECOVERY";
	}
	return false;
}

export interface EmbeddingWorkerOptions {
	pollIntervalMs?: number;
	maxPollIntervalMs?: number;
	batchSize?: number;
	leaseMs?: number;
	poisonThreshold?: number;
	backoffBaseMs?: number;
	backoffMaxMs?: number;
	backfillCap?: number;
	backfillMinQueue?: number;
	doneTtlMs?: number;
	poisonTtlMs?: number;
	purgeIntervalMs?: number;
	/**
	 * Consecutive non-empty batches before the worker backs off from the fast
	 * half-interval drain to `pollIntervalMs`. Defaults to the
	 * EMBEDDING_QUEUE_NON_EMPTY_BACKOFF_STREAK env constant (5).
	 */
	nonEmptyBackoffStreak?: number;
}

export class EmbeddingWorker {
	private readonly outbox: Outbox;
	private readonly opts: Required<EmbeddingWorkerOptions>;
	private timer: NodeJS.Timeout | null = null;
	private purgeTimer: NodeJS.Timeout | null = null;
	private started = false;
	private running = false;
	private stopped = false;
	private modelReady = false;
	/** Consecutive empty claim cycles — drives the idle poll backoff (TASK-064). */
	private idleStreak = 0;
	/** Consecutive non-empty claim cycles — drives the deep-queue backoff (TASK-069). */
	private nonEmptyStreak = 0;
	/** Embedding batch latency samples (OPT-OBS-01) — surfaced as p50/p95. */
	private readonly embedLatency = new DurationSeries();
	private readonly stats = {
		processed: 0,
		failed: 0,
		poisoned: 0,
		lastBatchSize: 0,
		lastRunAt: null as string | null
	};

	constructor(
		private readonly store: SQLiteStore,
		private readonly vectors: RealVectorStore,
		options: EmbeddingWorkerOptions = {}
	) {
		this.outbox = new Outbox(store);
		this.opts = {
			pollIntervalMs: options.pollIntervalMs ?? EMBEDDING_QUEUE_POLL_INTERVAL_MS,
			maxPollIntervalMs: options.maxPollIntervalMs ?? EMBEDDING_QUEUE_MAX_POLL_INTERVAL_MS,
			batchSize: options.batchSize ?? EMBEDDING_QUEUE_BATCH_SIZE,
			leaseMs: options.leaseMs ?? EMBEDDING_QUEUE_LEASE_MS,
			poisonThreshold: options.poisonThreshold ?? EMBEDDING_QUEUE_POISON_THRESHOLD,
			backoffBaseMs: options.backoffBaseMs ?? EMBEDDING_QUEUE_BACKOFF_BASE_MS,
			backoffMaxMs: options.backoffMaxMs ?? EMBEDDING_QUEUE_BACKOFF_MAX_MS,
			backfillCap: options.backfillCap ?? EMBEDDING_QUEUE_BACKFILL_CAP,
			backfillMinQueue: options.backfillMinQueue ?? EMBEDDING_QUEUE_BACKFILL_MIN_QUEUE,
			doneTtlMs: options.doneTtlMs ?? EMBEDDING_QUEUE_DONE_TTL_MS,
			poisonTtlMs: options.poisonTtlMs ?? EMBEDDING_QUEUE_POISON_TTL_MS,
			purgeIntervalMs: options.purgeIntervalMs ?? EMBEDDING_QUEUE_PURGE_INTERVAL_MS,
			nonEmptyBackoffStreak: options.nonEmptyBackoffStreak ?? EMBEDDING_QUEUE_NON_EMPTY_BACKOFF_STREAK
		};
	}

	// -----------------------------------------------------------------------
	// Lifecycle
	// -----------------------------------------------------------------------

	start(): void {
		if (this.started) return;
		this.started = true;
		this.stopped = false;

		// Startup maintenance: reconcile expired leases, backfill missing/stale
		// vectors, purge finished rows.
		void this.runMaintenance();

		// Warm the ONNX model in the background (shares the RealVectorStore
		// extractor, so it is loaded once per process).
		void this.vectors
			.initialize()
			.then(() => {
				this.modelReady = true;
			})
			.catch((err) => {
				logger.warn("[EmbeddingWorker] model warm-up failed — will retry on first batch", {
					error: String(err)
				});
			});

		this.schedule(this.opts.pollIntervalMs);
		this.purgeTimer = setInterval(() => this.runPurge(), this.opts.purgeIntervalMs);
		this.purgeTimer.unref?.();

		logger.info("[EmbeddingWorker] started", {
			batchSize: this.opts.batchSize,
			leaseMs: this.opts.leaseMs,
			pollIntervalMs: this.opts.pollIntervalMs,
			backfillCap: this.opts.backfillCap
		});
	}

	stop(): void {
		this.stopped = true;
		this.started = false;
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		if (this.purgeTimer) {
			clearInterval(this.purgeTimer);
			this.purgeTimer = null;
		}
		logger.info("[EmbeddingWorker] stopped");
	}

	// -----------------------------------------------------------------------
	// Main loop
	// -----------------------------------------------------------------------

	private schedule(delayMs: number): void {
		if (this.stopped) return;
		this.timer = setTimeout(() => void this.loop(), delayMs);
		this.timer.unref?.();
	}

	private async loop(): Promise<void> {
		if (this.stopped) {
			return;
		}
		if (this.running) {
			this.schedule(this.opts.pollIntervalMs);
			return;
		}
		this.running = true;
		try {
			const processed = await this.runOnce();
			// Drain while the queue is non-empty (bounded interval — never the
			// old 10ms spin), exponential backoff + jitter while idle so two
			// workers don't busy-poll or thundering-herd (TASK-064 / MEM-475).
			this.schedule(this.nextDelay(processed));
		} catch (err) {
			if (isBusyError(err)) {
				// Transient SQLite lock contention (TASK-457): a sibling
				// process holds the write lock past busy_timeout. The queue is
				// untouched — a failed claim leaves jobs pending, and rows
				// interrupted mid-batch self-heal via lease expiry. This is NOT
				// a cycle failure: no attempt was consumed and nothing was
				// poisoned, so log a calm retry and back off with jitter
				// instead of the old fatal "cycle failed" every 5.5s.
				const delayMs = this.nextDelay(0);
				logger.warn("[EmbeddingWorker] cycle deferred (database busy) — retrying with backoff", {
					error: String(err),
					nextDelayMs: delayMs
				});
				this.schedule(delayMs);
			} else {
				logger.warn("[EmbeddingWorker] cycle failed", { error: String(err) });
				this.schedule(this.opts.pollIntervalMs);
			}
		} finally {
			this.running = false;
		}
	}

	/**
	 * Compute the next poll delay.
	 *
	 * Non-empty batches: the first `nonEmptyBackoffStreak` (default 5 — the
	 * EMBEDDING_QUEUE_NON_EMPTY_BACKOFF_STREAK env constant) consecutive
	 * non-empty cycles poll at half the configured interval (floored at 50ms —
	 * fast drain). Once the streak passes the threshold the queue is provably
	 * deep, so the worker backs off to `pollIntervalMs` — it keeps draining at
	 * a bounded rate without polling between every batch (TASK-068 S1 /
	 * TASK-069). An empty batch resets the streak and grows the delay
	 * exponentially from `pollIntervalMs` up to `maxPollIntervalMs`, with
	 * 0.5–1.0× random jitter to decorrelate the MCP-server and dashboard
	 * workers in the same DB.
	 *
	 * Public for tests/observability.
	 */
	nextDelay(processed: number): number {
		if (processed > 0) {
			this.idleStreak = 0;
			this.nonEmptyStreak = Math.min(this.nonEmptyStreak + 1, 32);
			if (this.nonEmptyStreak >= this.opts.nonEmptyBackoffStreak) {
				return this.opts.pollIntervalMs;
			}
			return Math.max(50, this.opts.pollIntervalMs / 2);
		}
		this.nonEmptyStreak = 0;
		const base = Math.min(this.opts.pollIntervalMs * 2 ** this.idleStreak, this.opts.maxPollIntervalMs);
		this.idleStreak = Math.min(this.idleStreak + 1, 16);
		return base * (0.5 + Math.random() * 0.5);
	}

	/**
	 * One claim→embed→extract→complete cycle. Returns the number of jobs
	 * claimed (0 when the queue is empty). Public for tests/observability.
	 */
	async runOnce(): Promise<number> {
		const jobs = this.outbox.claim(this.opts.batchSize, this.opts.leaseMs);
		this.stats.lastRunAt = new Date().toISOString();
		this.stats.lastBatchSize = jobs.length;
		if (jobs.length === 0) return 0;

		// Phase 1 — parse payloads in memory (no DB reads). Unparseable jobs
		// are completed as no-ops, matching the pre-batch behavior.
		const parsed: { job: QueueJobRow; payload: EmbeddingJobPayload }[] = [];
		for (const job of jobs) {
			const payload = this.parsePayload(job);
			if (!payload) {
				// Unparseable payload — nothing to enrich. Complete bound to
				// OUR batch token: if the lease expired and another worker
				// re-claimed the row, this no-ops and that worker keeps
				// processing it. Wrapped so a transient SQLITE_BUSY here
				// defers the write (lease-expiry self-heals) instead of
				// killing the whole cycle (TASK-457). The no-op complete
				// counts as a failure ONLY when it actually ran: a deferred
				// (BUSY) complete leaves the row claimed and self-healing,
				// and must not inflate `failed` with lock contention
				// (TASK-457-F2, mirrors the per-job BUSY path which skips it).
				const completedNoOp = this.runOutboxWrite(
					() => this.outbox.complete(job.id, job.locked_by ?? ""),
					"complete-unparseable"
				);
				if (completedNoOp) {
					this.stats.failed++;
				}
				continue;
			}
			parsed.push({ job, payload });
		}

		// Phase 2 — batch entity-existence check (OPT-PERF-03): one IN(...)
		// read per entity kind for the whole claimed batch instead of one
		// getById/getTaskById per job (~32 reads → ~3 reads). A job whose
		// entity no longer exists is skipped exactly as before: completed as
		// a no-op (complete() is token-bound, so a re-claimed row no-ops) and
		// counted as failed.
		const resolved: { job: QueueJobRow; payload: EmbeddingJobPayload }[] = [];
		if (parsed.length > 0) {
			const existingById = this.loadExistingEntityIds(parsed);
			for (const item of parsed) {
				if (!existingById.get(item.job.entity_kind)?.has(item.job.entity_id)) {
					// Wrapped — a transient SQLITE_BUSY defers the no-op
					// complete (lease-expiry self-heals) instead of killing
					// the cycle (TASK-457). Count as failed ONLY when the
					// complete actually ran — a deferred complete is lock
					// contention, not a job failure, so it must not inflate
					// `failed` (TASK-457-F2, mirrors the per-job BUSY path).
					const completedMissing = this.runOutboxWrite(
						() => this.outbox.complete(item.job.id, item.job.locked_by ?? ""),
						"complete-missing-entity"
					);
					if (completedMissing) {
						this.stats.failed++;
					}
					continue;
				}
				resolved.push(item);
			}
		}

		if (resolved.length > 0) {
			// Split the batch: only memory/standard/task jobs consume an ONNX
			// embedding. codebase_symbol jobs are KG-only — writeVector is a
			// deliberate NO-OP for them (TASK-293) and codebase_symbol_vectors
			// is never populated, so batch-embedding them previously burned
			// 150-500ms of CPU per file for a vector that was immediately
			// discarded (TASK-338 / code-review F1). Embed only the
			// embed-needed subset and hand codebase jobs a placeholder vector
			// that applyJob's writeVector branch never persists.
			const embedNeeded = resolved.filter((r) => r.job.entity_kind !== "codebase_symbol");
			const toApply: { job: QueueJobRow; payload: EmbeddingJobPayload; vector: number[] }[] = [];
			if (embedNeeded.length > 0) {
				// Batch embedding latency (OPT-OBS-01): measure the ONNX batch
				// and record it into BOTH the worker's own series (exposed via
				// getStats().embedLatency) and the process metrics registry.
				const embedStartMs = performance.now();
				const embedded = await this.vectors.embed(embedNeeded.map((r) => r.payload.text));
				const embedMs = performance.now() - embedStartMs;
				this.embedLatency.add(embedMs);
				metrics.recordEmbedLatency(embedMs);
				for (let i = 0; i < embedNeeded.length; i++) {
					toApply.push({ ...embedNeeded[i], vector: embedded[i] });
				}
			}
			for (const item of resolved) {
				if (item.job.entity_kind === "codebase_symbol") {
					// Placeholder — discarded by the writeVector NO-OP.
					toApply.push({ ...item, vector: [] });
				}
			}

			for (const { job, payload, vector } of toApply) {
				try {
					await this.applyJob(job, payload, vector);
					this.outbox.complete(job.id, job.locked_by ?? "");
					this.stats.processed++;
				} catch (err) {
					if (isBusyError(err)) {
						// Transient lock contention (TASK-457): writeVector (or
						// the complete right after it) hit SQLITE_BUSY. This is
						// NOT a job failure — counting it as an attempt would
						// move a healthy job toward poison after just 5 lock-out
						// windows (EMBEDDING_QUEUE_POISON_THRESHOLD). Release the
						// claim (attempts/backoff untouched) so the next cycle
						// retries the same snapshot, and never increment failed.
						logger.warn("[EmbeddingWorker] job deferred (database busy) — requeued", {
							job: job.id,
							error: String(err)
						});
						this.runOutboxWrite(() => this.outbox.release(job.id, job.locked_by ?? ""), "release-busy");
						continue;
					}
					this.stats.failed++;
					// Wrapped so a transient SQLITE_BUSY on fail()'s own
					// SELECT/UPDATE defers the write (the row stays claimed and
					// self-heals via lease expiry) instead of escaping the
					// catch and killing the cycle (TASK-457). Real failures
					// still increment attempts + backoff exactly as before.
					this.runOutboxWrite(
						() =>
							this.outbox.fail(
								job.id,
								job.locked_by ?? "",
								err instanceof Error ? err.message : String(err),
								this.opts.poisonThreshold,
								this.opts.backoffBaseMs,
								this.opts.backoffMaxMs
							),
						"fail"
					);
				}
			}
		}

		return jobs.length;
	}

	// -----------------------------------------------------------------------
	// Job processing
	// -----------------------------------------------------------------------

	private parsePayload(job: QueueJobRow): EmbeddingJobPayload | null {
		// Delegates to the pipeline module (worker-jobs.ts) — implementation
		// documented there (TASK-430).
		return parseJobPayload(job);
	}

	/**
	 * Batch entity-existence check (OPT-PERF-03). One IN(...) DB read per
	 * entity kind present in the claimed batch replaces the per-job
	 * getById/getTaskById round-trips (K=32 reads → ≤3 reads). Returns a
	 * per-kind Set of entity ids that still exist; soft-deleted (canceled)
	 * tasks are excluded exactly as the per-job check did — a stale pending
	 * job can never re-embed the vector or re-run KG extraction for a deleted
	 * task (TASK-042 / MEM-427).
	 */
	private loadExistingEntityIds(items: ReadonlyArray<{ job: QueueJobRow }>): Map<QueueJobKind, Set<string>> {
		// Delegates to the pipeline module (worker-jobs.ts) — implementation
		// documented there (TASK-430).
		return loadExistingIds(this.store, items);
	}

	/**
	 * KG extraction first (idempotent — unique observation index + OR IGNORE),
	 * then the vector write. If the process crashes after the vector write but
	 * before `complete`, the lease expires and the job is reprocessed; the
	 * KG side is a no-op duplicate, and the vector is overwritten with the
	 * same snapshot — no data duplication.
	 */
	private async applyJob(job: QueueJobRow, payload: EmbeddingJobPayload, vector: number[]): Promise<void> {
		// Delegates to the pipeline module (worker-jobs.ts) — implementation
		// documented there (TASK-430).
		await applyJobToStore(this.store, this.vectors, job, payload, vector);
	}

	/**
	 * Run an outbox write tolerating transient SQLite lock contention
	 * (TASK-457). better-sqlite3 SqliteError codes 'SQLITE_BUSY' (busy_timeout
	 * expired) and 'SQLITE_BUSY_SNAPSHOT' (read-then-write hit a concurrent
	 * commit) mean a sibling process holds the SQLite write lock. The write is
	 * skipped — the row stays claimed and self-heals via lease expiry — and
	 * NEVER counts as a job attempt or a cycle failure. Non-busy errors are
	 * rethrown so the caller's real-failure handling applies unchanged.
	 *
	 * @returns true when the write ran to completion, false when deferred.
	 */
	private runOutboxWrite(fn: () => void, context: string): boolean {
		try {
			fn();
			return true;
		} catch (err) {
			if (isBusyError(err)) {
				logger.warn("[EmbeddingWorker] outbox write deferred (database busy)", {
					context,
					error: String(err)
				});
				return false;
			}
			throw err;
		}
	}

	// -----------------------------------------------------------------------
	// Maintenance
	// -----------------------------------------------------------------------

	private async runMaintenance(): Promise<void> {
		try {
			const reconciled = this.outbox.reconcileExpiredLeases();
			// Backfill is gated inside backfillMissingVectors (pending+claimed
			// >= backfillMinQueue → 0). Log the queue depth so users can see
			// whether the backlog is draining (TASK-069 observability).
			const counts = this.outbox.countByStatus();
			// Log the backfill scope BEFORE it runs: backfillMissingVectors is
			// intentionally GLOBAL (no repo filter — enqueue.ts:393) — it scans
			// memories, standards, and tasks across every repo in the store, so
			// the cross-repo nature must be visible in logs (TASK-412, RCA
			// TASK-395 #2). cap/gate are surfaced so the log is actionable.
			logger.info("[EmbeddingWorker] startup backfill scope: GLOBAL across all repos", {
				scope: "global",
				cap: this.opts.backfillCap,
				minQueue: this.opts.backfillMinQueue
			});
			const backfilled = this.outbox.backfillMissingVectors(this.opts.backfillCap, this.opts.backfillMinQueue);
			const purged = this.outbox.purge(this.opts.doneTtlMs, this.opts.poisonTtlMs);
			logger.info("[EmbeddingWorker] startup maintenance complete", {
				reconciled,
				backfilled,
				queueDepth: {
					pending: counts.pending,
					claimed: counts.claimed,
					done: counts.done,
					poison: counts.poison,
					total: counts.total
				},
				purgedDone: purged.purgedDone,
				purgedPoison: purged.purgedPoison
			});
		} catch (err) {
			logger.warn("[EmbeddingWorker] startup maintenance failed", { error: String(err) });
		}
	}

	private async runPurge(): Promise<void> {
		try {
			const purged = this.outbox.purge(this.opts.doneTtlMs, this.opts.poisonTtlMs);
			if (purged.purgedDone > 0 || purged.purgedPoison > 0) {
				logger.debug("[EmbeddingWorker] purge sweep", purged);
			}
		} catch (err) {
			logger.warn("[EmbeddingWorker] purge sweep failed", { error: String(err) });
		}
	}

	// -----------------------------------------------------------------------
	// Observability
	// -----------------------------------------------------------------------

	getStats(): EmbeddingWorkerStats {
		const counts = this.outbox.countByStatus();
		const latency = this.embedLatency.snapshot();
		return {
			...counts,
			...this.stats,
			embedLatency: {
				count: latency.count,
				avgMs: latency.avgMs,
				p50Ms: latency.p50Ms,
				p95Ms: latency.p95Ms,
				maxMs: latency.maxMs
			},
			running: this.running,
			started: this.started,
			modelReady: this.modelReady,
			pollIntervalMs: this.opts.pollIntervalMs,
			batchSize: this.opts.batchSize,
			leaseMs: this.opts.leaseMs
		};
	}
}
