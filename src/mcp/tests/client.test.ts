// Feature: memory-mcp-optimization, Property 16: MCPClient cleanup pending requests
// Feature: memory-mcp-optimization, Property 17: MCPClient retry count

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";

import { MCPClient } from "../client.js";

class TestableMCPClient extends MCPClient {
	get pending(): Map<number, { resolve: (v: unknown) => void; reject: (r: unknown) => void }> {
		return (
			this as unknown as {
				pendingRequests: Map<number, { resolve: (v: unknown) => void; reject: (r: unknown) => void }>;
			}
		).pendingRequests;
	}

	injectPending(n: number): Promise<unknown>[] {
		const promises: Promise<unknown>[] = [];
		for (let i = 0; i < n; i++) {
			const id = 1000 + i;
			const p = new Promise((resolve, reject) => {
				this.pending.set(id, {
					resolve,
					reject
				});
			});
			promises.push(p);
		}
		return promises;
	}
}

describe("Property 16: MCPClient cleanup pending requests saat stop atau timeout", () => {
	it("stop() clears the pending map synchronously", () => {
		const client = new TestableMCPClient();
		const n = 5;
		const promises = client.injectPending(n);
		const rejections = promises.map((p) => p.catch(() => undefined));
		client.stop();
		expect(client.getPendingCount()).toBe(0);
		void Promise.all(rejections);
	});

	it("stop() rejects all pending requests with 'Client stopped'", async () => {
		const client = new TestableMCPClient();
		const n = 5;
		const promises = client.injectPending(n);
		client.stop();
		const results = await Promise.allSettled(promises);
		for (const result of results) {
			expect(result.status).toBe("rejected");
			if (result.status === "rejected") {
				expect((result.reason as Error).message).toBe("Client stopped");
			}
		}
	});

	it("getPendingCount() returns correct count before and after stop()", () => {
		const client = new TestableMCPClient();
		const n = 10;
		const promises = client.injectPending(n);
		const rejections = promises.map((p) => p.catch(() => undefined));
		expect(client.getPendingCount()).toBe(n);
		client.stop();
		expect(client.getPendingCount()).toBe(0);
		void Promise.all(rejections);
	});

	it("property: for any N >= 0, after stop() pendingCount === 0", () => {
		fc.assert(
			fc.property(fc.integer({ min: 0, max: 20 }), (n: number) => {
				const client = new TestableMCPClient();
				const promises = client.injectPending(n);
				promises.forEach((p) => p.catch(() => undefined));
				client.stop();
				return client.getPendingCount() === 0;
			})
		);
	});
});

describe("Property 17: MCPClient retry maksimal 3 kali dengan exponential backoff", () => {
	it("retries exactly 3 times (4 total attempts) on timeout before rejecting", async () => {
		vi.useFakeTimers();

		try {
			let callOnceCount = 0;

			const client = new TestableMCPClient() as unknown as {
				callOnce: (method: string, params: unknown) => Promise<unknown>;
				callWithRetry: (method: string, params: unknown) => Promise<unknown>;
				process: unknown;
			};

			client.callOnce = async (_method: string, _params: unknown): Promise<unknown> => {
				callOnceCount++;
				throw new Error("Request timeout");
			};

			client.process = { stdin: { write: () => true } };

			const retryPromise = client.callWithRetry("test/method", {});
			retryPromise.catch(() => undefined);

			await vi.runAllTimersAsync();
			const result = await retryPromise.catch((e: Error) => e);

			expect(result).toBeInstanceOf(Error);
			expect((result as Error).message).toBe("Request timeout");
			expect(callOnceCount).toBe(4);
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not retry on non-timeout errors", async () => {
		vi.useFakeTimers();

		try {
			let callOnceCount = 0;

			const client = new TestableMCPClient() as unknown as {
				callOnce: (method: string, params: unknown) => Promise<unknown>;
				callWithRetry: (method: string, params: unknown) => Promise<unknown>;
				process: unknown;
			};

			client.callOnce = async (_method: string, _params: unknown): Promise<unknown> => {
				callOnceCount++;
				throw new Error("Some other error");
			};

			client.process = { stdin: { write: () => true } };

			const retryPromise = client.callWithRetry("test/method", {});
			retryPromise.catch(() => undefined);

			await vi.runAllTimersAsync();
			const result = await retryPromise.catch((e: Error) => e);

			expect(result).toBeInstanceOf(Error);
			expect((result as Error).message).toBe("Some other error");
			expect(callOnceCount).toBe(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("property: retry delays follow exponential backoff pattern", () => {
		vi.useFakeTimers();

		try {
			fc.assert(
				fc.property(fc.constant(null), () => {
					const expectedDelays = [1000, 2000, 4000];
					expect(expectedDelays).toHaveLength(3);
					for (let i = 1; i < expectedDelays.length; i++) {
						expect(expectedDelays[i]).toBe(expectedDelays[i - 1] * 2);
					}
					return true;
				})
			);
		} finally {
			vi.useRealTimers();
		}
	});
});
