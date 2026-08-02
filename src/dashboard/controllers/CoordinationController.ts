import express from "express";
import { jsonApiRes, handleController, HttpError, parsePageParams, getAttributes } from "../lib/jsonApi";
import { CoordinationService } from "../services/coordination.service";

/**
 * Thin request/response adapter for coordination endpoints.
 * Business logic delegated to CoordinationService.
 */
export class CoordinationController {
	static async listClaims(req: express.Request, res: express.Response) {
		await handleController(req, res, () => {
			const { repo, agent, active_only } = req.query;
			const { page, pageSize, offset } = parsePageParams(req.query, { defaultPageSize: 20 });

			if (!repo) throw new HttpError(400, "repo is required");

			const result = CoordinationService.listClaims({
				repo: repo as string,
				agent: typeof agent === "string" ? agent : undefined,
				active_only: active_only === undefined ? undefined : String(active_only) === "true",
				limit: pageSize,
				offset
			});

			return jsonApiRes(result.claims, "claim", {
				meta: {
					page,
					pageSize,
					totalItems: result.total,
					totalPages: Math.ceil(result.total / pageSize)
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
				const result = await CoordinationService.releaseClaim(attributes);
				return jsonApiRes(result as Record<string, unknown>, "claim-release");
			},
			// No DB read before the MCP call — preserve the original handler's
			// behavior of skipping db.refresh().
			{ refresh: false }
		);
	}
}
