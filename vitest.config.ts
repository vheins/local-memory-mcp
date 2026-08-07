import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
	plugins: [svelte()],
	resolve: {
		// Ensure Svelte resolves to its client entry (mount, etc.) instead of server entry
		conditions: ["browser"]
	},
	test: {
		// Use forks pool for better-sqlite3 compatibility with ESM
		pool: "forks",
		// Support ESM
		environment: "node",
		exclude: ["dist/**", "node_modules/**", "src/dashboard/ui/node_modules/**"],
		testTimeout: 30_000,
		hookTimeout: 30_000
	}
});
