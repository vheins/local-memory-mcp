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
		hookTimeout: 30_000,

		// ------------------------------------------------------------------
		// Coverage (ROOT level only — `coverage` is NOT allowed inside a
		// project config; vitest.dev/guide/projects "Unsupported Options").
		//
		// Thresholds are configured but NOT blocking: the v8 provider fails
		// the run (exit 1) on missed thresholds with no warn-only mode, and
		// the suite does not reach the floor yet (docs/testing.md §7 — the
		// green gate is REFACTOR-TST-012). Coverage is therefore flag-gated
		// (`--coverage`); REFACTOR-TST-013 flips `enabled: true` for the CI
		// gate once the floor is met.
		// ------------------------------------------------------------------
		coverage: {
			provider: "v8",
			// enabled: true, // TODO(REFACTOR-TST-013): flip when CI gate lands
			reporter: ["text", "text-summary", "json", "html"],
			// All-of-src semantics: including the pattern pulls untested files
			// into the report (Vitest's equivalent of jest/nyc `thresholds.all`).
			include: ["src/**/*.{ts,tsx}"],
			exclude: ["dist/**", "node_modules/**", "src/dashboard/ui/node_modules/**"],
			thresholds: {
				// Global floors across ALL files matched by `coverage.include`
				// (docs/testing.md §7). NOTE: `thresholds.all` is a jest/nyc
				// option with NO Vitest equivalent — Vitest would parse `all`
				// as a file-glob key (silent no-op). `coverage.include` + these
				// global floors is the correct all-files encoding.
				lines: 70,
				statements: 70,
				functions: 70,
				branches: 60
			}
		},

		// ------------------------------------------------------------------
		// Suite groups (Vitest 4: `workspace` was deprecated since 3.2 and
		// replaced by `projects`). The root config is NOT a project itself —
		// only global options (reporters/coverage) apply at root. Each project
		// uses `extends: true` to inherit pool `forks`, env `node`, excludes
		// and timeouts. `include` patterns PARTITION the taxonomy so no test
		// file runs in two projects (verified: unit 106 / integration 3 /
		// e2e 1 / perf 1, zero overlap, zero orphans).
		// ------------------------------------------------------------------
		projects: [
			{
				extends: true,
				test: {
					name: "unit",
					include: ["**/*.test.ts", "!**/*.integration.test.ts", "!**/*.e2e.test.ts", "!**/*.perf.test.ts"]
				}
			},
			{
				extends: true,
				test: {
					name: "integration",
					include: ["**/*.integration.test.ts"]
				}
			},
			{
				extends: true,
				test: {
					name: "e2e",
					include: ["**/*.e2e.test.ts"]
				}
			},
			{
				extends: true,
				test: {
					name: "perf",
					include: ["**/*.perf.test.ts"]
				}
			}
		]
	}
});
