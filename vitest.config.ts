import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Use forks pool for better-sqlite3 compatibility with ESM
    pool: "forks",
    // Support ESM
    environment: "node",
    exclude: ["dist/**", "node_modules/**"],
  },
});
