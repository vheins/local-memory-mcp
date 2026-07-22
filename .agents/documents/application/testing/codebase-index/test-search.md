# Test Scenarios: Codebase Search

## Header & Navigation

- [Test Strategy](strategy.md)
- [Indexing Test Scenarios](test-indexing.md)
- [Performance Test Scenarios](test-performance.md)

Verification of the `codebase-search` MCP tool: query parsing, symbol ranking, filtering, and pagination.

## 1. Search by Exact Name (Positive)

- **Setup:** Index a project containing `function authenticateUser()`, `class AuthenticateUser`, `function authenticateUserLegacy()`.
- **Action:** Search with query `authenticateUser` (exact match).
- **Assert:**
  - Results contain `authenticateUser` function as top result.
  - Partial matches (`authenticateUserLegacy`) are ranked lower.
  - Case-insensitive match (`authenticateuser`) also returns the symbol.

## 2. Search by Partial Name (Positive)

- **Setup:** Symbols: `validateEmail`, `validatePhone`, `validateAddress`, `sendEmail`.
- **Action:** Search with query `validate`.
- **Assert:**
  - Returns 3 results: `validateEmail`, `validatePhone`, `validateAddress`.
  - `sendEmail` is not returned.
  - Results are ranked by relevance (prefix match > infix match).

## 3. Search Non-Existent Symbol (Negative)

- **Setup:** Index a project with symbols `foo`, `bar`, `baz`.
- **Action:** Search with query `nonexistentSymbol`.
- **Assert:**
  - Returns empty array `[]`.
  - `totalCount: 0`.
  - Status = `success` (not an error).

## 4. Search With Empty Query (Negative)

- **Setup:** Any indexed project.
- **Action:** Search with empty string `""`.
- **Assert:**
  - Returns validation error (Zod).
  - Error code: `INVALID_INPUT`.

## 5. Filter by Symbol Kind (Positive)

- **Setup:** Index a project with functions, classes, interfaces, and variables.
- **Action:** Search with `kind: "class"` filter (no name query).
- **Assert:**
  - Results contain only symbols where `kind === "class"`.
  - Functions, interfaces, variables are excluded.

## 6. Filter by Symbol Kind — No Matches (Negative)

- **Setup:** Index a project with only functions and variables.
- **Action:** Search with `kind: "interface"`.
- **Assert:**
  - Returns empty array `[]`.
  - `totalCount: 0`.

## 7. Filter by File (Positive)

- **Setup:** Index a project with `src/auth.ts` (10 symbols) and `src/utils.ts` (20 symbols).
- **Action:** Search with `file: "src/auth.ts"`.
- **Assert:**
  - Results contain only symbols from `src/auth.ts`.
  - `totalCount === 10`.

## 8. Filter by File — No Matches (Negative)

- **Setup:** Index a project without `nonexistent.ts`.
- **Action:** Search with `file: "nonexistent.ts"`.
- **Assert:**
  - Returns empty array `[]`.

## 9. Combined Name + Kind + File Filter (Positive)

- **Setup:** Symbols: `validateEmail` (function) in `auth.ts`, `validateEmail` (function) in `utils.ts`, `ValidateEmail` (class) in `models.ts`.
- **Action:** Search with `query: "validateEmail"` + `kind: "function"` + `file: "auth.ts"`.
- **Assert:**
  - Returns exactly 1 result: the `validateEmail` function in `auth.ts`.
  - Other matches are excluded.

## 10. Search With Special Characters (Positive)

- **Setup:** Symbols: `$http`, `_privateVar`, `__dirname`, `onClick->handler`, `parse$data`.
- **Action:** Search with queries containing `$`, `_`, `->` characters.
- **Assert:**
  - `$http` found when querying `http` or `$http`.
  - `onClick->handler` found when querying `onClick` or `handler`.
  - No SQL injection or regex crash from special characters.

## 11. Pagination — Default Page Size

- **Setup:** Index 150 symbols.
- **Action:** Search with no pagination parameters.
- **Assert:**
  - Results limited to default page size (e.g., 50).
  - Response includes `page`, `pageSize`, `totalCount`, `totalPages`.

## 12. Pagination — Specific Page (Positive)

- **Setup:** Index 100 symbols.
- **Action:** Search with `page: 3, pageSize: 10`.
- **Assert:**
  - Returns symbols 21–30 (0-indexed: 20–29).
  - `page: 3`, `pageSize: 10`, `totalPages: 10`.

## 13. Pagination — Page Beyond Total (Negative)

- **Setup:** Index 25 symbols with `pageSize: 10`.
- **Action:** Search with `page: 10`.
- **Assert:**
  - Returns empty array `[]`.
  - `page: 10`, `totalPages: 3`.
  - Not an error; client should check `totalPages`.

## 14. Search by Exact Name — Non-ASCII Identifiers

- **Setup:** Index file containing `παράμετρος`, `приветМир`, `中文函数`.
- **Action:** Search with the exact Unicode identifier.
- **Assert:**
  - Symbol is found by exact Unicode name.
  - UTF-8 encoding is preserved in request and response.

## 15. Search Case Sensitivity

- **Setup:** Symbols: `UserModel`, `usermodel`, `UserModelHelper`.
- **Action:** Search with `query: "UserModel"` (title case).
- **Assert:**
  - `UserModel` returned first (exact case match).
  - `usermodel` returned (case-insensitive match) but ranked lower.
  - `UserModelHelper` returned as partial match, ranked third.

## 16. Search Results Include Metadata

- **Setup:** Index a project, then search.
- **Assert (per result):**
  - `name`, `kind`, `file`, `line`, `column`, `symbolId` are populated.
  - `file` is relative to the indexed root.

## 17. Search After Re-Index

- **Setup:** Index project with `oldFunction()`. Re-index after adding `newFunction()`.
- **Action:** Search for `newFunction`.
- **Assert:**
  - `newFunction` is searchable immediately after re-index completes.
  - `oldFunction` is still searchable (unless deleted).
