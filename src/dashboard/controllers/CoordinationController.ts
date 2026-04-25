import express from "express";
import { db, mcpClient } from "../lib/context.js";
import { jsonApiRes, jsonApiError, getAttributes } from "../lib/jsonApi.js";

export class CoordinationController {
	static async listClaims(req: express.Request, res: express.Response) {
		try {
			await db.refresh();
			const { repo, agent, active_only } = req.query;
			const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
			const pageSize = Math.min(100, Math.max(1, parseInt((req.query.pageSize as string) || "20", 10)));

			if (!repo) return res.status(400).json(jsonApiError("repo is required", 400));

			const claims = db.handoffs.listClaims({
				repo: repo as string,
				agent: typeof agent === "string" ? agent : undefined,
				active_only: active_only === undefined ? true : String(active_only) === "true",
				limit: pageSize,
				offset: (page - 1) * pageSize
			});

			const total = db.handoffs.listClaims({
				repo: repo as string,
				agent: typeof agent === "string" ? agent : undefined,
				active_only: active_only === undefined ? true : String(active_only) === "true",
				limit: 100000,
				offset: 0
			}).length;

			res.json(
				jsonApiRes(claims, "claim", {
					meta: {
						page,
						pageSize,
						totalItems: total,
						totalPages: Math.ceil(total / pageSize)
					}
				})
			);
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			res.status(500).json(jsonApiError(message));
		}
	}

	static async releaseClaim(req: express.Request, res: express.Response) {
		try {
			const attributes = getAttributes(req);
			if (!mcpClient.isConnected()) await mcpClient.start();
			const result = (await mcpClient.callTool("claim-release", {
				...attributes,
				structured: true
			})) as { structuredContent?: Record<string, unknown> };
			res.json(jsonApiRes((result.structuredContent || result) as Record<string, unknown>, "claim-release"));
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Internal server error";
			res.status(500).json(jsonApiError(message));
		}
	}
}
