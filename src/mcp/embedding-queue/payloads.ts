/**
 * Snapshot payload builders for the embedding/KG outbox (TASK-074, TASK-293).
 *
 * Pure functions — no DB access, no store writes. Each job snapshot is frozen
 * at enqueue time; the worker embeds/extracts exactly what these builders
 * captured (TASK-430 split out of `enqueue.ts`).
 */
import { createHash } from "crypto";
import { buildStandardVectorText } from "../tools/standard.shared";
import { KG_MAX_CONTEXT_ENTITIES } from "../utils/constants";
import type { CodebaseSymbolInsert, CodebaseReferenceInsert, CodingStandardEntry, Task } from "../types";
import type { EmbeddingJobPayload } from "./types";

// ---------------------------------------------------------------------------
// Snapshot payload builders
// ---------------------------------------------------------------------------

/** Memory job payload — embed the full content, KG-extract the full content. */
export function memoryJobPayload(input: {
	title?: string | null;
	content: string;
	owner: string;
	repo: string;
	updatedAt: string;
}): EmbeddingJobPayload {
	return {
		v: 1,
		text: input.content,
		content: input.content,
		title: input.title ?? "",
		owner: input.owner,
		repo: input.repo,
		updatedAt: input.updatedAt
	};
}

/** Standard job payload — vector text per standard.shared, KG on content + relations fields. */
export function standardJobPayload(standard: CodingStandardEntry): EmbeddingJobPayload {
	return {
		v: 1,
		text: buildStandardVectorText(standard),
		content: standard.content,
		title: standard.title,
		owner: standard.owner,
		repo: standard.repo ?? "",
		updatedAt: standard.updated_at,
		parentId: standard.parent_id,
		context: standard.context,
		stack: standard.stack
	};
}

/** Task job payload — vector + KG on `title\n<description>`. */
export function taskJobPayload(task: Task): EmbeddingJobPayload {
	const text = `${task.title}\n${task.description ?? ""}`;
	const decisionRefs = (task.metadata?.decision_refs as string[] | undefined) ?? undefined;
	return {
		v: 1,
		text,
		content: text,
		title: task.title,
		owner: task.owner,
		repo: task.repo,
		updatedAt: task.updated_at,
		parentId: task.parent_id,
		decisionRefs
	};
}

// ---------------------------------------------------------------------------
// Codebase-symbol payload (TASK-293)
// ---------------------------------------------------------------------------

/** Symbol line length cap — bounds one payload line so content stays compact. */
const CODEBASE_SYMBOL_LINE_CHARS = 160;

/**
 * Stable digest of a file's reference edges at enqueue time.
 *
 * The payload `content` is built from the file's SYMBOLS only (extraction
 * input); references are the relation-writer input, re-read from
 * `codebase_references` at worker time. A pure call-graph change (symbols
 * identical, edges changed) would therefore hash-dedup on an unchanged
 * `content` and the worker would never re-run the relation writer — this
 * digest is appended to the payload and hashed by
 * `embedPayloadContentHash`, so reference changes invalidate dedup exactly
 * like symbol changes do.
 *
 * Canonicalization uses `target_file` as the edge target identity and
 * DELIBERATELY EXCLUDES `target_symbol_id`: the v23 column is a
 * `codebase_symbols(id)` pointer, and symbol rows are re-created with fresh
 * UUIDs on every re-parse (delete-by-file + bulkUpsertSymbols), so hashing
 * the per-parse UUID would churn the digest on EVERY re-parse of a file once
 * Wave 1 visitors resolve targets — defeating the content-hash dedup this
 * digest exists to protect. `target_file` is a stable file path across
 * re-parses, so it captures the resolved-target identity without the churn.
 */
function codebaseRefDigest(refs: CodebaseReferenceInsert[]): string {
	if (refs.length === 0) return "";
	const canonical = refs.map((r) => ({
		c: r.caller_name ?? null,
		n: r.symbol_name,
		k: r.kind,
		t: r.target_file ?? null
	}));
	return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/**
 * Stable queue_jobs entity id for a codebase file.
 *
 * One job per INDEXED FILE, not per symbol: `bulkUpsertSymbols` re-creates
 * symbol rows with fresh UUIDs on every re-index (delete-by-file + insert),
 * so a per-symbol id would churn on every re-parse and silently defeat both
 * LWW coalescing and content-hash dedup. The `<repo>::<file_path>` key is
 * stable across re-indexes — an unchanged re-parse dedups, a changed one
 * LWW-upserts the same row. The repo prefix prevents cross-repo collisions
 * on identical relative paths (queue_jobs unique index is (entity_kind,
 * entity_id) — repo is NOT part of it).
 */
export function codebaseEntityId(repo: string, filePath: string): string {
	return `${repo}::${filePath}`;
}

/** Inverse of {@link codebaseEntityId} — splits the stored entity id back. */
export function codebaseEntityParts(entityId: string): { repo: string; filePath: string } {
	const sep = entityId.indexOf("::");
	if (sep <= 0) return { repo: "", filePath: entityId };
	return { repo: entityId.slice(0, sep), filePath: entityId.slice(sep + 2) };
}

/**
 * Codebase job payload — KG "codebase" domain for one indexed file.
 *
 * - `content`: bounded per-symbol lines (`name (kind): doc-comment`) — the
 *   compromise extraction input; symbols capped at KG_MAX_CONTEXT_ENTITIES
 *   and each line at CODEBASE_SYMBOL_LINE_CHARS. Falls back to the file path
 *   when the file has no symbols (keeps the job parseable so the relation
 *   writer can still emit caller edges for reference-only files).
 * - `title`: the file path — becomes the KG observation text
 *   ("Mentioned in codebase: <path>"), one shared text for all of the file's
 *   entities.
 * - `codebaseRefDigest`: reference-edge digest — see above.
 * - `owner`: "" — `codebase_symbols` has no owner column (cross-tenant guard
 *   in codebase.read.ts); KG entities for the codebase domain are owner-less
 *   and repo-scoped, matching the rest of the codebase index.
 */
export function codebaseSymbolJobPayload(input: {
	repo: string;
	filePath: string;
	symbols: CodebaseSymbolInsert[];
	refs?: CodebaseReferenceInsert[];
}): EmbeddingJobPayload {
	const lines = input.symbols.slice(0, KG_MAX_CONTEXT_ENTITIES).map((s) => {
		const doc = s.doc_comment ? `: ${s.doc_comment.slice(0, CODEBASE_SYMBOL_LINE_CHARS)}` : "";
		return `${s.name} (${s.kind})${doc}`;
	});
	const content = lines.length > 0 ? lines.join("\n") : input.filePath;
	const now = new Date().toISOString();
	return {
		v: 1,
		text: content,
		content,
		title: input.filePath,
		owner: "",
		repo: input.repo,
		updatedAt: now,
		codebaseRefDigest: input.refs ? codebaseRefDigest(input.refs) : ""
	};
}
