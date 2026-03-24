import { describe, it, expect } from "vitest";
import { expandQuery } from "../utils/query-expander.js";

describe("expandQuery", () => {
  it("returns original query when no prompt provided", () => {
    expect(expandQuery("database")).toBe("database");
    expect(expandQuery("api endpoint")).toBe("api endpoint");
  });

  it("expands query with prompt keywords", () => {
    const result = expandQuery("database", "user authentication implementation");
    expect(result).toContain("database");
    expect(result).toContain("user");
    expect(result).toContain("auth");
  });

  it("expands known keywords", () => {
    const result = expandQuery("auth", "login system");
    expect(result).toContain("auth");
    expect(result).toContain("login");
    expect(result).toContain("password");
  });

  it("limits to 10 keywords", () => {
    const result = expandQuery("api", "building a rest endpoint with controller and route handling");
    const words = result.split(" ");
    expect(words.length).toBeLessThanOrEqual(10);
  });

  it("removes duplicates", () => {
    const result = expandQuery("database", "database query optimization");
    const words = result.split(" ");
    const unique = new Set(words);
    expect(words.length).toBe(unique.size);
  });

  it("handles empty prompt gracefully", () => {
    expect(expandQuery("test", "")).toBe("test");
  });
});
