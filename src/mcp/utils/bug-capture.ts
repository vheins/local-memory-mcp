import crypto from "crypto";
import os from "os";
import type { SQLiteStore } from "../storage/sqlite";
import type { LogSink, LogSinkPayload } from "./logger";
import { logger } from "./logger";
import { BUG_TELEMETRY_ENABLED, BUG_TELEMETRY_MAX_ROWS, BUG_TELEMETRY_RETENTION_DAYS } from "./constants";

/** Where a captured bug originated. Explicit sources win over the derived logger name. */
export type BugSource = "uncaught" | "unhandled_rejection" | "tool" | "dashboard" | "server" | "logger";

export interface BugCaptureInput {
	source: string;
	severity?: string;
	message: string;
	stack?: string | null;
	context?: Record<string, unknown>;
}

/** Fully-resolved, redacted event handed to every sink. */
export interface BugEvent {
	fingerprint: string;
	source: string;
	severity: string;
	message: string;
	stack: string | null;
	context: Record<string, unknown>;
	runtime: Record<string, unknown>;
	occurredAt: string;
}

/**
 * Pluggable bug-telemetry sink. The core ships exactly one sink — the local
 * SQLite writer — so the default is local-first with no network dependency.
 * A remote sink (e.g. a Sentry forwarder) can be attached at runtime via
 * {@link BugCapture.addSink} without touching the capture pipeline.
 */
export interface BugSink {
	name: string;
	capture(event: BugEvent): void;
}

const SECRET_KEY = /(pass(word)?|secret|token|api[-_]?key|authorization|cookie|dsn)/i;

function redactString(input: string): string {
	let out = input;
	const home = os.homedir();
	if (home) out = out.split(home).join("~");
	out = out.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._\-+/=]+/gi, "$1 ***");
	out = out.replace(/\b(sk|ghp|gho|ghs|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{6,}/gi, "***");
	return out;
}

/** Recursively redact a value: home-dir paths, bearer tokens, and secret-named keys. */
export function redact(value: unknown): unknown {
	if (typeof value === "string") return redactString(value);
	if (Array.isArray(value)) return value.map(redact);
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
			out[key] = SECRET_KEY.test(key) ? "***" : redact(val);
		}
		return out;
	}
	return value;
}

/**
 * Strip volatile bits (line/column numbers, hex addresses) from a stack frame
 * so a fingerprint survives code edits that shift line numbers.
 */
function normalizeFrame(frame: string): string {
	return frame
		.trim()
		.replace(/:\d+:\d+/g, "")
		.replace(/:\d+/g, "")
		.replace(/0x[0-9a-f]+/gi, "");
}

/**
 * Stable dedup key: source + message + the first two normalized stack frames.
 * Two failures with the same shape (even at different line numbers) collapse
 * into one report with an incrementing count.
 */
export function computeFingerprint(source: string, message: string, stack?: string | null): string {
	const frames = (stack ?? "")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.startsWith("at "))
		.slice(0, 2)
		.map(normalizeFrame)
		.join("|");
	return crypto.createHash("sha1").update(`${source}\n${message}\n${frames}`).digest("hex");
}

function resolveSource(payload: LogSinkPayload): string {
	const explicit = payload.data?.source;
	if (typeof explicit === "string" && explicit.length > 0) return explicit;
	switch (payload.logger) {
		case "tool":
			return "tool";
		case "dashboard":
			return "dashboard";
		case "server":
			return "server";
		default:
			return "logger";
	}
}

function isCapturableLevel(level: string): boolean {
	return level === "error" || level === "critical" || level === "alert" || level === "emergency";
}

class BugCapture {
	private store: SQLiteStore | null = null;
	private readonly sinks = new Map<string, BugSink>();
	private lastPruneAt = 0;
	private readonly enabled = BUG_TELEMETRY_ENABLED;

	/**
	 * Attach the local SQLite sink. Called once per process (MCP server and
	 * dashboard) after the store is created. No-op when telemetry is disabled.
	 */
	bind(store: SQLiteStore): void {
		if (!this.enabled) return;
		this.store = store;
		this.sinks.set("local", {
			name: "local",
			capture: (event) => this.persist(event)
		});
	}

	/** Register an additional sink (e.g. a Sentry forwarder). Returns an unsubscribe fn. */
	addSink(sink: BugSink): () => void {
		this.sinks.set(sink.name, sink);
		return () => this.sinks.delete(sink.name);
	}

	/** Capture a bug. Never throws — bug telemetry must not break the caller. */
	capture(input: BugCaptureInput): void {
		if (!this.enabled || !this.store) return;
		try {
			const message = String(redact(input.message));
			const stack = input.stack ? String(redact(input.stack)) : null;
			const event: BugEvent = {
				fingerprint: computeFingerprint(input.source, message, stack),
				source: input.source,
				severity: input.severity ?? "error",
				message,
				stack,
				context: (redact(input.context ?? {}) as Record<string, unknown>) ?? {},
				runtime: {
					node: process.version,
					platform: process.platform,
					arch: process.arch,
					pid: process.pid
				},
				occurredAt: new Date().toISOString()
			};
			for (const sink of this.sinks.values()) {
				try {
					sink.capture(event);
				} catch (error) {
					logger.warn("[BugCapture] sink failed", { sink: sink.name, error: String(error) });
				}
			}
		} catch {
			/* never throw from telemetry */
		}
	}

	/**
	 * Logger sink adapter: captures error-and-above log entries. Registered as
	 * a log sink so tool failures, dashboard 5xx errors, and the process-level
	 * uncaught/unhandled handlers (all of which log via `logger.error`) flow
	 * into the bug store automatically.
	 */
	readonly logSink: LogSink = (payload) => {
		if (!isCapturableLevel(payload.level)) return;
		const data = payload.data ?? {};
		const message = typeof data.message === "string" ? data.message : "unknown error";
		const stack =
			typeof data.stack === "string"
				? data.stack
				: typeof data.error === "string" && data.error.includes("\n")
					? data.error
					: null;
		this.capture({ source: resolveSource(payload), severity: payload.level, message, stack, context: data });
	};

	/** Test/maintenance hook: drop the store binding and all sinks. */
	reset(): void {
		this.store = null;
		this.sinks.clear();
		this.lastPruneAt = 0;
	}

	private persist(event: BugEvent): void {
		if (!this.store) return;
		try {
			this.store.bugReports.upsert({
				fingerprint: event.fingerprint,
				source: event.source,
				severity: event.severity,
				message: event.message,
				stack: event.stack,
				context: event.context,
				runtime: event.runtime
			});
			this.pruneIfNeeded();
		} catch (error) {
			logger.warn("[BugCapture] persist failed", { error: String(error) });
		}
	}

	private pruneIfNeeded(): void {
		if (!this.store) return;
		const now = Date.now();
		if (now - this.lastPruneAt < 3_600_000) return;
		this.lastPruneAt = now;
		try {
			this.store.bugReports.prune(BUG_TELEMETRY_RETENTION_DAYS, BUG_TELEMETRY_MAX_ROWS);
		} catch {
			/* best effort */
		}
	}
}

export const bugCapture = new BugCapture();
