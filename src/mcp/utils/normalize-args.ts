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
 * Record-valued argument fields whose inner empty strings are legitimate stored
 * data — they must never be stripped or recursed into. Matched by field name AND
 * plain-object value: a string-valued `context` (memory/standard) is still an
 * empty-string parameter and is stripped like any other (FIX-EMPTY-PARAMS).
 */
const RECORD_VALUED_FIELDS = new Set(["metadata", "context", "args"]);

/**
 * Clones an argument value, deleting every object key whose value is exactly
 * the empty string and recursing into plain objects and array items.
 *
 * Empty strings are "not provided" for every tool parameter (universal policy,
 * FIX-EMPTY-PARAMS). Record-valued fields (`metadata`/`context`/`args`) are
 * copied verbatim — their inner empty strings are stored data, not parameters —
 * and array ELEMENTS are preserved (`tags: [""]` stays intact). The input value
 * is never mutated.
 *
 * @param value  Raw argument value (object, array, or primitive).
 * @returns A structurally-cloned value with empty-string object keys removed.
 */
function stripEmptyStringKeys(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => stripEmptyStringKeys(item));
	}
	if (value === null || typeof value !== "object") {
		return value;
	}

	const source = value as Record<string, unknown>;
	const out: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(source)) {
		if (child === "") continue; // exact empty string → treat as not provided
		const isRecordValued =
			RECORD_VALUED_FIELDS.has(key) && child !== null && typeof child === "object" && !Array.isArray(child);
		out[key] = isRecordValued ? child : stripEmptyStringKeys(child);
	}
	return out;
}

/**
 * Normalizes tool call arguments by injecting owner/repo/scope from session
 * context when not explicitly provided. Handles string scope (JSON or plain
 * repo name), session-wide owner/repo preference, agent/model lazy capture,
 * and scope.folder derivation from current_file_path.
 *
 * Before any session fill, every empty-string parameter (at any nesting depth)
 * is stripped so it is treated as "not provided" (FIX-EMPTY-PARAMS).
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
	const strippedArgs = stripEmptyStringKeys(anyArgs) as Record<string, unknown>;
	const scopeVal = strippedArgs.scope;
	const nextArgs: Record<string, unknown> = {
		...strippedArgs,
		// Handle string scope gracefully:
		//   "my-repo" → { repo: "my-repo" }
		//   '{"owner":"vheins","repo":"my-repo"}' → { owner: "vheins", repo: "my-repo" }
		scope:
			typeof scopeVal === "string"
				? (() => {
						try {
							const parsed = JSON.parse(scopeVal);
							if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
								return stripEmptyStringKeys(parsed) as Record<string, unknown>;
							}
						} catch {
							/* not JSON, treat as plain repo name */
						}
						return { repo: scopeVal };
					})()
				: scopeVal
					? (stripEmptyStringKeys(scopeVal) as Record<string, unknown>)
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

	// An owner is explicit only when it is a non-empty (after trim) string. An
	// empty or whitespace-only owner is treated as "not provided" and dropped so
	// the fallback chain below runs (FIX-OWNER-EMPTY). A non-empty owner stays
	// authoritative and is never re-inferred from the session or the repo string
	// (FIX-OWNER-INFER).
	const ownerValue = nextArgs.owner;
	const ownerExplicit = typeof ownerValue === "string" && ownerValue.trim().length > 0;
	if (typeof ownerValue === "string" && !ownerExplicit) {
		delete nextArgs.owner;
	}

	if (!ownerExplicit && !nextArgs.owner && session?.owner) {
		nextArgs.owner = session.owner;
	}

	if (!ownerExplicit && !nextArgs.owner) {
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

	// Scope owner mirrors the top-level rule: an empty/whitespace-only
	// scope.owner is treated as "not provided" and dropped, then derived from
	// the scoped repo / resolved top-level owner (FIX-OWNER-EMPTY). A non-empty
	// scope.owner stays authoritative and is kept as-is (FIX-OWNER-INFER).
	const scopeOwnerValue = scope?.owner;
	const scopeOwnerExplicit = typeof scopeOwnerValue === "string" && scopeOwnerValue.trim().length > 0;
	if (scope && typeof scopeOwnerValue === "string" && !scopeOwnerExplicit) {
		delete scope.owner;
	}
	if (scope && !scopeOwnerExplicit) {
		const repoVal = (scope.repo as string) || (nextArgs.repo as string) || "";
		const parsed = parseRepoInput(repoVal, undefined);
		const inferredOwner =
			parsed.owner || (nextArgs.owner as string) || (ownerExplicit ? undefined : inferOwnerFromSession(session));
		if (inferredOwner !== undefined) {
			scope.owner = inferredOwner;
		}
	}

	// `nextArgs.owner` is already normalized above, so an empty/whitespace owner
	// can no longer shadow session inference here (FIX-OWNER-EMPTY).
	const ownerVal = (nextArgs.owner as string) ?? inferOwnerFromSession(session) ?? undefined;
	const repoVal = (nextArgs.repo as string) ?? inferRepoFromSession(session) ?? undefined;
	const memories = nextArgs.memories as Array<Record<string, unknown>> | undefined;
	if (memories) {
		for (const mem of memories) {
			const memScope = mem.scope as Record<string, unknown> | undefined;
			if (memScope) {
				// Empty/whitespace-only memory-scope owners are "not provided"
				// too, so they are filled from the resolved owner/repo
				// (FIX-OWNER-EMPTY).
				const memOwner = memScope.owner;
				if (memOwner == null || (typeof memOwner === "string" && memOwner.trim().length === 0)) {
					delete memScope.owner;
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
