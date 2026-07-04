// Feature: mcp-session
// Unit tests for session context functions
// Covers: inferOwnerFromSession, inferRepoFromSession

import { describe, it, expect } from "vitest";
import path from "node:path";
import { createSessionContext, inferOwnerFromSession, inferRepoFromSession } from "../session";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sessionWithRoots(uris: string[]) {
	const session = createSessionContext();
	session.roots = uris.map((uri) => ({ uri }));
	return session;
}

/** Build a file:// URI from an absolute path — ensures proper triple-slash format. */
function fileUri(absPath: string): string {
	return `file://${absPath.startsWith("/") ? "" : "/"}${absPath}`;
}

// ─── inferOwnerFromSession ────────────────────────────────────────────────────

describe("inferOwnerFromSession()", () => {
	it("returns the parent directory name when a single root exists with >= 2 path components", () => {
		const root = path.resolve("/Users", "alice", "myrepo");
		const session = sessionWithRoots([fileUri(root)]);
		expect(inferOwnerFromSession(session)).toBe("alice");
	});

	it("returns undefined when session has no roots", () => {
		const session = createSessionContext();
		expect(inferOwnerFromSession(session)).toBeUndefined();
	});

	it("returns undefined when session has a root with fewer than 2 path components", () => {
		const root = path.resolve("/myrepo");
		const session = sessionWithRoots([fileUri(root)]);
		expect(inferOwnerFromSession(session)).toBeUndefined();
	});

	it("returns undefined when session is undefined", () => {
		expect(inferOwnerFromSession()).toBeUndefined();
	});

	it("returns undefined when roots exist but none are file:// URIs", () => {
		const session = sessionWithRoots(["not-a-file-uri://some/path"]);
		expect(inferOwnerFromSession(session)).toBeUndefined();
	});

	it("returns undefined with clientInfo.name set and no roots (regression guard)", () => {
		const session = createSessionContext();
		session.clientInfo = { name: "claude-desktop", version: "1.0.0" };
		expect(inferOwnerFromSession(session)).toBeUndefined();
	});

	it("returns undefined when multiple roots exist", () => {
		const root1 = fileUri(path.resolve("/Users", "alice", "repo1"));
		const root2 = fileUri(path.resolve("/Users", "bob", "repo2"));
		const session = sessionWithRoots([root1, root2]);
		expect(inferOwnerFromSession(session)).toBeUndefined();
	});
});

// ─── inferRepoFromSession ─────────────────────────────────────────────────────

describe("inferRepoFromSession()", () => {
	it("returns the basename of a single root", () => {
		const root = path.resolve("/Users", "alice", "myrepo");
		const session = sessionWithRoots([fileUri(root)]);
		expect(inferRepoFromSession(session)).toBe("myrepo");
	});

	it("returns undefined when session has no roots", () => {
		const session = createSessionContext();
		expect(inferRepoFromSession(session)).toBeUndefined();
	});

	it("returns undefined when session is undefined", () => {
		expect(inferRepoFromSession()).toBeUndefined();
	});

	it("returns undefined when multiple roots exist", () => {
		const root1 = fileUri(path.resolve("/Users", "alice", "repo1"));
		const root2 = fileUri(path.resolve("/Users", "bob", "repo2"));
		const session = sessionWithRoots([root1, root2]);
		expect(inferRepoFromSession(session)).toBeUndefined();
	});
});
