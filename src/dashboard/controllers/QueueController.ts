import express from "express";
import { db, embeddingWorker } from "../lib/context";
import { jsonApiRes, jsonApiError } from "../lib/jsonApi";

/**
 * Embedding/KG outbox queue observability (TASK-013). Exposes worker + queue
 * depth stats so the dashboard can surface backpressure (pending/poison
 * counts, batch size, lease, model readiness).
 */
export class QueueController {
	static async status(_req: express.Request, res: express.Response) {
		try {
			await db.refresh();
			res.json(jsonApiRes(embeddingWorker.getStats(), "queue-status"));
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			res.status(500).json(jsonApiError(message));
		}
	}
}
