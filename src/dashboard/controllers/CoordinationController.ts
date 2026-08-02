import express from "express";
import { db, mcpClient } from "../lib/context";
import { jsonApiRes, handleController, HttpError, parsePageParams, getAttributes } from "../lib/jsonApi";

export class CoordinationController {
	static async listClaims(req: express.Request, res: express.Response) {
		await handleController(req, res, () => {
			const { repo, agent, active_only } = req.query;
			const { page, pageSize, offset } = parsePageParams(req.query, { defaultPageSize: 20 });

			if (!repo) throw new HttpError(400, "repo is required");

			const claims = db.handoffs.listClaims({
				owner: "",
				repo: repo as string,
				agent: typeof agent === "string" ? agent : undefined,
				active_only: active_only === undefined ? true : String(active_only) === "true",
				limit: pageSize,
				offset
			});

			const total = db.handoffs.listClaims({
				owner: "",
				repo: repo as string,
				agent: typeof agent === "string" ? agent : undefined,
				active_only: active_only === undefined ? true : String(active_only) === "true",
				limit: 100000,
				offset: 0
			}).length;

			return jsonApiRes(claims, "claim", {
				meta: {
					page,
					pageSize,
					totalItems: total,
					totalPages: Math.ceil(total / pageSize)
				}
			});
		});
	}

	static async releaseClaim(req: express.Request, res: express.Response) {
		await handleController(
			req,
			res,
			async () => {
				const attributes = getAttributes(req);
				if (!mcpClient.isConnected()) await mcpClient.start();
				const result = (await mcpClient.callTool("claim-release", {
					...attributes,
					structured: true
				})) as { structuredContent?: Record<string, unknown> };
				return jsonApiRes((result.structuredContent || result) as Record<string, unknown>, "claim-release");
			},
			// No DB read before the MCP call — preserve the original handler's
			// behavior of skipping db.refresh().
			{ refresh: false }
		);
	}
}
