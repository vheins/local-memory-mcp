# Test Scenarios: Codebase Indexing

## Header & Navigation

- [Test Strategy](strategy.md)
- [Search Test Scenarios](test-search.md)
- [Performance Test Scenarios](test-performance.md)

Verification of the indexing pipeline: file discovery, tree-sitter parsing, symbol extraction, and SQLite storage.

## 1. Index TypeScript Project (Positive)

- **Setup:** Create temp directory with 5 `.ts` files containing classes, functions, interfaces, enums, and exported consts.
- **Action:** Call `codebase-index` with path to temp directory.
- **Assert:**
  - Response contains `symbolCount > 0` and `fileCount === 5`.
  - All expected symbols present: classes (`class Foo`), functions (`function bar`), interfaces (`interface Baz`), enums (`enum Qux`), exported consts.
  - Each symbol has `kind`, `name`, `file`, `line`, `column` populated.
  - `kg_entities` table contains exactly the extracted symbols.

## 2. Index Mixed-Language Project (Positive)

- **Setup:** Temp directory with `.ts`, `.js`, `.py`, `.rs`, `.go` files, each containing valid code.
- **Action:** Index the directory.
- **Assert:**
  - Files of all supported languages are discovered and parsed.
  - Unsupported language files (e.g., `.cpp` if unsupported) are skipped with a log entry.
  - Symbols are correctly categorized by language-specific extractors.
  - `fileCount` matches number of supported-language files.

## 3. Re-Index After File Change (Positive)

- **Setup:** Index a project with 10 files. Modify 1 file (add a function), delete 1 file.
- **Action:** Call `codebase-index` again on the same path.
- **Assert:**
  - Only the modified and deleted files are re-parsed (delta detection).
  - New function appears in `kg_entities`.
  - Symbols from deleted file are removed from `kg_entities`.
  - Unchanged files' symbols retain their existing IDs.
  - `symbolCount` reflects net change (+1 new, −n deleted).

## 4. Re-Index With No Changes (Positive — Idempotency)

- **Setup:** Index a project. Assert initial count.
- **Action:** Index the same project again immediately.
- **Assert:**
  - `symbolCount` identical to first run.
  - No duplicate rows in `kg_entities`.
  - No unnecessary file re-parsing (detection passes unchanged).

## 5. Index Empty Project (Positive)

- **Setup:** Create empty directory with no files.
- **Action:** Index the directory.
- **Assert:**
  - Response includes `fileCount: 0`, `symbolCount: 0`.
  - No errors or warnings.
  - Status = `success`.

## 6. Index Project With Only Supported-Language Empty Files

- **Setup:** Create empty `.ts`, `.js`, `.py` files with no symbols (whitespace only).
- **Action:** Index the directory.
- **Assert:**
  - `fileCount > 0`, `symbolCount === 0`.
  - Status = `success` with a warning that 0 symbols were extracted.

## 7. Index Non-Existent Path (Negative)

- **Setup:** Use a path that does not exist on the filesystem.
- **Action:** Call `codebase-index` with non-existent path.
- **Assert:**
  - Response contains `error` with code `PATH_NOT_FOUND`.
  - No rows inserted into `kg_entities`.

## 8. Index File Instead of Directory (Negative)

- **Setup:** Provide path to a single `.ts` file (not a directory).
- **Action:** Index the file path.
- **Assert:**
  - Response contains `error` with code `INVALID_PATH` or `NOT_A_DIRECTORY`.
  - Hint: "Provide a directory path".

## 9. Index Binary-Only Project (Negative)

- **Setup:** Temp directory containing only `.png`, `.bin`, `.wasm`, `.zip` files.
- **Action:** Index the directory.
- **Assert:**
  - `fileCount` includes only non-binary files (0).
  - `symbolCount: 0`.
  - Status = `success` — binary files are silently skipped, not an error.

## 10. Index Without Read Permission (Negative)

- **Setup:** Temp directory with one readable `.ts` file and one `.ts` file with `chmod 000`.
- **Action:** Index the directory.
- **Assert:**
  - Readable file is indexed normally.
  - Unreadable file is skipped with a warning.
  - Index completes (partial success).

## 11. Parse Malformed File (Negative)

- **Setup:** Create a `.ts` file with syntax errors (unclosed brace, invalid token).
- **Action:** Index the directory.
- **Assert:**
  - Malformed file is skipped with a warning log.
  - Other files in the project are indexed normally.
  - Index completes with partial success, not a fatal error.

## 12. Parse File With Unsupported Language (Negative)

- **Setup:** Create `.cobol` and `.fortran` files (unsupported languages) with valid code.
- **Action:** Index the directory.
- **Assert:**
  - Unsupported language files are skipped with a log entry.
  - Supported files in the same directory are indexed normally.

## 13. Path Traversal Attempt (Security)

- **Setup:** Provide path like `../../etc/passwd` or `/etc/passwd` as the root directory.
- **Action:** Call `codebase-index` with traversal path.
- **Assert:**
  - Path is resolved and validated against project root.
  - If outside allowed scope, error with code `PATH_OUT_OF_BOUNDS`.
  - No filesystem access outside permitted root.

## 14. Symlink Outside Project (Security)

- **Setup:** Create a symlink inside the project directory pointing to `/etc` or another external directory.
- **Action:** Index the project.
- **Assert:**
  - Symlink is detected and skipped with a warning.
  - Symlink target is not traversed.
  - `fileCount` excludes the symlink.

## 15. Hidden Directories (node_modules, .git) (Negative)

- **Setup:** Project with `node_modules/` containing 1000 `.js` files and `.git/` objects.
- **Action:** Index the project.
- **Assert:**
  - `node_modules` and `.git` are excluded per `.gitignore` / default rules.
  - `fileCount` does not include hidden directory files.
  - No symbols from ignored directories are extracted.

## 16. Concurrent Index Requests (Integration)

- **Setup:** Large project that takes ~5s to index.
- **Action:** Fire 3 simultaneous `codebase-index` calls.
- **Assert:**
  - First call returns `status: "in_progress"`.
  - Second and third calls return `status: "queued"`.
  - After first completes, next queued call begins.

## 17. Index With Custom Ignore Patterns

- **Setup:** Project with a `.codebaseignore` file (or similar mechanism) excluding `test/` and `*.generated.ts`.
- **Action:** Index the project.
- **Assert:**
  - Files in `test/` directory are excluded.
  - `*.generated.ts` files are excluded.
  - Other `.ts` files are indexed normally.
