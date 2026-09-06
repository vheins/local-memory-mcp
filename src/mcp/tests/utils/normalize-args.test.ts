import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeToolArguments, validateRootBoundPath } from "../../utils/normalize-args";
import { inferOwnerFromSession, inferRepoFromSession, type SessionContext } from "../../session";
import { logger } from "../../utils/logger";

vi.mock("../../session", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../session")>();
	return {
		...actual,
		inferOwnerFromSession: vi.fn(),
		inferRepoFromSession: vi.fn()
	};
});

const ROOT = process.cwd();

function makeSession(overrides: Partial<SessionContext> = {}): SessionContext {
	return {
		roots: [{ uri: pathToFileURL(ROOT).href, name: "workspace" }],
		supportsRoots: true,
		supportsSampling: false,
		supportsSamplingTools: false,
		supportsElicitation: false,
		supportsElicitationForm: false,
		supportsElicitationUrl: false,
		...overrides
	};
}

beforeEach(() => {
	vi.mocked(inferOwnerFromSession).mockReset();
	vi.mocked(inferRepoFromSession).mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

describe("normalizeToolArguments", () => {
	it("returns non-object args as-is", () => {
		expect(normalizeToolArguments(null)).toBeNull();
		expect(normalizeToolArguments(undefined)).toBeUndefined();
		expect(normalizeToolArguments("raw")).toBe("raw");
		expect(normalizeToolArguments(42)).toBe(42);
	});

	it("parses a plain string scope as a repo name", () => {
		const result = normalizeToolArguments({ scope: "my-repo" });
		expect(result.scope).toEqual({ repo: "my-repo" });
	});

	it("parses a JSON-string scope object", () => {
		const result = normalizeToolArguments({ scope: '{"owner":"vheins","repo":"my-repo"}' });
		expect(result.scope).toEqual({ owner: "vheins", repo: "my-repo" });
	});

	it("treats a non-JSON string scope as a plain repo name", () => {
		const result = normalizeToolArguments({ scope: "{not-json}" });
		expect(result.scope).toEqual({ repo: "{not-json}" });
	});

	it("copies an object scope without mutating the caller's object", () => {
		const scope = { repo: "my-repo" };
		const result = normalizeToolArguments({ scope });
		expect(result.scope).toEqual({ repo: "my-repo" });
		expect(scope).toEqual({ repo: "my-repo" });
	});

	it("fills repo from session.repo and mirrors it into scope", () => {
		const result = normalizeToolArguments({ query: "q", scope: {} }, makeSession({ repo: "session-repo" }));
		expect(result.repo).toBe("session-repo");
		expect((result.scope as Record<string, unknown>).repo).toBe("session-repo");
	});

	it("falls back to inferRepoFromSession when no repo is provided", () => {
		vi.mocked(inferRepoFromSession).mockReturnValue("inferred-repo");
		const result = normalizeToolArguments({ query: "q" }, makeSession());
		expect(result.repo).toBe("inferred-repo");
		expect(inferRepoFromSession).toHaveBeenCalled();
	});

	it("fills owner from session.owner", () => {
		const result = normalizeToolArguments({ query: "q" }, makeSession({ owner: "acme" }));
		expect(result.owner).toBe("acme");
	});

	it("derives owner from an owner/repo argument without warning", () => {
		const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
		const result = normalizeToolArguments({ repo: "vheins/my-repo" });
		expect(result.owner).toBe("vheins");
		expect(result.repo).toBe("vheins/my-repo");
		expect(warnSpy).not.toHaveBeenCalled();
	});

	it("infers owner from the session and warns for slash-less repos", () => {
		const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
		vi.mocked(inferOwnerFromSession).mockReturnValue("vheins");
		const result = normalizeToolArguments({ repo: "my-repo" });
		expect(result.owner).toBe("vheins");
		expect(warnSpy).toHaveBeenCalled();
	});

	it("keeps an explicit empty owner repo-only even when session.owner is set", () => {
		const result = normalizeToolArguments({ owner: "", repo: "my-repo" }, makeSession({ owner: "acme" }));
		expect(result.owner).toBe("");
		expect(result.repo).toBe("my-repo");
		expect(inferOwnerFromSession).not.toHaveBeenCalled();
	});

	it("keeps an explicit empty owner repo-only even when the session could infer an owner", () => {
		const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
		vi.mocked(inferOwnerFromSession).mockReturnValue("vheins");
		const result = normalizeToolArguments({ owner: "", repo: "my-repo" }, makeSession({ owner: "acme" }));
		expect(result.owner).toBe("");
		expect(warnSpy).not.toHaveBeenCalled();
		expect(inferOwnerFromSession).not.toHaveBeenCalled();
	});

	it("does not inject a session owner into a memory scope when top-level owner is explicitly empty", () => {
		vi.mocked(inferOwnerFromSession).mockReturnValue("vheins");
		const result = normalizeToolArguments({
			owner: "",
			repo: "my-repo",
			memories: [{ scope: { repo: "my-repo" } }]
		});
		const memories = result.memories as Array<{ scope: Record<string, unknown> }>;
		expect(result.owner).toBe("");
		expect(memories[0].scope.repo).toBe("my-repo");
		expect(memories[0].scope.owner).toBeUndefined();
		expect(inferOwnerFromSession).not.toHaveBeenCalled();
	});

	it("fills scope.owner from an owner/repo scoped repo even when top-level owner is explicitly empty", () => {
		const result = normalizeToolArguments({ owner: "", repo: "my-repo", scope: { repo: "vheins/scoped-repo" } });
		expect(result.owner).toBe("");
		expect((result.scope as { owner?: string }).owner).toBe("vheins");
		expect(inferOwnerFromSession).not.toHaveBeenCalled();
	});

	it("keeps an explicit empty scope.owner as-is", () => {
		vi.mocked(inferOwnerFromSession).mockReturnValue("vheins");
		const result = normalizeToolArguments({ scope: { repo: "my-repo", owner: "" } }, makeSession({ owner: "acme" }));
		expect((result.scope as { owner?: string }).owner).toBe("");
		expect(inferOwnerFromSession).not.toHaveBeenCalled();
	});

	it("fills scope.owner from the scoped repo", () => {
		const result = normalizeToolArguments({ scope: { repo: "vheins/my-repo" } });
		expect((result.scope as { owner?: string }).owner).toBe("vheins");
	});

	it("fills owner/repo into memory scope objects", () => {
		const result = normalizeToolArguments({
			memories: [{ scope: { repo: "vheins/my-repo" } }, { scope: {} }]
		});
		const memories = result.memories as Array<{ scope: Record<string, unknown> }>;
		expect(memories[0].scope.owner).toBe("vheins");
		expect(memories[0].scope.repo).toBe("vheins/my-repo");
		// No repo context available for the second memory — scope stays untouched.
		expect(memories[1].scope).toEqual({});
	});

	it("derives scope.folder from an absolute current_file_path inside a root", () => {
		const filePath = path.join(ROOT, "src/mcp/utils/normalize-args.ts");
		const result = normalizeToolArguments({ scope: {}, current_file_path: filePath }, makeSession());
		expect((result.scope as { folder?: string }).folder).toBe("src/mcp/utils");
	});

	it("does not derive scope.folder from a relative current_file_path", () => {
		const result = normalizeToolArguments(
			{ scope: {}, current_file_path: "src/mcp/utils/normalize-args.ts" },
			makeSession()
		);
		expect((result.scope as { folder?: string }).folder).toBeUndefined();
	});

	it("throws when a path argument escapes the active roots", () => {
		expect(() => normalizeToolArguments({ scope: {}, current_file_path: "/tmp/outside.ts" }, makeSession())).toThrow(
			"current_file_path must stay within the active MCP roots"
		);
	});

	it("keeps explicit agent/model args", () => {
		const result = normalizeToolArguments({ agent: "custom", model: "m1" });
		expect(result.agent).toBe("custom");
		expect(result.model).toBe("m1");
	});

	it("falls back to session lastSeenAgent/lastSeenModel", () => {
		const result = normalizeToolArguments(
			{ query: "q" },
			makeSession({ lastSeenAgent: "sess-agent", lastSeenModel: "sess-model" })
		);
		expect(result.agent).toBe("sess-agent");
		expect(result.model).toBe("sess-model");
	});

	it("falls back to clientName and env vars for agent/model", () => {
		vi.stubEnv("MCP_CLIENT_NAME", "env-client");
		vi.stubEnv("MCP_MODEL", "env-model");
		const result = normalizeToolArguments({ query: "q" }, makeSession({ clientName: "client-x" }));
		expect(result.agent).toBe("client-x");
		expect(result.model).toBe("env-model");
	});
});

describe("validateRootBoundPath", () => {
	it("accepts relative and in-root absolute paths", () => {
		const session = makeSession();
		expect(() => validateRootBoundPath("src/foo.ts", "current_file_path", session)).not.toThrow();
		expect(() => validateRootBoundPath(path.join(ROOT, "src/foo.ts"), "current_file_path", session)).not.toThrow();
	});

	it("ignores non-string values", () => {
		expect(() => validateRootBoundPath(undefined, "doc_path")).not.toThrow();
		expect(() => validateRootBoundPath(42, "doc_path")).not.toThrow();
	});

	it("throws for absolute paths outside the roots", () => {
		expect(() => validateRootBoundPath("/tmp/outside", "doc_path", makeSession())).toThrow(
			"doc_path must stay within the active MCP roots"
		);
	});

	it("allows any absolute path when no roots are registered", () => {
		const session = makeSession({ roots: [] });
		expect(() => validateRootBoundPath("/tmp/anything", "current_file_path", session)).not.toThrow();
	});
});
