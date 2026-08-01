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
 * (outbox.ts). The idle poll loop uses exponential backoff + jitter so two
 * workers never busy-spin or thundering-herd the same poll times.
 *
 * Crash-safety: a lease expires after 60s; the next claim cycle (or startup
 * reconcile) re-queues the job. KG observation inserts are idempotent
 * (unique index + INSERT OR IGNORE), so reprocessing never duplicates data.
 * Startup also backfills rows with missing/stale vectors and sweeps finished
 * rows (purge).
 */
import { RealVectorStore } from "../storage/vectors";
import { SQLiteStore } from "../storage/sqlite";
import { saveExtractions, saveStandardRelations, saveTaskRelations } from "../tools/kg-archivist";
import { logger } from "../utils/logger";
import {
	EMBEDDING_QUEUE_BACKFILL_CAP,
	EMBEDDING_QUEUE_BACKOFF_BASE_MS,
	EMBEDDING_QUEUE_BACKOFF_MAX_MS,
	EMBEDDING_QUEUE_BATCH_SIZE,
	EMBEDDING_QUEUE_DONE_TTL_MS,
	EMBEDDING_QUEUE_LEASE_MS,
	EMBEDDING_QUEUE_POISON_THRESHOLD,
	EMBEDDING_QUEUE_POISON_TTL_MS,
	EMBEDDING_QUEUE_POLL_INTERVAL_MS,
	EMBEDDING_QUEUE_MAX_POLL_INTERVAL_MS,
	EMBEDDING_QUEUE_PURGE_INTERVAL_MS
} from "../utils/constants";
import { Outbox } from "./outbox";
import { EmbeddingJobPayload, EmbeddingWorkerStats, QueueJobKind, QueueJobRow } from "./types";

export interface EmbeddingWorkerOptions {
	pollIntervalMs?: number;
	maxPollIntervalMs?: number;
	batchSize?: number;
	leaseMs?: number;
	poisonThreshold?: number;
	backoffBaseMs?: number;
	backoffMaxMs?: number;
	backfillCap?: number;
	doneTtlMs?: number;
	poisonTtlMs?: number;
	purgeIntervalMs?: number;
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
			doneTtlMs: options.doneTtlMs ?? EMBEDDING_QUEUE_DONE_TTL_MS,
			poisonTtlMs: options.poisonTtlMs ?? EMBEDDING_QUEUE_POISON_TTL_MS,
			purgeIntervalMs: options.purgeIntervalMs ?? EMBEDDING_QUEUE_PURGE_INTERVAL_MS
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
			logger.warn("[EmbeddingWorker] cycle failed", { error: String(err) });
			this.schedule(this.opts.pollIntervalMs);
		} finally {
			this.running = false;
		}
	}

	/**
	 * Compute the next poll delay. A non-empty batch resets the idle streak and
	 * polls at half the configured interval (floored at 50ms — fast drain, no
	 * CPU spin). An empty batch grows the delay exponentially from
	 * `pollIntervalMs` up to `maxPollIntervalMs`, with 0.5–1.0× random jitter
	 * to decorrelate the MCP-server and dashboard workers in the same DB.
	 */
	private nextDelay(processed: number): number {
		if (processed > 0) {
			this.idleStreak = 0;
			return Math.max(50, this.opts.pollIntervalMs / 2);
		}
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

		const resolved: { job: QueueJobRow; payload: EmbeddingJobPayload }[] = [];
		for (const job of jobs) {
			const payload = this.parsePayload(job);
			if (!payload || !this.entityExists(job.entity_kind, job.entity_id)) {
				// Unparseable payload or entity deleted — nothing to enrich.
				// Complete bound to OUR batch token: if the lease expired and
				// another worker re-claimed the row, this no-ops and that
				// worker keeps processing it.
				this.outbox.complete(job.id, job.locked_by ?? "");
				this.stats.failed++;
				continue;
			}
			resolved.push({ job, payload });
		}

		if (resolved.length > 0) {
			const embedded = await this.vectors.embed(resolved.map((r) => r.payload.text));
			for (let i = 0; i < resolved.length; i++) {
				const { job, payload } = resolved[i];
				try {
					await this.applyJob(job, payload, embedded[i]);
					this.outbox.complete(job.id, job.locked_by ?? "");
					this.stats.processed++;
				} catch (err) {
					this.stats.failed++;
					this.outbox.fail(
						job.id,
						job.locked_by ?? "",
						err instanceof Error ? err.message : String(err),
						this.opts.poisonThreshold,
						this.opts.backoffBaseMs,
						this.opts.backoffMaxMs
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
		try {
			const parsed = JSON.parse(job.payload) as EmbeddingJobPayload;
			if (!parsed || typeof parsed.text !== "string" || parsed.text.length === 0) return null;
			return parsed;
		} catch {
			return null;
		}
	}

	private entityExists(kind: QueueJobKind, id: string): boolean {
		if (kind === "memory") return this.store.memories.getById(id) !== null;
		if (kind === "standard") return this.store.standards.getById(id) !== null;
		// Soft-deleted tasks (status = 'canceled') are treated as non-existent:
		// the job is completed as a no-op so a stale pending job can never
		// re-embed the vector or re-run KG extraction for a deleted task
		// (TASK-042 / MEM-427).
		const task = this.store.tasks.getTaskById(id);
		return task !== null && task.status !== "canceled";
	}

	/**
	 * KG extraction first (idempotent — unique observation index + OR IGNORE),
	 * then the vector write. If the process crashes after the vector write but
	 * before `complete`, the lease expires and the job is reprocessed; the
	 * KG side is a no-op duplicate, and the vector is overwritten with the
	 * same snapshot — no data duplication.
	 */
	private async applyJob(job: QueueJobRow, payload: EmbeddingJobPayload, vector: number[]): Promise<void> {
		const owner = payload.owner ?? "";
		const repo = payload.repo ?? "";
		const kgContent = payload.content ?? payload.text;
		const title = payload.title ?? "";

		if (job.entity_kind === "memory") {
			await saveExtractions(kgContent, title, owner, repo, this.store, "memory");
		} else if (job.entity_kind === "standard") {
			await saveExtractions(kgContent, title, owner, repo, this.store, "standard");
			await saveStandardRelations(
				{
					id: job.entity_id,
					title,
					content: kgContent,
					context: payload.context ?? "general",
					stack: payload.stack ?? [],
					parent_id: payload.parentId ?? null,
					owner,
					repo: repo || null
				},
				this.store
			);
		} else {
			await saveExtractions(kgContent, title, owner, repo, this.store, "task");
			await saveTaskRelations(kgContent, title, owner, repo, this.store, {
				parentId: payload.parentId ?? null,
				decisionRefs: payload.decisionRefs
			});
		}

		this.writeVector(job.entity_kind, job.entity_id, vector);
	}

	private writeVector(kind: QueueJobKind, id: string, vector: number[]): void {
		if (kind === "memory") {
			this.store.memoryVectors.upsertVectorEmbedding(id, vector);
		} else if (kind === "standard") {
			this.store.standards.upsertVectorEmbedding(id, vector);
		} else {
			this.store.tasks.upsertTaskVectorEmbedding(id, vector);
		}
	}

	// -----------------------------------------------------------------------
	// Maintenance
	// -----------------------------------------------------------------------

	private async runMaintenance(): Promise<void> {
		try {
			const reconciled = this.outbox.reconcileExpiredLeases();
			const backfilled = this.outbox.backfillMissingVectors(this.opts.backfillCap);
			const purged = this.outbox.purge(this.opts.doneTtlMs, this.opts.poisonTtlMs);
			logger.info("[EmbeddingWorker] startup maintenance complete", {
				reconciled,
				backfilled,
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
		return {
			...counts,
			...this.stats,
			running: this.running,
			started: this.started,
			modelReady: this.modelReady,
			pollIntervalMs: this.opts.pollIntervalMs,
			batchSize: this.opts.batchSize,
			leaseMs: this.opts.leaseMs
		};
	}
}
