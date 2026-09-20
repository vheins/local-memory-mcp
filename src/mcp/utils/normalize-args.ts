import path from "node:path";
import type { SessionContext } from "../session";
import {
	findContainingRoot,
	getFilesystemRoots,
	inferOwnerFromSession,
	inferRepoFromSession,
	isPathWithinRoots
} from "../session";
import { logger } from "./logger";
import { parseRepoInput } from "./normalize";
import { WRITE_TOOLS } from "./tool-plumbing";
import { UUID_REGEX } from "./uuid";

/**
 * Optional call-site context for {@link normalizeToolArguments}.
 *
 * `toolName` lets the normalizer decide whether the call is a write (via
 * {@link WRITE_TOOLS}) so it can fail loud rather than silently targeting the
 * daemon CWD. `isWrite` is an explicit override for callers that already know
 * the write-ness and want to avoid re-deriving it.
 */
export type NormalizeToolArgumentsOptions = {
	toolName?: string;
	isWrite?: boolean;
};

/** True only for a non-empty (post-trim) string — the "explicitly provided" test. */
function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

/**
 * Identifier argument keys that, when carrying a UUID, make a write
 * self-scoping: the handler resolves the stored entity by id and inherits that
 * entity's owner/repo, so the daemon CWD is never consulted (TASK-420).
 */
const IDENTIFIER_KEYS = [
	"id",
	"ids",
	"task_id",
	"task_ids",
	"memory_id",
	"memory_ids",
	"handoff_id",
	"standard_id",
	"standard_ids"
] as const;

/** Whether any identifier argument carries a UUID (an entity-self-scoping write). */
function hasUuidIdentifier(args: Record<string, unknown>): boolean {
	for (const key of IDENTIFIER_KEYS) {
		const value = args[key];
		if (typeof value === "string" && UUID_REGEX.test(value)) return true;
		if (Array.isArray(value) && value.some((item) => typeof item === "string" && UUID_REGEX.test(item))) {
			return true;
		}
	}
	return false;
}

/**
 * Whether a write's scope is determinable WITHOUT the daemon CWD fallback:
 *   - the call addresses an existing entity by UUID (`id`/`ids`/…), whose own
 *     owner/repo is inherited by the handler; or
 *   - the call is interactive (`interactive: true`) — the scope is elicited
 *     from the user before any write.
 *
 * A code-addressed or pure-create write with no explicit owner/repo and no MCP
 * roots is NOT exempt: its target would silently fall back to the daemon CWD.
 */
function isScopeResolvableWithoutCwd(args: Record<string, unknown>): boolean {
	return args.interactive === true || hasUuidIdentifier(args);
}

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
 * SCOPE PRIORITY (TASK-420): explicit args always win, then roots-derived
 * values (`inferRepoFromSession`/`inferOwnerFromSession`), and only then the
 * CWD-derived `session.repo`/`session.owner`. This keeps a client that declared
 * MCP roots pinned to its project even when the daemon's CWD differs.
 *
 * WRITE FAIL-LOUD (TASK-420): when `options.isWrite` is true (or
 * `options.toolName` is in {@link WRITE_TOOLS}) and the scope is genuinely
 * undeterminable — no explicit owner/repo, no MCP roots — an HTTP/daemon
 * session (`session.transport === "http"`) throws rather than silently writing
 * to the daemon working directory. A stdio session stays permissive (its CWD IS
 * the client's project). Reads stay permissive and are tagged with a
 * `__scopeInferred` marker for observability.
 *
 * @param args  Raw tool arguments — may be `unknown` from params?.arguments.
 * @param session  Current session context (optional in router.ts path).
 * @param options  Optional call-site context (`toolName`/`isWrite`).
 * @returns Normalized args with owner/repo/scope/agent/model populated.
 */
export function normalizeToolArguments(
	args: unknown,
	session?: SessionContext,
	options?: NormalizeToolArgumentsOptions
): Record<string, unknown> {
	if (!args || typeof args !== "object") {
		return args as Record<string, unknown>;
	}

	const isWrite = options?.isWrite ?? (options?.toolName ? WRITE_TOOLS.has(options.toolName) : undefined);

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

	const scope = nextArgs.scope as Record<string, unknown> | undefined;

	// ── Explicit-scope detection (pre-injection) ─────────────────────────────
	// Captured before any session/roots fill so the write fail-loud guard and
	// the `__scopeInferred` marker can tell a caller-supplied scope from one we
	// derived from the session/CWD.
	const explicitScopeArg =
		isNonEmptyString(nextArgs.repo) ||
		isNonEmptyString(nextArgs.owner) ||
		isNonEmptyString(scope?.repo) ||
		isNonEmptyString(scope?.owner);
	const rootsEmpty = getFilesystemRoots(session).length === 0;

	// ── Repo resolution: roots-derived first, then the CWD session default ───
	// `inferRepoFromSession` reads the declared MCP roots (single-root →
	// basename). Only when it yields nothing do we fall back to the session's
	// CWD-derived `repo` (TASK-420 priority inversion).
	if (!nextArgs.repo) {
		nextArgs.repo = inferRepoFromSession(session);
	}
	if (!nextArgs.repo && session?.repo) {
		nextArgs.repo = session.repo;
	}

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

	// Owner resolution mirrors the repo rule (TASK-420): an explicit `owner`
	// (or the owner segment of an `owner/repo` string) wins, then the
	// roots-derived owner (`inferOwnerFromSession`), and only then the
	// CWD-derived `session.owner`.
	if (!ownerExplicit && !nextArgs.owner) {
		const repoVal = (nextArgs.repo as string) || "";
		const parsed = parseRepoInput(repoVal, undefined);
		const inferredOwner = parsed.owner || inferOwnerFromSession(session) || session?.owner;
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

	// ── Scope-provenance guard (TASK-420) ────────────────────────────────────
	// The scope is "CWD-derived only" when the caller supplied no explicit
	// owner/repo AND the session declared no MCP roots. In that case every
	// resolved value came from the process working directory.
	const scopeFromCwdFallback = !explicitScopeArg && rootsEmpty;

	// The fail-loud guard fires for HTTP/daemon serving ONLY. Under HTTP the
	// process CWD is the daemon's working directory, NOT the caller's project,
	// so a CWD-derived scope would silently write to the wrong repo. Under
	// stdio the process CWD IS the client's project (one client per process),
	// so the historical CWD-derived scope is correct and MUST stay permissive —
	// a stdio client that does not advertise MCP roots always has `roots === []`,
	// and failing loud there would be a backward-compatibility regression.
	if (
		isWrite === true &&
		scopeFromCwdFallback &&
		session?.transport === "http" &&
		!isScopeResolvableWithoutCwd(nextArgs)
	) {
		// FAIL-LOUD: refuse to silently write to the daemon CWD. The dispatch
		// layer wraps thrown errors into the canonical error envelope.
		//
		// Exemption: an id-addressed write (UUID `id`/`ids`/…) or an interactive
		// (elicitation) write resolves its scope from the stored entity or the
		// user, not the CWD, so it is not at risk of a silent cross-project
		// write. Only a genuinely undeterminable scope fails loud.
		throw new Error(
			"owner/repo could not be determined for a write operation — pass explicit owner/repo or connect from a " +
				"project root (MCP roots). Refusing to write to the daemon working directory."
		);
	}

	if (isWrite !== true && scopeFromCwdFallback) {
		// READ (or unknown) stays permissive, but is tagged so callers/tests can
		// observe that the scope was inferred rather than supplied. Handlers
		// ignore unknown keys (Zod objects strip them; the SDK JSON Schema keeps
		// additional properties open), so the marker never reaches persistence.
		nextArgs.__scopeInferred = true;
	}

	// Lazy capture model & agent — fall back to session-wide values when
	// args are not provided. lastSeenAgent/lastSeenModel are set once at
	// oninitialized and never mutated afterward.
	nextArgs.agent ??= session?.lastSeenAgent ?? session?.clientName ?? process.env.MCP_CLIENT_NAME;
	nextArgs.model ??= session?.lastSeenModel ?? process.env.MCP_MODEL;

	return nextArgs;
}
