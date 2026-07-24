import path from "node:path";
import type { SessionContext } from "../session";
import { findContainingRoot, inferOwnerFromSession, inferRepoFromSession, isPathWithinRoots } from "../session";
import { logger } from "./logger";
import { parseRepoInput } from "./normalize";

/**
 * Validates that an absolute path value stays within the active MCP roots.
 * Throws if the path is absolute and not within any registered root.
 */
export function validateRootBoundPath(value: unknown, field: string, session?: SessionContext): void {
	if (typeof value !== "string" || !path.isAbsolute(value)) {
		return;
	}

	if (!isPathWithinRoots(value, session)) {
		throw new Error(`${field} must stay within the active MCP roots`);
	}
}

/**
 * Normalizes tool call arguments by injecting owner/repo/scope from session
 * context when not explicitly provided. Handles string scope (JSON or plain
 * repo name), session-wide owner/repo preference, agent/model lazy capture,
 * and scope.folder derivation from current_file_path.
 *
 * Used by both the upstream MCP router (router.ts) and the native MCP SDK
 * tool registration (tools/index.ts).
 *
 * @param args  Raw tool arguments — may be `unknown` from params?.arguments.
 * @param session  Current session context (optional in router.ts path).
 * @returns Normalized args with owner/repo/scope/agent/model populated.
 */
export function normalizeToolArguments(args: unknown, session?: SessionContext): Record<string, unknown> {
	if (!args || typeof args !== "object") {
		return args as Record<string, unknown>;
	}

	const anyArgs = args as Record<string, unknown>;
	const scopeVal = anyArgs.scope;
	const nextArgs: Record<string, unknown> = {
		...anyArgs,
		// Handle string scope gracefully:
		//   "my-repo" → { repo: "my-repo" }
		//   '{"owner":"vheins","repo":"my-repo"}' → { owner: "vheins", repo: "my-repo" }
		scope:
			typeof scopeVal === "string"
				? (() => {
						try {
							const parsed = JSON.parse(scopeVal);
							if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
								return parsed as Record<string, unknown>;
							}
						} catch {
							/* not JSON, treat as plain repo name */
						}
						return { repo: scopeVal };
					})()
				: scopeVal
					? { ...(scopeVal as Record<string, unknown>) }
					: undefined
	};

	validateRootBoundPath(nextArgs.current_file_path, "current_file_path", session);
	validateRootBoundPath(nextArgs.doc_path, "doc_path", session);

	// Session-wide defaults for owner/repo — prefer session-wide values
	// over re-deriving every call
	if (!nextArgs.repo && session?.repo) {
		nextArgs.repo = session.repo;
	}
	if (!nextArgs.repo) {
		nextArgs.repo = inferRepoFromSession(session);
	}

	const scope = nextArgs.scope as Record<string, unknown> | undefined;
	if (scope && !scope.repo) {
		scope.repo = (nextArgs.repo as string) ?? inferRepoFromSession(session);
	}

	if (!nextArgs.owner && session?.owner) {
		nextArgs.owner = session.owner;
	}

	if (!nextArgs.owner) {
		const repoVal = (nextArgs.repo as string) || "";
		const parsed = parseRepoInput(repoVal, undefined);
		const inferredOwner = parsed.owner || inferOwnerFromSession(session);
		if (inferredOwner !== undefined) {
			nextArgs.owner = inferredOwner;
			if (!repoVal.includes("/")) {
				logger.warn(
					`[normalize-args] owner inferred from session (${nextArgs.owner}) — may be incorrect. Agents should pass explicit owner/repo.`
				);
			}
		}
	}

	if (scope && !scope.owner) {
		const repoVal = (scope.repo as string) || (nextArgs.repo as string) || "";
		const parsed = parseRepoInput(repoVal, undefined);
		const inferredOwner = parsed.owner || (nextArgs.owner as string) || inferOwnerFromSession(session);
		if (inferredOwner !== undefined) {
			scope.owner = inferredOwner;
		}
	}

	const ownerVal = (nextArgs.owner as string) || inferOwnerFromSession(session) || undefined;
	const repoVal = (nextArgs.repo as string) || inferRepoFromSession(session) || undefined;
	const memories = nextArgs.memories as Array<Record<string, unknown>> | undefined;
	if (memories) {
		for (const mem of memories) {
			const memScope = mem.scope as Record<string, unknown> | undefined;
			if (memScope) {
				if (!memScope.owner) {
					const inferredMemOwner =
						ownerVal || parseRepoInput((memScope.repo as string) || repoVal || "", undefined).owner;
					if (inferredMemOwner) memScope.owner = inferredMemOwner;
				}
				if (!memScope.repo && repoVal) memScope.repo = repoVal;
			}
		}
	}

	if (typeof nextArgs.current_file_path === "string" && scope) {
		const containingRoot = path.isAbsolute(nextArgs.current_file_path)
			? findContainingRoot(nextArgs.current_file_path, session)
			: null;

		if (containingRoot) {
			const relativePath = path.relative(containingRoot, path.resolve(nextArgs.current_file_path));
			const relativeFolder = path.dirname(relativePath);
			if (relativeFolder && relativeFolder !== "." && !scope.folder) {
				scope.folder = relativeFolder;
			}
		}
	}

	// Lazy capture model & agent — fall back to session-wide values when
	// args are not provided. lastSeenAgent/lastSeenModel are set once at
	// oninitialized and never mutated afterward.
	nextArgs.agent ??= session?.lastSeenAgent ?? session?.clientName ?? process.env.MCP_CLIENT_NAME;
	nextArgs.model ??= session?.lastSeenModel ?? process.env.MCP_MODEL;

	return nextArgs;
}
