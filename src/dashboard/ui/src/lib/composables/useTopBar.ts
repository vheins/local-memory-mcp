import { writable } from "svelte/store";
import { theme } from "../stores";
import { getRepoInitials } from "../utils";

export const GITHUB_URL = "https://github.com/vheins/local-memory-mcp";
export const NPM_URL = "https://www.npmjs.com/package/@vheins/local-memory-mcp";

export function createTopBarHandler(onRefresh: () => void) {
	const countdownSeconds = writable(30);
	const refreshing = writable(false);
	const npmDownloads = writable<number | null>(null);
	const npmLoading = writable(true);

	let countdownTimer: ReturnType<typeof setInterval>;
	const NPM_PKG = "@vheins/local-memory-mcp";

	function formatDownloads(n: number): string {
		if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
		if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
		return String(n);
	}

	async function fetchNpmDownloads() {
		try {
			const res = await fetch(`https://api.npmjs.org/downloads/point/last-month/${NPM_PKG}`);
			if (res.ok) {
				const data = await res.json();
				npmDownloads.set(data.downloads ?? null);
			}
		} catch {
			npmDownloads.set(null);
		} finally {
			npmLoading.set(false);
		}
	}

	function toggleTheme() {
		theme.update((t: string) => (t === "dark" ? "light" : "dark"));
	}

	function startCountdown() {
		clearInterval(countdownTimer);
		countdownSeconds.set(30);
		countdownTimer = setInterval(() => {
			countdownSeconds.update((s) => {
				if (s <= 1) {
					onRefresh();
					return 30;
				}
				return s - 1;
			});
		}, 1000);
	}

	async function manualRefresh() {
		refreshing.set(true);
		onRefresh();
		startCountdown();
		setTimeout(() => refreshing.set(false), 800);
	}

	function destroy() {
		clearInterval(countdownTimer);
	}

	return {
		countdownSeconds,
		refreshing,
		npmDownloads,
		npmLoading,
		formatDownloads,
		fetchNpmDownloads,
		toggleTheme,
		startCountdown,
		manualRefresh,
		getRepoInitials,
		destroy
	};
}
