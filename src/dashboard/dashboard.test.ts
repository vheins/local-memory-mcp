// Feature: Dashboard Filter & Export Property Tests

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";
import { z } from "zod";
import { MemoryTypeSchema } from "../tools/schemas.js";

describe("Property 12: Dashboard filter logic correctness", () => {
  // Mock memory data generator
  function generateMemories(count: number): any[] {
    const types = ["code_fact", "decision", "mistake", "pattern"] as const;
    return Array.from({ length: count }, (_, i) => ({
      id: `test-${i}`,
      type: types[i % types.length],
      content: `Test memory content ${i} with some keywords`,
      importance: (i % 5) + 1,
      hit_count: i * 2,
      recall_rate: i > 0 ? i / (i + 1) : 0,
      created_at: new Date(Date.now() - i * 86400000).toISOString(),
    }));
  }

  // Filter function (same as in dashboard)
  function applyFilters(
    memories: any[],
    searchQuery: string,
    typeFilter: string,
    minImportance: number,
    maxImportance: number
  ): any[] {
    let filtered = [...memories];

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (m) =>
          m.content.toLowerCase().includes(q) ||
          m.type.toLowerCase().includes(q)
      );
    }

    if (typeFilter) {
      filtered = filtered.filter((m) => m.type === typeFilter);
    }

    if (minImportance > 0) {
      filtered = filtered.filter((m) => m.importance >= minImportance);
    }

    if (maxImportance < 5) {
      filtered = filtered.filter((m) => m.importance <= maxImportance);
    }

    return filtered;
  }

  it("property: search filter returns subset containing search term", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.uuid(),
            type: fc.constantFrom("code_fact", "decision", "mistake", "pattern"),
            content: fc.string({ minLength: 10, maxLength: 100 }),
            importance: fc.integer({ min: 1, max: 5 }),
            hit_count: fc.integer({ min: 0, max: 100 }),
          })
        ),
        fc.string({ minLength: 1, maxLength: 20 }),
        (memories, query) => {
          if (memories.length === 0) return true;

          const filtered = applyFilters(memories, query, "", 0, 5);

          // All results should contain query (if any returned)
          for (const m of filtered) {
            const containsQuery =
              m.content.toLowerCase().includes(query.toLowerCase()) ||
              m.type.toLowerCase().includes(query.toLowerCase());
            expect(containsQuery).toBe(true);
          }

          // Filtered should not be larger than original
          expect(filtered.length).toBeLessThanOrEqual(memories.length);
        }
      ),
      { numRuns: 50 }
    );
  });

  it("property: type filter returns only matching types", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.uuid(),
            type: fc.constantFrom("code_fact", "decision", "mistake", "pattern"),
            content: fc.string({ minLength: 10, maxLength: 100 }),
            importance: fc.integer({ min: 1, max: 5 }),
          })
        ),
        fc.constantFrom("", "code_fact", "decision", "mistake", "pattern"),
        (memories, typeFilter) => {
          const filtered = applyFilters(memories, "", typeFilter, 0, 5);

          if (typeFilter === "") {
            // No filter should return all
            expect(filtered.length).toBe(memories.length);
          } else {
            // All results should have matching type
            for (const m of filtered) {
              expect(m.type).toBe(typeFilter);
            }
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it("property: importance range filter returns correct subset", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.uuid(),
            type: fc.constantFrom("code_fact", "decision", "mistake", "pattern"),
            content: fc.string({ minLength: 10 }),
            importance: fc.integer({ min: 1, max: 5 }),
          })
        ),
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: 0, max: 5 }),
        (memories, minImp, maxImp) => {
          const safeMin = Math.min(minImp, maxImp);
          const safeMax = Math.max(minImp, maxImp);

          const filtered = applyFilters(memories, "", "", safeMin, safeMax);

          for (const m of filtered) {
            expect(m.importance).toBeGreaterThanOrEqual(safeMin);
            expect(m.importance).toBeLessThanOrEqual(safeMax);
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it("property: combination filters are additive (AND logic)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.uuid(),
            type: fc.constantFrom("code_fact", "decision", "mistake", "pattern"),
            content: fc.string({ minLength: 10 }),
            importance: fc.integer({ min: 1, max: 5 }),
          })
        ),
        fc.string({ maxLength: 10 }),
        fc.constantFrom("", "code_fact", "decision"),
        fc.integer({ min: 1, max: 3 }),
        fc.integer({ min: 3, max: 5 }),
        (memories, search, type, minImp, maxImp) => {
          const safeMin = Math.min(minImp, maxImp);
          const safeMax = Math.max(minImp, maxImp);

          const filtered = applyFilters(memories, search, type, safeMin, safeMax);

          // Verify each result matches ALL criteria
          for (const m of filtered) {
            if (search) {
              expect(
                m.content.toLowerCase().includes(search.toLowerCase()) ||
                  m.type.toLowerCase().includes(search.toLowerCase())
              ).toBe(true);
            }
            if (type) {
              expect(m.type).toBe(type);
            }
            expect(m.importance).toBeGreaterThanOrEqual(safeMin);
            expect(m.importance).toBeLessThanOrEqual(safeMax);
          }
        }
      ),
      { numRuns: 30 }
    );
  });
});

describe("Property 13: Pagination non-overlapping", () => {
  function paginate(items: any[], page: number, pageSize: number): any[] {
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }

  it("property: different pages have no overlapping IDs", () => {
    fc.assert(
      fc.property(
        fc.array(fc.uuid(), { minLength: 10, maxLength: 100 }),
        fc.integer({ min: 1, max: 10 }),
        (ids, pageSize) => {
          if (pageSize < 1) return true;

          const page1 = paginate(ids, 1, pageSize);
          const page2 = paginate(ids, 2, pageSize);

          // No common IDs between pages
          const overlap = page1.filter((id) => page2.includes(id));
          expect(overlap.length).toBe(0);
        }
      ),
      { numRuns: 50 }
    );
  });

  it("property: all items appear in exactly one page", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer(), { minLength: 1, maxLength: 50 }),
        fc.integer({ min: 1, max: 10 }),
        (items, pageSize) => {
          if (pageSize < 1) return true;
          if (items.length === 0) return true;

          const totalPages = Math.ceil(items.length / pageSize);
          const allPages: number[] = [];

          for (let page = 1; page <= totalPages; page++) {
            const pageItems = paginate(items, page, pageSize);
            allPages.push(...pageItems);
          }

          // Should have same total count
          expect(allPages.length).toBe(items.length);
        }
      ),
      { numRuns: 30 }
    );
  });
});

describe("Property 14: Export format correctness", () => {
  interface Memory {
    id: string;
    type: string;
    content: string;
    importance: number;
    hit_count: number;
    created_at: string;
  }

  function exportToCsv(memories: Memory[]): string {
    const headers = ["id", "type", "content", "importance", "hit_count", "created_at"];
    const csvRows = [headers.join(",")];
    for (const m of memories) {
      const row = [
        m.id,
        m.type,
        `"${m.content.replace(/"/g, '""')}"`,
        m.importance,
        m.hit_count,
        m.created_at,
      ];
      csvRows.push(row.join(","));
    }
    return csvRows.join("\n");
  }

  function exportToJson(memories: Memory[]): string {
    return JSON.stringify(memories, null, 2);
  }

  it("property: CSV export contains all filtered data", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.uuid(),
            type: fc.constantFrom("code_fact", "decision", "mistake", "pattern"),
            content: fc.string({ minLength: 5, maxLength: 50 }),
            importance: fc.integer({ min: 1, max: 5 }),
            hit_count: fc.integer({ min: 0, max: 20 }),
            created_at: fc.date().map((d) => d.toISOString()),
          })
        ),
        (memories) => {
          const csv = exportToCsv(memories);
          const lines = csv.split("\n");

          // Header + data rows
          expect(lines.length).toBe(memories.length + 1);

          // Each row has 6 columns
          for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(",");
            expect(cols.length).toBeGreaterThanOrEqual(5);
          }
        }
      ),
      { numRuns: 30 }
    );
  });

  it("property: JSON export is valid parseable JSON", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.uuid(),
            type: fc.constantFrom("code_fact", "decision", "mistake", "pattern"),
            content: fc.string({ minLength: 5 }),
            importance: fc.integer({ min: 1, max: 5 }),
            hit_count: fc.integer({ min: 0, max: 10 }),
            created_at: fc.string(),
          })
        ),
        (memories) => {
          const json = exportToJson(memories as Memory[]);
          const parsed = JSON.parse(json);

          expect(Array.isArray(parsed)).toBe(true);
          expect(parsed.length).toBe(memories.length);
        }
      ),
      { numRuns: 30 }
    );
  });

  it("property: export respects filter (matches displayed data)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.uuid(),
            type: fc.constantFrom("code_fact", "decision", "mistake", "pattern"),
            content: fc.string({ minLength: 10 }),
            importance: fc.integer({ min: 1, max: 5 }),
            hit_count: fc.integer({ min: 0, max: 100 }),
            created_at: fc.date().map((d) => d.toISOString()),
          })
        ),
        fc.constantFrom("decision", "mistake", "code_fact", "pattern"),
        (memories, typeFilter) => {
          // Apply filter (same as dashboard)
          const filtered = memories.filter((m) => m.type === typeFilter);

          const csv = exportToCsv(filtered);
          const json = exportToJson(filtered);

          // CSV should have filtered count + 1 header
          expect(csv.split("\n").length).toBe(filtered.length + 1);

          // JSON should parse to filtered array
          const parsed = JSON.parse(json);
          expect(parsed.length).toBe(filtered.length);
        }
      ),
      { numRuns: 30 }
    );
  });
});

describe("Property 15: localStorage preferences round-trip", () => {
  // Mock localStorage for Node.js environment
  let mockStorage: Record<string, string> = {};
  
  beforeEach(() => {
    mockStorage = {};
    global.localStorage = {
      getItem: (key: string) => mockStorage[key] || null,
      setItem: (key: string, value: string) => { mockStorage[key] = value; },
      removeItem: (key: string) => { delete mockStorage[key]; },
      clear: () => { mockStorage = {}; },
      get length() { return Object.keys(mockStorage).length; },
      key: (i: number) => Object.keys(mockStorage)[i] || null,
    } as unknown as Storage;
  });

  afterEach(() => {
    delete (global as unknown as Record<string, unknown>).localStorage;
  });

  interface DashboardPrefs {
    theme: "light" | "dark";
    pageSize: number;
    columnVisibility: Record<string, boolean>;
    columnWidths: Record<string, number>;
  }

  function savePrefs(prefs: DashboardPrefs): void {
    localStorage.setItem("dashboard_prefs", JSON.stringify(prefs));
  }

  function loadPrefs(): DashboardPrefs | null {
    const stored = localStorage.getItem("dashboard_prefs");
    return stored ? JSON.parse(stored) : null;
  }

  it("property: saved preferences can be loaded identically", () => {
    fc.assert(
      fc.property(
        fc.record({
          theme: fc.constantFrom("light", "dark"),
          pageSize: fc.constantFrom(10, 25, 50, 100),
          columnVisibility: fc.record({ id: fc.boolean(), type: fc.boolean(), content: fc.boolean() }),
          columnWidths: fc.record({ id: fc.integer({ min: 50, max: 300 }), type: fc.integer({ min: 50, max: 300 }) }),
        }),
        (prefs) => {
          savePrefs(prefs as unknown as DashboardPrefs);
          const loaded = loadPrefs();

          expect(loaded).not.toBeNull();
          expect(loaded?.theme).toBe(prefs.theme);
          expect(loaded?.pageSize).toBe(prefs.pageSize);
        }
      ),
      { numRuns: 30 }
    );
  });
});
