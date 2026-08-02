/**
 * Creates a visibility-gated poller that pauses when the document is hidden
 * and resumes (with an immediate fetch) when it becomes visible again.
 *
 * SSR contract: when `document` is unavailable (SSR / jsdom-less tests),
 * the poller is a no-op — no interval, no listener, no initial fetch.
 *
 * @param fetchFn  Called on each tick (only when document is visible).
 * @param intervalMs  Polling interval in milliseconds.
 * @returns `{ start(); stop() }` — call start() to begin, stop() to clean up.
 */
export function createVisibilityPoller(
	fetchFn: () => void | Promise<void>,
	intervalMs: number
): { start(): void; stop(): void } {
	let intervalId: ReturnType<typeof setInterval> | null = null;
	let onVisibilityChange: (() => void) | null = null;

	function start(): void {
		// Guard: no DOM → no-op (SSR / test without jsdom)
		if (typeof document === "undefined") return;

		// Already running — guard against double-start
		if (intervalId !== null) return;

		const tick = () => {
			if (document.visibilityState === "visible") {
				void fetchFn();
			}
		};

		intervalId = setInterval(tick, intervalMs);

		onVisibilityChange = () => {
			if (document.visibilityState === "visible") {
				void fetchFn();
			}
		};
		document.addEventListener("visibilitychange", onVisibilityChange);
	}

	function stop(): void {
		if (intervalId !== null) {
			clearInterval(intervalId);
			intervalId = null;
		}
		if (onVisibilityChange && typeof document !== "undefined") {
			document.removeEventListener("visibilitychange", onVisibilityChange);
			onVisibilityChange = null;
		}
	}

	return { start, stop };
}
