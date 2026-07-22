# Test Scenarios: Codebase Index Tools

## Header & Navigation

- [Module Overview](./README.md)
- [Design — API Contracts](../../../design/codebase-index/api-contracts.md)
- [Design — Domain Model](../../../design/codebase-index/domain.md)
- [API Module](../api/codebase-index/README.md)

Verification scenarios for all 6 Codebase Index MCP tools. Tests validate tool contracts, data integrity, error handling, and edge case behavior against the domain model and API contracts.

## Scenario Format

| Column           | Description                                             |
| :--------------- | :------------------------------------------------------ |
| **Scenario**     | Unique test case name                                   |
| **Precondition** | Required state before test execution                    |
| **Steps**        | Action sequence                                         |
| **Expected**     | Verifiable outcome (status code, payload, side effects) |
| **Priority**     | P0 (must pass), P1 (should pass), P2 (nice to have)     |
| **Story Ref**    | Links to domain rules or API contract sections          |

---

## 1. `index_repository`

### 1.1 Positive — Fresh Index

| Field            | Value                                                                                                                                                                                                                                                                                                                                     |
| :--------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scenario**     | Index a project directory from scratch                                                                                                                                                                                                                                                                                                    |
| **Precondition** | Clean database, no existing index. Fixture project at `/tmp/test-project` containing 5 TypeScript files with known symbols and relations.                                                                                                                                                                                                 |
| **Steps**        | 1. Call `index_repository({ projectPath: "/tmp/test-project" })`                                                                                                                                                                                                                                                                          |
| **Expected**     | - `status` = `"completed"`<br>- `filesDiscovered` ≥ 5<br>- `filesIndexed` = `filesDiscovered - filesSkipped`<br>- `symbolsExtracted` > 0<br>- `relationsResolved` > 0<br>- `duration` > 0<br>- All file records in `codebase_files` have `status` = `"indexed"`<br>- All symbol records have valid `file_id` FKs<br>- No orphan relations |
| **Priority**     | P0                                                                                                                                                                                                                                                                                                                                        |
| **Story Ref**    | §4.1 Indexing Rules, §4.2 Symbol Rules                                                                                                                                                                                                                                                                                                    |

### 1.2 Positive — Incremental (No Changes)

| Field            | Value                                                                                                                                     |
| :--------------- | :---------------------------------------------------------------------------------------------------------------------------------------- |
| **Scenario**     | Re-index an unchanged project                                                                                                             |
| **Precondition** | Existing completed index from 1.1. No file modifications.                                                                                 |
| **Steps**        | 1. Call `index_repository({ projectPath: "/tmp/test-project" })`<br>2. Compare `symbolsExtracted` to first run                            |
| **Expected**     | - `status` = `"completed"`<br>- `filesIndexed` = 0 (no files changed)<br>- `symbolsExtracted` = 0<br>- Total symbol count in DB unchanged |
| **Priority**     | P0                                                                                                                                        |
| **Story Ref**    | §4.1 Idempotency rule, §4.5 Checksum Integrity                                                                                            |

### 1.3 Positive — Incremental (File Changed)

| Field            | Value                                                                                                                                                                |
| :--------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scenario**     | Re-index after modifying a single file                                                                                                                               |
| **Precondition** | Index from 1.1 complete. Modify one file (add a new function).                                                                                                       |
| **Steps**        | 1. Change `checksum` by appending a function to one fixture file<br>2. Call `index_repository()`                                                                     |
| **Expected**     | - `filesIndexed` = 1 (only changed file)<br>- `filesDeleted` = 0<br>- New function symbol present in `codebase_symbols`<br>- Total symbol count = previous count + 1 |
| **Priority**     | P0                                                                                                                                                                   |
| **Story Ref**    | §4.1 Incremental rule, §5.2 Incremental Re-Index                                                                                                                     |

### 1.4 Positive — File Deletion Detection

| Field            | Value                                                                                                                                              |
| :--------------- | :------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scenario**     | Detect deleted files during incremental re-index                                                                                                   |
| **Precondition** | Index from 1.1 complete. Delete one file from disk.                                                                                                |
| **Steps**        | 1. Remove one fixture file<br>2. Call `index_repository()`                                                                                         |
| **Expected**     | - `filesDeleted` = 1<br>- Deleted file's `status` set to `"stale"` or row removed via CASCADE<br>- All symbols from deleted file no longer present |
| **Priority**     | P1                                                                                                                                                 |
| **Story Ref**    | §4.4 Cascade Delete Rules                                                                                                                          |

### 1.5 Negative — Path Not Found

| Field            | Value                                                                                                        |
| :--------------- | :----------------------------------------------------------------------------------------------------------- |
| **Scenario**     | Index a non-existent directory                                                                               |
| **Precondition** | No directory at specified path.                                                                              |
| **Steps**        | 1. Call `index_repository({ projectPath: "/nonexistent/path" })`                                             |
| **Expected**     | - JSON-RPC error `-32603` or `McpResponse` with `isError: true`<br>- Error message contains `PATH_NOT_FOUND` |
| **Priority**     | P0                                                                                                           |
| **Story Ref**    | API Contracts §1.1 Error Cases                                                                               |

### 1.6 Negative — Path Outside Workspace

| Field            | Value                                                       |
| :--------------- | :---------------------------------------------------------- |
| **Scenario**     | Index a path outside configured MCP roots                   |
| **Precondition** | MCP roots set to `/home/user/projects`. No `/etc` in roots. |
| **Steps**        | 1. Call `index_repository({ projectPath: "/etc" })`         |
| **Expected**     | - `isError: true`<br>- Message: `PATH_OUTSIDE_WORKSPACE`    |
| **Priority**     | P0                                                          |
| **Story Ref**    | API Contracts §1.1 Error Cases                              |

### 1.7 Edge — Concurrent Index Requests

| Field            | Value                                                                                                                                            |
| :--------------- | :----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scenario**     | Attempt to start a second index while one is running                                                                                             |
| **Precondition** | First `index_repository` call in progress (simulated with a large fixture or mock).                                                              |
| **Steps**        | 1. Start `index_repository()` on a large project<br>2. Immediately call `index_repository()` again on same project                               |
| **Expected**     | - Second call returns `INDEX_IN_PROGRESS`<br>- `structuredContent.data.status` = `"in_progress"`<br>- Progress stats reflect the first operation |
| **Priority**     | P1                                                                                                                                               |
| **Story Ref**    | §4.1 Business Rule #5: Single Active Index                                                                                                       |

### 1.8 Edge — Binary File Skipping

| Field            | Value                                                                                                        |
| :--------------- | :----------------------------------------------------------------------------------------------------------- |
| **Scenario**     | Binary and non-source files are skipped                                                                      |
| **Precondition** | Fixture project with a `.png`, `.zip`, and minified file >1MB.                                               |
| **Steps**        | 1. Call `index_repository()`<br>2. Query `codebase_files` for skipped files                                  |
| **Expected**     | - Binary file has `status` = `"skipped"`<br>- No symbols for skipped files<br>- `filesSkipped` count matches |
| **Priority**     | P1                                                                                                           |
| **Story Ref**    | §4.1 Rule #3 (file size limit), Rule #4 (binary detection)                                                   |

---

## 2. `search_symbols`

### 2.1 Positive — Exact Match

| Field            | Value                                                                                                                                                                |
| :--------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scenario**     | Find a symbol by exact name                                                                                                                                          |
| **Precondition** | Project indexed with known symbol `formatOrder` declared in `src/services/order.ts`.                                                                                 |
| **Steps**        | 1. Call `search_symbols({ query: "formatOrder" })`                                                                                                                   |
| **Expected**     | - `total` = 1<br>- `symbols[0].name` = `"formatOrder"`<br>- `symbols[0].kind` = `"function"` (or actual kind)<br>- `symbols[0].filePath` = `"src/services/order.ts"` |
| **Priority**     | P0                                                                                                                                                                   |
| **Story Ref**    | API Contracts §1.3 Search Behavior, §5.3 Symbol Search                                                                                                               |

### 2.2 Positive — Substring Match

| Field            | Value                                                                                                                      |
| :--------------- | :------------------------------------------------------------------------------------------------------------------------- |
| **Scenario**     | Find symbols by name substring                                                                                             |
| **Precondition** | Project indexed. Symbols `formatOrder`, `formatOrderLine`, `FormatOrderOptions` exist.                                     |
| **Steps**        | 1. Call `search_symbols({ query: "Order" })`                                                                               |
| **Expected**     | - `total` ≥ 3<br>- Results include all three order-related symbols<br>- Results sorted by exact > prefix > substring score |
| **Priority**     | P1                                                                                                                         |
| **Story Ref**    | API Contracts §1.3, §5.3                                                                                                   |

### 2.3 Positive — Filtered by Kind

| Field            | Value                                                                                           |
| :--------------- | :---------------------------------------------------------------------------------------------- |
| **Scenario**     | Filter symbol search to a specific kind                                                         |
| **Precondition** | Project indexed. Multiple symbols named starting with "format".                                 |
| **Steps**        | 1. Call `search_symbols({ query: "format", kind: "function" })`                                 |
| **Expected**     | - All returned symbols have `kind` = `"function"`<br>- No `interface`, `class`, etc. in results |
| **Priority**     | P1                                                                                              |
| **Story Ref**    | API Contracts §1.3, §5.3 Filtered query                                                         |

### 2.4 Positive — Case Insensitive

| Field            | Value                                                              |
| :--------------- | :----------------------------------------------------------------- |
| **Scenario**     | Search is case-insensitive                                         |
| **Precondition** | Symbol named `FORMATORDER` (uppercase) exists in index.            |
| **Steps**        | 1. Call `search_symbols({ query: "formatorder" })` (lowercase)     |
| **Expected**     | - `FORMATORDER` appears in results<br>- Match via `COLLATE NOCASE` |
| **Priority**     | P1                                                                 |
| **Story Ref**    | API Contracts §1.3, schema §5.3                                    |

### 2.5 Negative — Empty Query

| Field            | Value                                                             |
| :--------------- | :---------------------------------------------------------------- |
| **Scenario**     | Reject empty search query                                         |
| **Precondition** | Project indexed.                                                  |
| **Steps**        | 1. Call `search_symbols({ query: "" })`                           |
| **Expected**     | - JSON-RPC error `-32602`<br>- Message: "Query must not be empty" |
| **Priority**     | P0                                                                |
| **Story Ref**    | API Contracts §1.3 Error Cases                                    |

### 2.6 Negative — Query Too Short

| Field            | Value                                                     |
| :--------------- | :-------------------------------------------------------- |
| **Scenario**     | Reject single-character query                             |
| **Precondition** | Project indexed.                                          |
| **Steps**        | 1. Call `search_symbols({ query: "a" })`                  |
| **Expected**     | - JSON-RPC error `-32602`<br>- Message: `QUERY_TOO_SHORT` |
| **Priority**     | P1                                                        |
| **Story Ref**    | API Contracts §1.3 Error Cases                            |

### 2.7 Negative — No Match

| Field            | Value                                                  |
| :--------------- | :----------------------------------------------------- |
| **Scenario**     | Search returns empty when no symbols match             |
| **Precondition** | Project indexed. No symbol named `zzz_nonexistent`.    |
| **Steps**        | 1. Call `search_symbols({ query: "zzz_nonexistent" })` |
| **Expected**     | - `total` = 0<br>- `symbols` = `[]`<br>- No error      |
| **Priority**     | P1                                                     |
| **Story Ref**    | API Contracts §1.3                                     |

### 2.8 Edge — Unicode Symbols

| Field            | Value                                                                     |
| :--------------- | :------------------------------------------------------------------------ |
| **Scenario**     | Search for symbols with unicode names                                     |
| **Precondition** | Index contains symbol named `caféMéthod` (with accents).                  |
| **Steps**        | 1. Call `search_symbols({ query: "café" })`                               |
| **Expected**     | - `caféMéthod` appears in results<br>- Unicode comparison works correctly |
| **Priority**     | P2                                                                        |
| **Story Ref**    | §4.2 Rule #1                                                              |

---

## 3. `get_file_symbols`

### 3.1 Positive — Known File with Relations

| Field            | Value                                                                                                                                                                                                                                                   |
| :--------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Scenario**     | Retrieve all symbols from an indexed file with relations                                                                                                                                                                                                |
| **Precondition** | Project indexed. File `src/services/order.ts` has 3 symbols with known relations.                                                                                                                                                                       |
| **Steps**        | 1. Call `get_file_symbols({ filePath: "src/services/order.ts", includeRelations: true })`                                                                                                                                                               |
| **Expected**     | - `file.filePath` = `"src/services/order.ts"`<br>- `file.status` = `"indexed"`<br>- `symbols.length` = 3<br>- `symbols` ordered by `startLine` ascending<br>- `relations.length` > 0<br>- Each relation has valid `sourceSymbolId` and `targetSymbolId` |
| **Priority**     | P0                                                                                                                                                                                                                                                      |
| **Story Ref**    | API Contracts §1.2, §5.4 File Symbols                                                                                                                                                                                                                   |

### 3.2 Positive — File Without Relations

| Field            | Value                                                                              |
| :--------------- | :--------------------------------------------------------------------------------- |
| **Scenario**     | Retrieve file symbols with `includeRelations: false`                               |
| **Precondition** | Project indexed.                                                                   |
| **Steps**        | 1. Call `get_file_symbols({ filePath: "src/simple.ts", includeRelations: false })` |
| **Expected**     | - `symbols` populated<br>- `relations` is `undefined` (not present in output)      |
| **Priority**     | P1                                                                                 |
| **Story Ref**    | API Contracts §1.2 Arguments                                                       |

### 3.3 Negative — File Not Found

| Field            | Value                                                                         |
| :--------------- | :---------------------------------------------------------------------------- |
| **Scenario**     | Request symbols for a non-existent file                                       |
| **Precondition** | Project indexed. `src/nonexistent.ts` does not exist in the project or index. |
| **Steps**        | 1. Call `get_file_symbols({ filePath: "src/nonexistent.ts" })`                |
| **Expected**     | - `isError: true`<br>- Message: `FILE_NOT_FOUND`                              |
| **Priority**     | P0                                                                            |
| **Story Ref**    | API Contracts §1.2 Error Cases                                                |

### 3.4 Negative — File Not Indexed

| Field            | Value                                                                 |
| :--------------- | :-------------------------------------------------------------------- |
| **Scenario**     | Request symbols when no index exists for the project                  |
| **Precondition** | Clean database, no index.                                             |
| **Steps**        | 1. Call `get_file_symbols({ filePath: "src/any.ts" })`                |
| **Expected**     | - `isError: true`<br>- Message: `FILE_NOT_INDEXED` / "No index found" |
| **Priority**     | P1                                                                    |
| **Story Ref**    | API Contracts §1.2 Error Cases                                        |

### 3.5 Edge — Large File (>1000 Lines)

| Field            | Value                                                                                  |
| :--------------- | :------------------------------------------------------------------------------------- |
| **Scenario**     | Retrieve symbols from a large file with many declarations                              |
| **Precondition** | File has 1000+ lines with 100+ symbols.                                                |
| **Steps**        | 1. Call `get_file_symbols({ filePath: "src/large.ts" })`                               |
| **Expected**     | - All symbols returned<br>- Response time <500ms<br>- `symbols` ordered by `startLine` |
| **Priority**     | P1                                                                                     |
| **Story Ref**    | §5.4, schema §6 Data Volume Estimation                                                 |

---

## 4. `get_architecture`

### 4.1 Positive — Indexed Project

| Field            | Value                                                                                                                                                                                                                                                                          |
| :--------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scenario**     | Retrieve architecture overview for an indexed project                                                                                                                                                                                                                          |
| **Precondition** | Project indexed with known language distribution and symbol counts.                                                                                                                                                                                                            |
| **Steps**        | 1. Call `get_architecture({ projectPath: "/tmp/test-project" })`                                                                                                                                                                                                               |
| **Expected**     | - `languages` array non-empty<br>- `totalFiles` = expected count<br>- `totalSymbols` = expected count<br>- `symbolCounts` has expected kind → count mapping<br>- `entryPoints` includes all symbols with `isExported: true`<br>- `topFiles` sorted by `symbolCount` descending |
| **Priority**     | P0                                                                                                                                                                                                                                                                             |
| **Story Ref**    | API Contracts §1.4, §5.6 Architecture Overview                                                                                                                                                                                                                                 |

### 4.2 Negative — Not Indexed

| Field            | Value                                                                                                                                                                   |
| :--------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scenario**     | Request architecture for an unindexed project                                                                                                                           |
| **Precondition** | Clean database, no index for the project.                                                                                                                               |
| **Steps**        | 1. Call `get_architecture({ projectPath: "/tmp/test-project" })`                                                                                                        |
| **Expected**     | - `totalFiles` = 0<br>- `totalSymbols` = 0<br>- `languages` = `[]`<br>- `entryPoints` = `[]`<br>- `topFiles` = `[]`<br>- **NOT an error** (empty architecture is valid) |
| **Priority**     | P0                                                                                                                                                                      |
| **Story Ref**    | API Contracts §1.4 Error Cases                                                                                                                                          |

### 4.3 Positive — Language Breakdown Accuracy

| Field            | Value                                                                                                                                                                   |
| :--------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scenario**     | Verify language counts are accurate                                                                                                                                     |
| **Precondition** | Index contains exactly 140 TypeScript and 16 JavaScript files.                                                                                                          |
| **Steps**        | 1. Call `get_architecture()`<br>2. Sum `languages[].fileCount`                                                                                                          |
| **Expected**     | - `languages` includes `{ language: "typescript", fileCount: 140 }`<br>- `languages` includes `{ language: "javascript", fileCount: 16 }`<br>- Sum = `totalFiles` = 156 |
| **Priority**     | P1                                                                                                                                                                      |
| **Story Ref**    | §5.6, API Contracts §1.4 Output Schema                                                                                                                                  |

---

## 5. `trace_symbol`

### 5.1 Positive — Known Symbol (Both Directions)

| Field            | Value                                                                                                                                                                              |
| :--------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scenario**     | Trace a symbol with known inbound and outbound relations                                                                                                                           |
| **Precondition** | Index contains `formatOrder` with 2 callers and 3 callees at depth ≤2.                                                                                                             |
| **Steps**        | 1. Call `trace_symbol({ symbolName: "formatOrder", direction: "both", maxDepth: 2 })`                                                                                              |
| **Expected**     | - `symbol.name` = `"formatOrder"`<br>- `inbound.length` = 2<br>- `outbound.length` = 3<br>- All `depth` values ≤ 2<br>- Each entry has valid `symbol`, `relationType`, and `depth` |
| **Priority**     | P0                                                                                                                                                                                 |
| **Story Ref**    | API Contracts §1.5, §5.5 Trace Symbol                                                                                                                                              |

### 5.2 Positive — Inbound Only

| Field            | Value                                                                                       |
| :--------------- | :------------------------------------------------------------------------------------------ |
| **Scenario**     | Trace only inbound relations                                                                |
| **Precondition** | Same as 5.1.                                                                                |
| **Steps**        | 1. Call `trace_symbol({ symbolName: "formatOrder", direction: "inbound", maxDepth: 1 })`    |
| **Expected**     | - `inbound.length` > 0<br>- `outbound` = `[]`<br>- `inbound[].depth` all = 1 (maxDepth = 1) |
| **Priority**     | P1                                                                                          |
| **Story Ref**    | API Contracts §1.5 Arguments                                                                |

### 5.3 Positive — Outbound Only

| Field            | Value                                                                                     |
| :--------------- | :---------------------------------------------------------------------------------------- |
| **Scenario**     | Trace only outbound relations                                                             |
| **Precondition** | Same as 5.1.                                                                              |
| **Steps**        | 1. Call `trace_symbol({ symbolName: "formatOrder", direction: "outbound", maxDepth: 2 })` |
| **Expected**     | - `outbound.length` > 0<br>- `inbound` = `[]`                                             |
| **Priority**     | P1                                                                                        |
| **Story Ref**    | API Contracts §1.5 Arguments                                                              |

### 5.4 Positive — Depth Limiting

| Field            | Value                                                                                        |
| :--------------- | :------------------------------------------------------------------------------------------- |
| **Scenario**     | Verify maxDepth truncates traversal                                                          |
| **Precondition** | Symbol has a chain of calls 5 levels deep.                                                   |
| **Steps**        | 1. Call `trace_symbol({ symbolName: "topLevel", direction: "outbound", maxDepth: 2 })`       |
| **Expected**     | - All returned `outbound` entries have `depth` ≤ 2<br>- Deep callees (depth 3+) are excluded |
| **Priority**     | P1                                                                                           |
| **Story Ref**    | §5.5 Recursive CTE, API Contracts §1.5 Arguments                                             |

### 5.5 Negative — Symbol Not Found

| Field            | Value                                                                                   |
| :--------------- | :-------------------------------------------------------------------------------------- |
| **Scenario**     | Trace a symbol that does not exist in the index                                         |
| **Precondition** | No symbol named `nonexistentFn` in any indexed file.                                    |
| **Steps**        | 1. Call `trace_symbol({ symbolName: "nonexistentFn" })`                                 |
| **Expected**     | - `isError: true`<br>- Message: `SYMBOL_NOT_FOUND` / "Symbol 'nonexistentFn' not found" |
| **Priority**     | P0                                                                                      |
| **Story Ref**    | API Contracts §1.5 Error Cases                                                          |

### 5.6 Negative — No Relations

| Field            | Value                                                                                               |
| :--------------- | :-------------------------------------------------------------------------------------------------- |
| **Scenario**     | Trace a symbol with zero relations                                                                  |
| **Precondition** | Symbol exists but has no `codebase_relations` rows (orphaned utility function).                     |
| **Steps**        | 1. Call `trace_symbol({ symbolName: "orphanedFn" })`                                                |
| **Expected**     | - `symbol.name` = `"orphanedFn"`<br>- `inbound` = `[]`<br>- `outbound` = `[]`<br>- **NOT an error** |
| **Priority**     | P1                                                                                                  |
| **Story Ref**    | API Contracts §1.5 Error Cases (no relations entry)                                                 |

### 5.7 Edge — Circular Relations

| Field            | Value                                                                                                                                      |
| :--------------- | :----------------------------------------------------------------------------------------------------------------------------------------- |
| **Scenario**     | Handle mutual recursion (A calls B, B calls A)                                                                                             |
| **Precondition** | Two symbols with circular call relationship.                                                                                               |
| **Steps**        | 1. Call `trace_symbol({ symbolName: "fnA", direction: "outbound", maxDepth: 3 })`                                                          |
| **Expected**     | - `outbound` includes `fnB` at depth 1 and `fnA` appears at depth 2<br>- No infinite recursion<br>- `depth` values don't exceed `maxDepth` |
| **Priority**     | P1                                                                                                                                         |
| **Story Ref**    | §5.5 Recursive CTE, §4.3 Relation Rules #3 (self-reference prevention)                                                                     |

### 5.8 Edge — Deep Tree (>10 Levels)

| Field            | Value                                                                             |
| :--------------- | :-------------------------------------------------------------------------------- |
| **Scenario**     | Traversal halts at maxDepth                                                       |
| **Precondition** | Call chain 15 levels deep.                                                        |
| **Steps**        | 1. Call `trace_symbol({ symbolName: "fn1", direction: "outbound", maxDepth: 3 })` |
| **Expected**     | - Max observed `depth` = 3<br>- Response completes in <200ms<br>- No CTE overflow |
| **Priority**     | P1                                                                                |
| **Story Ref**    | §5.5, API Contracts §1.5 maxDepth validation                                      |

---

## 6. `index_status`

### 6.1 Positive — Completed

| Field            | Value                                                                                                                                                                        |
| :--------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scenario**     | Query status after successful index                                                                                                                                          |
| **Precondition** | Index completed (from 1.1).                                                                                                                                                  |
| **Steps**        | 1. Call `index_status({ projectPath: "/tmp/test-project" })`                                                                                                                 |
| **Expected**     | - `indexed` = `true`<br>- `status` = `"completed"`<br>- `fileCount` > 0<br>- `symbolCount` > 0<br>- `lastIndexedAt` is a recent ISO-8601 timestamp<br>- `lastError` = `null` |
| **Priority**     | P0                                                                                                                                                                           |
| **Story Ref**    | API Contracts §1.6                                                                                                                                                           |

### 6.2 Positive — Idle

| Field            | Value                                                                                                  |
| :--------------- | :----------------------------------------------------------------------------------------------------- |
| **Scenario**     | Query status when no index exists                                                                      |
| **Precondition** | Clean database.                                                                                        |
| **Steps**        | 1. Call `index_status({ projectPath: "/tmp/test-project" })`                                           |
| **Expected**     | - `indexed` = `false`<br>- `status` = `"idle"`<br>- `lastIndexedAt` = `null`<br>- `lastError` = `null` |
| **Priority**     | P0                                                                                                     |
| **Story Ref**    | API Contracts §1.6                                                                                     |

### 6.3 Positive — Indexing

| Field            | Value                                                                                                                          |
| :--------------- | :----------------------------------------------------------------------------------------------------------------------------- |
| **Scenario**     | Query status during an active index                                                                                            |
| **Precondition** | `index_repository` in progress (large fixture).                                                                                |
| **Steps**        | 1. Start index on large project<br>2. While running, call `index_status()`                                                     |
| **Expected**     | - `status` = `"indexing"`<br>- `progress.filesProcessed` ≤ `progress.filesTotal`<br>- `progress.percentComplete` between 0–100 |
| **Priority**     | P1                                                                                                                             |
| **Story Ref**    | API Contracts §1.6                                                                                                             |

### 6.4 Positive — Failed State

| Field            | Value                                                                                                                                         |
| :--------------- | :-------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scenario**     | Query status when last index failed                                                                                                           |
| **Precondition** | Index started on a project and failed mid-way (e.g., tree-sitter init error).                                                                 |
| **Steps**        | 1. Trigger a failing index (corrupted fixture or unavailable parser)<br>2. Call `index_status()`                                              |
| **Expected**     | - `indexed` = `true` (partial data exists)<br>- `status` = `"failed"`<br>- `lastError` ≠ `null`<br>- `lastError` describes the failure reason |
| **Priority**     | P1                                                                                                                                            |
| **Story Ref**    | API Contracts §1.6, §2.4 IndexStatus                                                                                                          |
