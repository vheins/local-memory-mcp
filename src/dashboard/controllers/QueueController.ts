import express from "express";
import { embeddingWorker } from "../lib/context";
import { jsonApiRes, handleController } from "../lib/jsonApi";

/**
 * Embedding/KG outbox queue observability (TASK-013). Exposes worker + queue
 * depth stats so the dashboard can surface backpressure (pending/poison
 * counts, batch size, lease, model readiness).
 */
export class QueueController {
	static async status(req: express.Request, res: express.Response) {
		await handleController(req, res, () => jsonApiRes(embeddingWorker.getStats(), "queue-status"));
	}
}
