import path from "node:path";
import { fileURLToPath } from "node:url";

export type McpRoot = {
	uri: string;
	name?: string;
};

export type SessionContext = {
	clientInfo?: {
		name?: string;
		version?: string;
	};
	clientCapabilities?: Record<string, unknown>;
	roots: McpRoot[];
	supportsRoots: boolean;
	supportsSampling: boolean;
	supportsSamplingTools: boolean;
	supportsElicitation: boolean;
	supportsElicitationForm: boolean;
	supportsElicitationUrl: boolean;
};

export function createSessionContext(): SessionContext {
	return {
		roots: [],
		supportsRoots: false,
		supportsSampling: false,
		supportsSamplingTools: false,
		supportsElicitation: false,
		supportsElicitationForm: false,
		supportsElicitationUrl: false
	};
}

export function updateSessionFromInitialize(session: SessionContext, params: Record<string, unknown>): void {
	const capabilities = (params?.capabilities || {}) as Record<string, unknown>;
	session.clientInfo = params?.clientInfo as { name?: string; version?: string };
	session.clientCapabilities = capabilities;
	session.supportsRoots = Boolean(capabilities.roots);
	session.supportsSampling = Boolean(capabilities.sampling);
	session.supportsSamplingTools = Boolean(capabilities.sampling?.tools);
	session.supportsElicitation = Boolean(capabilities.elicitation);
	session.supportsElicitationForm = supportsElicitationMode(capabilities.elicitation, "form");
	session.supportsElicitationUrl = supportsElicitationMode(capabilities.elicitation, "url");
}

function supportsElicitationMode(capability: unknown, mode: "form" | "url"): boolean {
	if (!capability || typeof capability !== "object") {
		return false;
	}

	const cap = capability as Record<string, unknown>;

	if (mode === "form") {
		return Object.keys(cap).length === 0 || typeof cap.form === "object";
	}

	return typeof cap.url === "object";
}

export function updateSessionRoots(session: SessionContext, roots: McpRoot[]): boolean {
	const normalized = normalizeRoots(roots);
	const previous = JSON.stringify(session.roots);
	const next = JSON.stringify(normalized);
	session.roots = normalized;
	return previous !== next;
}

export function normalizeRoots(roots: unknown): McpRoot[] {
	if (!Array.isArray(roots)) return [];

	const seen = new Set<string>();
	const normalized: McpRoot[] = [];

	for (const root of roots) {
		if (!root || typeof root !== "object") continue;

		const r = root as Record<string, unknown>;
		const uri = typeof r.uri === "string" ? r.uri : undefined;
		const name = typeof r.name === "string" ? r.name : undefined;

		if (!uri || seen.has(uri)) continue;
		seen.add(uri);
		normalized.push({ uri, name });
	}

	return normalized;
}

export function extractRootsFromResult(result: unknown): McpRoot[] {
	return normalizeRoots((result as Record<string, unknown>)?.roots);
}

export function getFilesystemRoots(session?: SessionContext): string[] {
	if (!session) return [];

	const resolved: string[] = [];
	for (const root of session.roots) {
		if (!root.uri.startsWith("file://")) continue;
		try {
			resolved.push(path.resolve(fileURLToPath(root.uri)));
		} catch {
			// Ignore malformed file URIs.
		}
	}
	return resolved;
}

export function isPathWithinRoots(targetPath: string, session?: SessionContext): boolean {
	const roots = getFilesystemRoots(session);
	if (roots.length === 0) return true;

	const normalizedTarget = path.resolve(targetPath);
	return roots.some((rootPath) => {
		const relative = path.relative(rootPath, normalizedTarget);
		return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
	});
}

export function findContainingRoot(targetPath: string, session?: SessionContext): string | null {
	const roots = getFilesystemRoots(session);
	if (roots.length === 0) return null;

	const normalizedTarget = path.resolve(targetPath);
	for (const rootPath of roots) {
		const relative = path.relative(rootPath, normalizedTarget);
		if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
			return rootPath;
		}
	}

	return null;
}

export function inferRepoFromSession(session?: SessionContext): string | undefined {
	const roots = getFilesystemRoots(session);
	if (roots.length === 1) {
		return path.basename(roots[0]);
	}
	return undefined;
}
