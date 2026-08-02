/**
 * Unit tests for src/mcp/utils/action-log.ts — the unified action-log policy
 * (logAction / logActions) used by EVERY tool call across both transports and
 * the dashboard controllers.
 *
 * POLICY under test (TASK-104): action_log INSERTs never acquire the file
 * lock; logging never throws — a logging failure must never break the request
 * it audits.
 *
 * Mock strategy: a minimal `db` shaped like SQLiteStore is injected, exactly
 * mirroring the router.test.ts mock convention. No real DB / proper-lockfile.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { logAction, logActions, type ActionLogEntry } from "../utils/action-log";
import { logger } from "../utils/logger";
import type { SQLiteStore } from "../storage/sqlite";

function makeMockDb(actionsImpl?: () => void) {
	const logActionSpy = vi.fn(actionsImpl ?? (() => undefined));
	const db = {
		actions: { logAction: logActionSpy }
	} as unknown as SQLiteStore;
	return { db, logActionSpy };
}

describe("logAction", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("forwards action/owner/repo/options to db.actions.logAction", () => {
		const { db, logActionSpy } = makeMockDb();
		const options = { query: "search", resultCount: 3 };

		logAction(db, "memory-read", "owner-x", "repo-y", options);

		expect(logActionSpy).toHaveBeenCalledTimes(1);
		expect(logActionSpy).toHaveBeenCalledWith("memory-read", "owner-x", "repo-y", options);
	});

	it("passes options through unchanged (incl. response object + ids)", () => {
		const { db, logActionSpy } = makeMockDb();
		const options = {
			response: { structuredContent: { success: true } },
			memoryId: "mem-1",
			taskId: "task-1"
		};

		logAction(db, "task-write", "o", "r", options);

		expect(logActionSpy).toHaveBeenCalledWith("task-write", "o", "r", options);
	});

	it("passes undefined options when omitted", () => {
		const { db, logActionSpy } = makeMockDb();

		logAction(db, "memory-read", "o", "r");

		expect(logActionSpy).toHaveBeenCalledWith("memory-read", "o", "r", undefined);
	});

	it("never throws when the entity insert fails — logs via logger.error instead", () => {
		const { db } = makeMockDb(() => {
			throw new Error("db locked");
		});
		const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined);

		expect(() => logAction(db, "memory-read", "o", "r")).not.toThrow();
		expect(errorSpy).toHaveBeenCalledWith("Failed to log action", {
			action: "memory-read",
			repo: "r",
			error: "Error: db locked"
		});
	});
});

describe("logActions (batch)", () => {
	let logActionSpy: ReturnType<typeof vi.fn>;
	let transactionBody: ((rows: ActionLogEntry[]) => void) | undefined;
	let db: SQLiteStore;

	beforeEach(() => {
		logActionSpy = vi.fn();
		// Mirror better-sqlite3's transaction(fn).immediate(rows) contract:
		// the wrapper captures the body and executes it synchronously.
		transactionBody = undefined;
		const transaction = vi.fn((body: (rows: ActionLogEntry[]) => void) => {
			transactionBody = body;
			return {
				immediate: (rows: ActionLogEntry[]) => {
					transactionBody?.(rows);
				}
			};
		});
		db = {
			db: { transaction } as unknown as SQLiteStore["db"],
			actions: { logAction: logActionSpy }
		} as unknown as SQLiteStore;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("logs every entry with its own options inside one transaction", () => {
		const entries: ActionLogEntry[] = [
			{ action: "memory-read", owner: "o", repo: "r", options: { resultCount: 2 } },
			{ action: "task-write", owner: "o", repo: "r" }
		];

		logActions(db, entries);

		expect(logActionSpy).toHaveBeenCalledTimes(2);
		expect(logActionSpy).toHaveBeenNthCalledWith(1, "memory-read", "o", "r", { resultCount: 2 });
		expect(logActionSpy).toHaveBeenNthCalledWith(2, "task-write", "o", "r", undefined);
	});

	it("is a no-op for an empty entry list (no transaction started)", () => {
		logActions(db, []);

		expect(db.db.transaction as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
		expect(logActionSpy).not.toHaveBeenCalled();
	});

	it("never throws on batch failure — logs via logger.error instead", () => {
		const failingDb = {
			db: {
				transaction: vi.fn(() => {
					throw new Error("tx failed");
				})
			} as unknown as SQLiteStore["db"],
			actions: { logAction: vi.fn() }
		} as unknown as SQLiteStore;
		const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined);

		expect(() => logActions(failingDb, [{ action: "memory-read", owner: "o", repo: "r" }])).not.toThrow();
		expect(errorSpy).toHaveBeenCalledWith("Failed to log actions (batch)", {
			count: 1,
			error: "Error: tx failed"
		});
	});
});
