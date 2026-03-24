// Feature: memory-mcp-optimization
// Property 20: StructuredLogger output adalah JSON valid dengan field wajib
// Validates: Requirements 21.1, 21.2

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";

// ─── Property 20: StructuredLogger output adalah JSON valid dengan field wajib ─
// Feature: memory-mcp-optimization, Property 20: StructuredLogger output JSON valid

type LogLevel = "debug" | "info" | "warn" | "error";

describe("Property 20: StructuredLogger output adalah JSON valid dengan field wajib", () => {
  let stderrOutput: string[] = [];
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrOutput = [];
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderrOutput.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    });
    // Reset LOG_LEVEL to ensure all levels are logged
    process.env.LOG_LEVEL = "debug";
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    delete process.env.LOG_LEVEL;
  });

  it("each log call produces valid JSON output with required fields", async () => {
    // Re-import logger after setting LOG_LEVEL
    const { logger } = await import("./logger.js?t=" + Date.now());

    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant<LogLevel>("debug"),
          fc.constant<LogLevel>("info"),
          fc.constant<LogLevel>("warn"),
          fc.constant<LogLevel>("error")
        ),
        fc.string({ minLength: 1, maxLength: 100 }),
        (level: LogLevel, message: string) => {
          stderrOutput = [];
          logger[level](message);

          expect(stderrOutput.length).toBeGreaterThanOrEqual(1);
          const lastOutput = stderrOutput[stderrOutput.length - 1];

          // Must be parseable JSON
          let parsed: Record<string, unknown>;
          expect(() => {
            parsed = JSON.parse(lastOutput.trim());
          }).not.toThrow();

          parsed = JSON.parse(lastOutput.trim());

          // Must have required fields
          expect(parsed).toHaveProperty("level");
          expect(parsed).toHaveProperty("timestamp");
          expect(parsed).toHaveProperty("message");

          // level must match
          expect(parsed.level).toBe(level);

          // message must match
          expect(parsed.message).toBe(message);

          // timestamp must be ISO 8601
          expect(typeof parsed.timestamp).toBe("string");
          const ts = new Date(parsed.timestamp as string);
          expect(isNaN(ts.getTime())).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("log output with context includes context field", async () => {
    const { logger } = await import("./logger.js?t=" + Date.now() + "ctx");

    stderrOutput = [];
    logger.info("test message", { key: "value", count: 42 });

    expect(stderrOutput.length).toBeGreaterThanOrEqual(1);
    const lastOutput = stderrOutput[stderrOutput.length - 1];
    const parsed = JSON.parse(lastOutput.trim());

    expect(parsed).toHaveProperty("context");
    expect(parsed.context).toEqual({ key: "value", count: 42 });
  });

  it("log output without context does not include context field", async () => {
    const { logger } = await import("./logger.js?t=" + Date.now() + "noctx");

    stderrOutput = [];
    logger.info("no context message");

    expect(stderrOutput.length).toBeGreaterThanOrEqual(1);
    const lastOutput = stderrOutput[stderrOutput.length - 1];
    const parsed = JSON.parse(lastOutput.trim());

    expect(parsed).not.toHaveProperty("context");
  });

  it("all four log levels produce valid JSON with correct level field", async () => {
    const { logger } = await import("./logger.js?t=" + Date.now() + "levels");

    const levels: LogLevel[] = ["debug", "info", "warn", "error"];
    for (const level of levels) {
      stderrOutput = [];
      logger[level](`test ${level} message`);

      expect(stderrOutput.length).toBeGreaterThanOrEqual(1);
      const lastOutput = stderrOutput[stderrOutput.length - 1];
      const parsed = JSON.parse(lastOutput.trim());

      expect(parsed.level).toBe(level);
      expect(parsed.message).toBe(`test ${level} message`);
      expect(typeof parsed.timestamp).toBe("string");
    }
  });
});
