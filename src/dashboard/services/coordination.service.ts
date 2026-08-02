import { db, mcpClient } from "../lib/context";
import type { Claim } from "../../mcp/types";

export interface ClaimListParams {
	repo: string;
	agent?: string;
	active_only?: boolean;
	limit: number;
	offset: number;
}

export interface ClaimListResult {
	claims: Claim[];
	total: number;
}

/**
 * Service layer for coordination business logic (claims + handoffs).
 *
 * Owns list/release orchestration and MCP delegation.
 * Controllers delegate here instead of touching `db` directly.
 */
export const CoordinationService = {
	listClaims(params: ClaimListParams): ClaimListResult {
		const { repo, agent, active_only, limit, offset } = params;

		const claims = db.handoffs.listClaims({
			owner: "",
			repo,
			agent: typeof agent === "string" ? agent : undefined,
			active_only: active_only === undefined ? true : active_only,
			limit,
			offset
		});

		const total = db.handoffs.listClaims({
			owner: "",
			repo,
			agent: typeof agent === "string" ? agent : undefined,
			active_only: active_only === undefined ? true : active_only,
			limit: 100000,
			offset: 0
		}).length;

		return { claims, total };
	},

	async releaseClaim(attributes: Record<string, unknown>): Promise<unknown> {
		if (!mcpClient.isConnected()) await mcpClient.start();
		const result = (await mcpClient.callTool("claim-release", {
			...attributes,
			structured: true
		})) as { structuredContent?: Record<string, unknown> };
		return result.structuredContent || result;
	}
};
