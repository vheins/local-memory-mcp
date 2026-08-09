#!/usr/bin/env node
/**
 * FTS5 tokenizer evaluation: unicode61 (prefix-`*`, production) vs trigram
 * for the memories_fts index (TASK-295 / design P5 of
 * docs/en/optimization-memories-fts5.md §9).
 *
 * Decision-gate harness — measurement only, NO production code is touched:
 * it builds an isolated temp SQLite DB (pragmas mirrored from
 * src/mcp/storage/sqlite.ts) with two identical external-content FTS5 tables
 * (unicode61 vs trigram) fed from the same synthetic + real-ish corpus
 * (EN / ID / CJK), then measures per tokenizer:
 *
 *   - recall @10 / @k on a labeled query set (oracle = LIKE `%q%`, the
 *     permanent production fallback), for both the production MATCH shape
 *     (every term gets a `*` prefix via buildFtsMatchQuery) and a raw trigram
 *     shape (no `*` — native substring matching),
 *   - index size (shadow-table bytes + fts5vocab token counts when available),
 *   - per-query latency p50/p95/p99 vs the LIKE baseline,
 *   - EXPLAIN QUERY PLAN for representative slow MATCH shapes,
 *   - the <3-char corner (queries of length 1/2/3) with explicit per-tokenizer
 *     hit counts, and CJK contiguous-run vs mid-run substring behavior.
 *
 * Usage:
 *   node scripts/bench/fts-trigram-eval.mjs [--rows N] [--iter M] [--json-out PATH]
 *
 * Prints a human-readable report snippet then a JSON summary (also written to
 * --json-out, default `.agents/documents/analysis/fts5-trigram-eval-results.json`).
 */
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import Database from "better-sqlite3";

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) so reruns produce an identical corpus.
// ---------------------------------------------------------------------------
function mulberry32(seed) {
	let a = seed >>> 0;
	return function () {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// ---------------------------------------------------------------------------
// Corpus sources (EN / ID / CJK + technical identifiers).
// ---------------------------------------------------------------------------
const EN_SENTENCES = [
	"Workspace memory is indexed for fast semantic search across the project.",
	"The embedding vector is normalized before similarity computation.",
	"Content changes trigger a rebuild of the full-text index.",
	"Robust keyword search combines lexical and vector signals.",
	"Deploying the migration requires a schema version bump.",
	"The tokenizer splits content on word boundaries for prefix queries.",
	"Query latency improves when the index avoids a full table scan.",
	"Essential context is retrieved from long-term memory for the agent.",
	"Potential matches are scored with bm25 relevance ranking.",
	"The dashboard lists recent memories sorted by importance.",
	"Caching strategy uses an expiry policy with periodic reclamation.",
	"Multi-tenant isolation keeps every repository namespace separate.",
	"High-priority memories surface first in the ranked results.",
	"Recalling a technical decision requires exact identifier matching.",
	"Binary artifacts are excluded from the semantic index.",
	"A threshold on the composite score filters irrelevant candidates."
];
const ID_SENTENCES = [
	"Sistem manajemen memori untuk agen pemrograman.",
	"Pengoptimalan kueri pencarian basis data dengan indeks teks lengkap.",
	"Penyimpanan vektor untuk kesamaan semantik antar dokumen.",
	"Pengindeksan teks lengkap menggunakan FTS5 dan tokenizer unicode.",
	"Cache hasil kueri untuk kinerja aplikasi yang lebih baik.",
	"Penjadwalan tugas latar belakang dilakukan secara berkala.",
	"Validasi skema antarmuka memakai Zod di lapisan kode.",
	"Skor hibrida menggabungkan kemiripan vektor dan kata kunci.",
	"Dokumentasi teknis ditulis dalam dua bahasa untuk aksesibilitas.",
	"Pengujian menyeluruh mencakup kasus positif dan negatif."
];
const CJK_SENTENCES = [
	"记忆管理系统用于编程助手检索长期上下文。",
	"语义向量搜索与全文检索优化并行工作。",
	"数据库索引与查询性能分析在存储层完成。",
	"嵌入向量的相似度计算支撑混合排序算法。",
	"跨语言搜索质量评估覆盖英语印尼语和中文。",
	"基于FTS5的全文索引保留词前缀匹配能力。",
	"关键词权重在混合评分中占三成比例。",
	"缓存过期策略与回收机制避免陈旧数据。",
	"多租户隔离的数据库设计保障仓库级安全。",
	"技术决策记忆通过标识符精确匹配检索。"
];
const MIXED_SENTENCES = [
	"RAG pipeline 用于代码库问答，召回层结合 bm25。",
	"vector 检索与 bm25 混合排序在 memory.read 中合并。",
	"Embedding 模型输出 384 维向量用于相似度计算。",
	"Artikel bahasa Indonesia membahas optimasi kueri dan pengindeksan.",
	"Memory berisi konteks untuk agen: skema, kontrak API, dan keputusan desain.",
	"查询速度在索引就绪后显著提升，全文检索替代全表扫描。"
];
const TECH_PHRASES = [
	"uses the libsql driver for local persistence",
	"better-sqlite3 bindings compile the FTS5 extension",
	"tree-sitter grammar indexes source symbols",
	"supabase auth validates the dashboard session",
	"zod schema validation guards the tool inputs",
	"openai embeddings feed the vector index",
	"esbuild bundles the server entry point",
	"vitest runs the unit and integration suites",
	"chart.js renders the dashboard analytics",
	"svelte components compose the management UI",
	"react was evaluated and rejected for the dashboard",
	"the drizzle ORM was not adopted for this codebase",
	"the data-pipeline job writes the derived index nightly"
];
// Prefix-family stems: each generates variant words so `stem*` prefix queries
// hit multiple distinct tokens (deterministic prefix-recall signal).
const STEMS = [
	["vector", "vectors", "vectorized", "vectorization", "vectorless"],
	["memory", "memories", "memoryless", "memorized", "memorize"],
	["search", "searches", "searching", "searchable", "searchability"],
	["index", "indexed", "indexing", "indexable", "indexer"],
	["token", "tokens", "tokenized", "tokenizer", "tokenization"],
	["query", "queries", "queryable", "querying", "queryer"],
	["cache", "cached", "caching", "caches", "cacheable"],
	["schema", "schemas", "schemaful", "schemaless", "schematic"],
	["deploy", "deployed", "deploying", "deployment", "deploys"],
	["sqlite", "sqlites", "sqlite3", "sqlitefile", "sqliteindex"]
];
const TAG_POOL = [
	"data",
	"pipeline",
	"cache",
	"fts5",
	"vector",
	"embed",
	"sql",
	"id",
	"ui",
	"go",
	"ts",
	"backend",
	"performance",
	"semantic"
];

function pickTags(rand) {
	const n = 1 + Math.floor(rand() * 3);
	const tags = [];
	while (tags.length < n) {
		const t = TAG_POOL[Math.floor(rand() * TAG_POOL.length)];
		if (!tags.includes(t)) tags.push(t);
	}
	return JSON.stringify(tags);
}

function buildCorpus(rows) {
	const rand = mulberry32(0x295);
	const sentences = [...EN_SENTENCES, ...ID_SENTENCES, ...CJK_SENTENCES, ...MIXED_SENTENCES, ...TECH_PHRASES];
	// Keep mid-word probe substrings present: workspace/content/memories/robust/
	// essential/potential all appear via the sentence pool; add a café row for
	// the diacritic probe (unicode61 strips diacritics, trigram does not).
	const out = [];
	for (let i = 1; i <= rows; i++) {
		const base = sentences[Math.floor(rand() * sentences.length)];
		const stem = STEMS[Math.floor(rand() * STEMS.length)];
		const w1 = stem[Math.floor(rand() * stem.length)];
		const w2 = STEMS[Math.floor(rand() * STEMS.length)][Math.floor(rand() * 5)];
		const title = `Memory ${(i % 7) + 1}`;
		const content =
			`${base} ${w1} ${w2} token-${i} mkt${i} proj${i % 13} grp${i % 5}` +
			(i % 17 === 0 ? " café menu" : "") +
			(i % 11 === 0 ? " WORKSPACE-BINARY" : "");
		out.push({ id: i, title, content, tags: pickTags(rand) });
	}
	return out;
}

// Unique-content corpus for the SIZE measurement (real memories are mostly
// unique; the recall corpus is deliberately repetitive so the LIKE oracle has
// enough rows to discriminate). Words drawn from a large pool → short trigram
// posting lists, bounding the low end of the index-size delta.
const POOL = [
	...STEMS.flat(),
	"workspace",
	"content",
	"memories",
	"robust",
	"essential",
	"potential",
	"retrieval",
	"context",
	"keyword",
	"lexical",
	"semantic",
	"vector",
	"embedding",
	"recall",
	"precision",
	"latency",
	"index",
	"token",
	"tokenizer",
	"query",
	"schema",
	"cache",
	"deploy",
	"migration",
	"score",
	"rank",
	"threshold",
	"candidate",
	"pipeline",
	"dashboard",
	"server",
	"client",
	"tool",
	"api",
	"contract",
	"documentation",
	"quality",
	"performance",
	"memory",
	"search",
	"fts",
	"sqlite",
	"unicode",
	"trigram",
	"prefix",
	"suffix",
	"trigger",
	"backfill",
	"wal",
	"checkpoint",
	"transaction",
	"commit",
	"rollback",
	"isolate",
	"tenant",
	"namespace",
	"owner",
	"repo",
	"agent",
	"score",
	"minmax",
	"normalize",
	"weight",
	"hybrid",
	"onnx",
	"binary",
	"artifact",
	"config",
	"plugin",
	"scaffold",
	"runtime",
	"bundle",
	"build",
	"deploy",
	"release",
	"test",
	"unit",
	"integration",
	"e2e",
	"benchmark",
	"profile",
	"baseline",
	"regression",
	"coverage"
];
function buildUniqueCorpus(rows) {
	const rand = mulberry32(0x296);
	const out = [];
	const words = [
		...new Set([
			...POOL,
			...Array.from({ length: 400 }, (_, i) => `t${i}`),
			...Array.from({ length: 300 }, (_, i) => `abc${i}`),
			...Array.from({ length: 200 }, (_, i) => `zz${i}`)
		])
	];
	for (let i = 1; i <= rows; i++) {
		const n = 30 + Math.floor(rand() * 20);
		const parts = [];
		for (let j = 0; j < n; j++) parts.push(words[Math.floor(rand() * words.length)]);
		const content = parts.join(" ") + " " + CJK_SENTENCES[i % CJK_SENTENCES.length];
		out.push({ id: i, title: `Memory ${(i % 7) + 1}`, content, tags: pickTags(rand) });
	}
	return out;
}

// ---------------------------------------------------------------------------
// Query set — labeled by recall class. Oracle = LIKE `%q%` on the raw string
// (the permanent production fallback), i.e. "rows a LIKE fallback would find".
// ---------------------------------------------------------------------------
const QUERIES = [
	// Latin token-initial (unicode61 `*` prefix; trigram ≥3 substring).
	{ cls: "latin-token-initial", q: "vector" },
	{ cls: "latin-token-initial", q: "memory" },
	{ cls: "latin-token-initial", q: "sqlite" },
	{ cls: "latin-token-initial", q: "search" },
	{ cls: "latin-token-initial", q: "fts5" },
	{ cls: "latin-token-initial", q: "memo" },
	{ cls: "latin-token-initial", q: "vect" },
	{ cls: "latin-token-initial", q: "tokeniz" },
	// Latin mid-word (unicode61 prefix misses; trigram substring catches).
	{ cls: "latin-midword", q: "orkspace" },
	{ cls: "latin-midword", q: "ntent" },
	{ cls: "latin-midword", q: "emories" },
	{ cls: "latin-midword", q: "obust" },
	{ cls: "latin-midword", q: "ential" },
	{ cls: "latin-midword", q: "sisting" },
	// Technical identifiers (hyphens split for unicode61; trigram substring).
	{ cls: "tech-ident", q: "libsql" },
	{ cls: "tech-ident", q: "better-sqlite3" },
	{ cls: "tech-ident", q: "tree-sitter" },
	{ cls: "tech-ident", q: "supabase" },
	{ cls: "tech-ident", q: "zod" },
	{ cls: "tech-ident", q: "esbuild" },
	// Hyphenated / multi-token phrases.
	{ cls: "hyphen", q: "data-pipeline" },
	{ cls: "hyphen", q: "multi-tenant" },
	// CJK contiguous run, 2-char, token-initial (unicode61 prefix).
	{ cls: "cjk", q: "记忆" },
	{ cls: "cjk", q: "向量" },
	{ cls: "cjk", q: "语义" },
	{ cls: "cjk", q: "索引" },
	// CJK 2-char mid-run (unicode61 prefix misses; trigram <3 chars → 0).
	{ cls: "cjk-midrun", q: "理系" },
	{ cls: "cjk-midrun", q: "存层" },
	// CJK 3+ char contiguous run, token-initial (both catch ≥3 chars).
	{ cls: "cjk-run3", q: "管理系统" },
	{ cls: "cjk-run3", q: "数据库" },
	// CJK 3+ char mid-run substring (unicode61 prefix misses; trigram catches).
	{ cls: "cjk-3char", q: "理系统" },
	{ cls: "cjk-3char", q: "量搜索" },
	{ cls: "cjk-3char", q: "卷词" },
	// <3-char corner (trigram cannot index/query <3 chars → 0 rows).
	{ cls: "short", q: "ui" },
	{ cls: "short", q: "go" },
	{ cls: "short", q: "ts" },
	{ cls: "short", q: "id" },
	{ cls: "short", q: "e" },
	{ cls: "short", q: "AI" },
	// Case sensitivity (unicode61 folds case; trigram is case-sensitive).
	{ cls: "case", q: "VECTOR" },
	{ cls: "case", q: "SQLite" },
	// Diacritics (unicode61 remove_diacritics=1; trigram byte-sensitive).
	{ cls: "diacritic", q: "cafe" },
	// Indonesian.
	{ cls: "id", q: "manajemen" },
	{ cls: "id", q: "pengindeksan" },
	{ cls: "id", q: "kueri" },
	{ cls: "id", q: "memori" },
	{ cls: "id", q: "memakai" }
];

// Representative "slow" queries for latency + EXPLAIN (broad hits, multi-term,
// phrase, CJK).
const SLOW_SHAPES = [
	{ name: "single-broad", q: "sqlite" },
	{ name: "single-cjk", q: "记忆" },
	{ name: "multi-and", q: "vector embedding semantic search" },
	{ name: "phrase", q: '"semantic search"' },
	{ name: "short-pathological", q: "e" }
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function buildFtsMatchQuery(raw) {
	// Mirror of src/mcp/utils/fts.ts buildFtsMatchQuery (production MATCH shape).
	if (!raw) return "";
	const trimmed = raw.trim();
	if (!trimmed) return "";
	const phrases = [];
	const phraseRanges = [];
	const phrasePattern = /"([^"]+)"/g;
	let m;
	while ((m = phrasePattern.exec(trimmed)) !== null) {
		const sanitized = (m[1] || "")
			.replace(/[^\p{L}\p{N}_\s]/gu, " ")
			.replace(/\s+/g, " ")
			.trim();
		if (sanitized.length > 0) phrases.push(`"${sanitized}"`);
		phraseRanges.push({ start: m.index, end: m.index + m[0].length });
	}
	let remaining = "";
	let cursor = 0;
	for (const r of phraseRanges) {
		remaining += trimmed.slice(cursor, r.start) + " ";
		cursor = r.end;
	}
	remaining += trimmed.slice(cursor);
	const cleaned = remaining
		.replace(/["()*:~^+-]/g, " ")
		.replace(/[^\p{L}\p{N}_\s]/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
	const terms = cleaned
		.split(" ")
		.filter(Boolean)
		.map((t) => `${t}*`);
	const all = [...phrases, ...terms];
	if (all.length === 0) return "";
	return all.slice(0, 8).join(" AND ");
}

function rawShape(matchExpr) {
	// Trigram native shape: strip the `*` prefix wildcards (trigram does
	// substring matching on every ≥3-char term natively).
	return matchExpr.replace(/\*/g, "");
}

function percentile(sorted, p) {
	if (sorted.length === 0) return 0;
	const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
	return sorted[idx];
}

function percentiles(samples) {
	const s = [...samples].sort((a, b) => a - b);
	return { p50: percentile(s, 0.5), p95: percentile(s, 0.95), p99: percentile(s, 0.99), n: s.length };
}

async function main() {
	const argv = process.argv.slice(2);
	const argVal = (name, dflt) => {
		const i = argv.indexOf(name);
		return i >= 0 ? argv[i + 1] : dflt;
	};
	const ROWS = parseInt(argVal("--rows", "8000"), 10);
	const ITERS = parseInt(argVal("--iter", "300"), 10);
	const jsonOut = argVal("--json-out", path.resolve(".agents/documents/analysis/fts5-trigram-eval-results.json"));

	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fts-trigram-eval-"));
	const dbPath = path.join(tmpDir, "eval.db");

	const db = new Database(dbPath);
	db.pragma("journal_mode = WAL");
	db.pragma("synchronous = NORMAL");
	db.pragma("busy_timeout = 5000");
	db.pragma("wal_autocheckpoint = 1000");
	const sqliteVersion = db.prepare("SELECT sqlite_version()").pluck().get();
	const pageSize = db.pragma("page_size", { simple: true });

	// Schema — mirrors v10-memories-fts but with TWO tokenizer variants.
	db.exec(`
		CREATE TABLE memories (id INTEGER PRIMARY KEY, title TEXT, content TEXT NOT NULL, tags TEXT);
		CREATE VIRTUAL TABLE memories_fts_unicode USING fts5(
			title, content, tags,
			content='memories', content_rowid='id', tokenize='unicode61'
		);
		CREATE VIRTUAL TABLE memories_fts_trigram USING fts5(
			title, content, tags,
			content='memories', content_rowid='id', tokenize='trigram'
		);
	`);

	// Corpus.
	const corpus = buildCorpus(ROWS);
	const insert = db.prepare("INSERT INTO memories (id, title, content, tags) VALUES (@id, @title, @content, @tags)");
	const fill = db.transaction((rows) => {
		for (const r of rows) insert.run(r);
	});
	fill(corpus);
	db.exec(`
		INSERT INTO memories_fts_unicode(rowid, title, content, tags) SELECT id, title, content, tags FROM memories;
		INSERT INTO memories_fts_trigram(rowid, title, content, tags) SELECT id, title, content, tags FROM memories;
	`);

	// fts5vocab token counts (best-effort). 'instance' = one row per token
	// occurrence (accurate token counts; 'row' undercounts to per-doc terms).
	const vocab = { unicode: null, trigram: null };
	try {
		db.exec(
			"CREATE VIRTUAL TABLE vocab_unicode USING fts5vocab(memories_fts_unicode, 'instance'); CREATE VIRTUAL TABLE vocab_trigram USING fts5vocab(memories_fts_trigram, 'instance');"
		);
		vocab.unicode = db
			.prepare("SELECT COUNT(*) AS tokens, COUNT(DISTINCT term) AS distinct_terms FROM vocab_unicode")
			.get();
		vocab.trigram = db
			.prepare("SELECT COUNT(*) AS tokens, COUNT(DISTINCT term) AS distinct_terms FROM vocab_trigram")
			.get();
	} catch {
		// fts5vocab unavailable → tokens omitted.
	}

	// Index footprint — measured cross-DB (whole-file size delta) because
	// SQLite exposes no reliable per-table page count: build three identical
	// DBs (base corpus only / +unicode FTS / +trigram FTS) and checkpoint.
	// Measured on BOTH corpora: the repetitive recall corpus (upper bound on
	// the delta — same trigrams recur in ~150 rows) and a unique-content
	// corpus (lower bound — real memories are mostly unique).
	const dbFileSize = (p) => {
		let bytes = fs.statSync(p).size;
		const wal = `${p}-wal`;
		if (fs.existsSync(wal)) bytes += fs.statSync(wal).size;
		return bytes;
	};
	const buildSizeDb = (tokenizer, rows, tag) => {
		const p = path.join(tmpDir, `size-${tag}-${tokenizer || "base"}.db`);
		const d = new Database(p);
		d.pragma("journal_mode = WAL");
		d.pragma("synchronous = NORMAL");
		d.pragma("busy_timeout = 5000");
		d.pragma("wal_autocheckpoint = 1000");
		d.exec(`
			CREATE TABLE memories (id INTEGER PRIMARY KEY, title TEXT, content TEXT NOT NULL, tags TEXT);
		`);
		const ins = d.prepare("INSERT INTO memories (id, title, content, tags) VALUES (@id, @title, @content, @tags)");
		d.transaction((rs) => {
			for (const r of rs) ins.run(r);
		})(rows);
		if (tokenizer) {
			d.exec(
				`CREATE VIRTUAL TABLE fts_index USING fts5(title, content, tags, content='memories', content_rowid='id', tokenize='${tokenizer}');
				 INSERT INTO fts_index(rowid, title, content, tags) SELECT id, title, content, tags FROM memories;`
			);
		}
		d.pragma("wal_checkpoint(TRUNCATE)");
		d.close();
		return dbFileSize(p);
	};
	const uniqueCorpus = buildUniqueCorpus(ROWS);
	const sizeFor = (rows, tag) => {
		const sizeBase = buildSizeDb(null, rows, tag);
		const unicodeBytes = buildSizeDb("unicode61", rows, tag) - sizeBase;
		const trigramBytes = buildSizeDb("trigram", rows, tag) - sizeBase;
		return { tag, unicodeBytes, trigramBytes, ratio: unicodeBytes ? trigramBytes / unicodeBytes : null };
	};
	const sizeRepetitive = sizeFor(corpus, "repetitive-recall-corpus");
	const sizeUnique = sizeFor(uniqueCorpus, "unique-content-corpus");
	const sizeUnicode = { bytes: sizeRepetitive.unicodeBytes, baseTotal: null };
	const sizeTrigram = { bytes: sizeRepetitive.trigramBytes, baseTotal: null };

	// Prepared statements.
	const likeOracle = db.prepare("SELECT id FROM memories WHERE content LIKE ? OR title LIKE ? OR tags LIKE ?");
	const stmt = {
		unicode: (k) =>
			db.prepare(
				`SELECT rowid FROM memories_fts_unicode WHERE memories_fts_unicode MATCH ? ORDER BY bm25(memories_fts_unicode) LIMIT ${k}`
			),
		trigram: (k) =>
			db.prepare(
				`SELECT rowid FROM memories_fts_trigram WHERE memories_fts_trigram MATCH ? ORDER BY bm25(memories_fts_trigram) LIMIT ${k}`
			)
	};
	const likeStmt = db.prepare(
		`SELECT id FROM memories WHERE content LIKE ? OR title LIKE ? OR tags LIKE ? ORDER BY id LIMIT ${50}`
	);

	// Oracle = rows the LIKE fallback would return, per query semantics:
	//   - `"phrase"`        → LIKE %phrase% (adjacent)
	//   - `a b c` (spaces)  → rows containing EVERY term (AND) — the LIKE
	//     fallback's literal %a b c% would be near-empty, so intersect the
	//     per-term LIKE sets to match FTS AND semantics fairly
	//   - single term        → LIKE %term%
	const likeIds = (needle) => likeOracle.all(`%${needle}%`, `%${needle}%`, `%${needle}%`).map((r) => r.id);
	const oracleRows = (q) => {
		const phrase = /"([^"]+)"/.exec(q);
		if (phrase) return likeIds(phrase[1].trim());
		const terms = q.trim().split(/\s+/).filter(Boolean);
		if (terms.length === 1) return likeIds(q.trim());
		let rows = likeIds(terms[0]);
		for (let i = 1; i < terms.length; i++) {
			const set = new Set(likeIds(terms[i]));
			rows = rows.filter((id) => set.has(id));
		}
		return rows;
	};

	const recallAt = (table, match, oracle, k) => {
		const out = { found: 0, hit: 0, err: null };
		try {
			const rows = stmt[table](k).all(match);
			out.found = rows.length;
			const set = new Set(rows.map((r) => r.rowid));
			for (const id of oracle) if (set.has(id)) out.hit++;
			out.recall = oracle.length > 0 ? out.hit / oracle.length : null;
		} catch (e) {
			out.err = String(e.message || e).split("\n")[0];
		}
		return out;
	};

	// --- Recall sweep ---
	const recallByClass = {};
	const shortCorner = [];
	const cjkNotes = [];
	const probes = [];
	const perQuery = [];
	for (const { cls, q } of QUERIES) {
		const oracle = oracleRows(q);
		const prod = buildFtsMatchQuery(q);
		const raw = rawShape(prod);
		const k10 = recallAt("unicode", prod, oracle, 10);
		const k50u = recallAt("unicode", prod, oracle, 50);
		const t10 = recallAt("trigram", prod, oracle, 10);
		const t50t = recallAt("trigram", prod, oracle, 50);
		const tr10 = recallAt("trigram", raw, oracle, 10);
		const tr50 = recallAt("trigram", raw, oracle, 50);

		perQuery.push({
			cls,
			q,
			oracle: oracle.length,
			prod,
			raw,
			unicode: { r10: k10, r50: k50u },
			trigram: { r10: t10, r50: t50t },
			trigramRaw: { r10: tr10, r50: tr50 }
		});
		recallByClass[cls] = recallByClass[cls] || [];
		recallByClass[cls].push({
			q,
			oracle: oracle.length,
			uniR10: k10.recall,
			uniR50: k50u.recall,
			triR10: t10.recall,
			triR50: t50t.recall,
			triRawR10: tr10.recall,
			triRawR50: tr50.recall,
			uniFound: k50u.found,
			triFound: t50t.found,
			triRawFound: tr50.found
		});

		if (cls === "short") {
			shortCorner.push({
				q,
				len: q.length,
				oracle: oracle.length,
				unicode_found: k50u.found,
				trigram_found: t50t.found,
				trigram_err: t50t.err
			});
		}
		if (cls === "diacritic") {
			probes.push({
				label: "diacritic",
				q,
				oracle: oracle.length,
				unicode_found: k50u.found,
				trigram_found: t50t.found,
				note: "unicode61 folds diacritics (café→cafe); trigram is byte-sensitive, LIKE is byte-sensitive"
			});
		}
		if (cls === "case") {
			probes.push({
				label: "case-sensitivity",
				q,
				oracle: oracle.length,
				unicode_found: k50u.found,
				trigram_found: t50t.found,
				note: "both fold ASCII case in SQLite 3.53 (trigram is case-insensitive for ASCII; unicode61 also folds + strips diacritics)"
			});
		}
		if (cls === "cjk" || cls === "cjk-midrun" || cls === "cjk-run3" || cls === "cjk-3char") {
			cjkNotes.push({
				q,
				len: q.length,
				oracle: oracle.length,
				uni_found: k50u.found,
				uni_recall50: k50u.recall,
				tri_found: t50t.found,
				tri_recall50: t50t.recall,
				triRaw_found: tr50.found,
				triRaw_recall50: tr50.recall,
				prod,
				raw
			});
		}
	}

	const classSummary = Object.entries(recallByClass).map(([cls, items]) => {
		const agg = (key) => {
			const vals = items.map((i) => i[key]).filter((v) => v !== null && v !== undefined);
			return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
		};
		const oracleTotal = items.reduce((a, i) => a + i.oracle, 0);
		return {
			cls,
			queries: items.length,
			oracleRows: oracleTotal,
			uni_recall10: agg("uniR10"),
			uni_recall50: agg("uniR50"),
			tri_recall10: agg("triR10"),
			tri_recall50: agg("triR50"),
			triRaw_recall10: agg("triRawR10"),
			triRaw_recall50: agg("triRawR50"),
			uni_found: items.reduce((a, i) => a + i.uniFound, 0),
			tri_found: items.reduce((a, i) => a + i.triFound, 0),
			triRaw_found: items.reduce((a, i) => a + i.triRawFound, 0)
		};
	});

	// --- Latency ---
	const latency = [];
	for (const { name, q } of SLOW_SHAPES) {
		const prod = buildFtsMatchQuery(q);
		const raw = rawShape(prod);
		const uniStmt = stmt.unicode(50);
		const triStmt = stmt.trigram(50);
		const triRawStmt = stmt.trigram(50);
		const samples = { unicode: [], trigram: [], trigramRaw: [], like: [] };
		for (let i = 0; i < ITERS; i++) {
			let t = process.hrtime.bigint();
			uniStmt.all(prod);
			samples.unicode.push(Number(process.hrtime.bigint() - t) / 1e6);
			t = process.hrtime.bigint();
			try {
				triStmt.all(prod);
				samples.trigram.push(Number(process.hrtime.bigint() - t) / 1e6);
			} catch {
				// trigram shape errored — record a NaN-flagged entry
				samples.trigram.push(Number.NaN);
			}
			t = process.hrtime.bigint();
			triRawStmt.all(raw);
			samples.trigramRaw.push(Number(process.hrtime.bigint() - t) / 1e6);
			t = process.hrtime.bigint();
			likeStmt.all(`%${q}%`, `%${q}%`, `%${q}%`);
			samples.like.push(Number(process.hrtime.bigint() - t) / 1e6);
		}
		const clean = (arr) => arr.filter((v) => !Number.isNaN(v));
		latency.push({
			name,
			q,
			prod,
			unicode_ms: percentiles(clean(samples.unicode)),
			trigram_ms: percentiles(clean(samples.trigram)),
			trigramRaw_ms: percentiles(clean(samples.trigramRaw)),
			like_ms: percentiles(clean(samples.like)),
			oracle: oracleRows(q).length
		});
	}

	// --- EXPLAIN QUERY PLAN (2-3 slow shapes) ---
	const explainShapes = [
		{ name: "single-broad", q: "sqlite" },
		{ name: "multi-and", q: "vector embedding semantic search" },
		{ name: "phrase", q: '"semantic search"' },
		{ name: "single-cjk", q: "记忆" }
	];
	const explain = [];
	for (const { name, q } of explainShapes) {
		const prod = buildFtsMatchQuery(q);
		const raw = rawShape(prod);
		const plan = (sql, params) => {
			try {
				return db
					.prepare(`EXPLAIN QUERY PLAN ${sql}`)
					.all(...params)
					.map((r) => r.detail || JSON.stringify(r));
			} catch (e) {
				return [`ERROR: ${String(e.message || e).split("\n")[0]}`];
			}
		};
		const ftsSql = (tbl) => `SELECT rowid FROM ${tbl} WHERE ${tbl} MATCH ?`;
		explain.push({
			name,
			q,
			unicode_prod: plan(ftsSql("memories_fts_unicode"), [prod]),
			trigram_prod: plan(ftsSql("memories_fts_trigram"), [prod]),
			trigram_raw: plan(ftsSql("memories_fts_trigram"), [raw]),
			like: plan("SELECT id FROM memories WHERE content LIKE ? OR title LIKE ? OR tags LIKE ?", [
				`%${q}%`,
				`%${q}%`,
				`%${q}%`
			])
		});
	}

	db.close();
	fs.rmSync(tmpDir, { recursive: true, force: true });

	// --- Output assembly ---
	const result = {
		meta: {
			task: "TASK-295",
			date: new Date().toISOString(),
			node: process.version,
			betterSqlite3: require("better-sqlite3/package.json").version,
			sqliteVersion,
			pageSize,
			corpusRows: ROWS,
			iterations: ITERS,
			corpusSource:
				"EN+ID+CJK sentences, tech identifiers, prefix-family stems, mid-word probes, café/WORKSPACE-BINARY case probes",
			productionShape: "buildFtsMatchQuery (every term suffixed `*`, phrases verbatim, AND, cap 8)"
		},
		recall: { classSummary, perQuery },
		size: {
			unicode: { ...sizeUnicode, vocab: vocab.unicode },
			trigram: { ...sizeTrigram, vocab: vocab.trigram },
			repetitiveCorpus: {
				unicodeBytes: sizeRepetitive.unicodeBytes,
				trigramBytes: sizeRepetitive.trigramBytes,
				deltaBytes: sizeRepetitive.trigramBytes - sizeRepetitive.unicodeBytes,
				ratio: sizeRepetitive.ratio
			},
			uniqueCorpus: {
				unicodeBytes: sizeUnique.unicodeBytes,
				trigramBytes: sizeUnique.trigramBytes,
				deltaBytes: sizeUnique.trigramBytes - sizeUnique.unicodeBytes,
				ratio: sizeUnique.ratio
			}
		},
		shortCorner,
		cjk: cjkNotes,
		probes,
		latency,
		explain
	};

	// Human-readable report snippet.
	const line = (s = "") => console.log(s);
	const pct = (v) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(1)}%`);
	line("======================================================================");
	line(`FTS5 TOKENIZER EVAL — TASK-295 (unicode61 prefix-* vs trigram)`);
	line(`sqlite ${sqliteVersion} · corpus ${ROWS} rows · ${ITERS} latency iters · page ${pageSize}B`);
	line("----------------------------------------------------------------------");
	line(
		`INDEX SIZE (FTS-only, DB-delta)  repetitive corpus ×${(sizeRepetitive.ratio ?? 0).toFixed(2)}   unique corpus ×${(sizeUnique.ratio ?? 0).toFixed(2)}`
	);
	line(
		`  repetitive: unicode61 ${(sizeRepetitive.unicodeBytes / 1024).toFixed(0)} KiB   trigram ${(sizeRepetitive.trigramBytes / 1024).toFixed(0)} KiB`
	);
	line(
		`  unique:     unicode61 ${(sizeUnique.unicodeBytes / 1024).toFixed(0)} KiB   trigram ${(sizeUnique.trigramBytes / 1024).toFixed(0)} KiB`
	);
	if (vocab.unicode && vocab.trigram) {
		line(
			`  vocab tokens (instance) unicode61: ${vocab.unicode.tokens.toLocaleString()} (${vocab.unicode.distinct_terms.toLocaleString()} terms)   trigram: ${vocab.trigram.tokens.toLocaleString()} (${vocab.trigram.distinct_terms.toLocaleString()} terms)`
		);
	}
	line("----------------------------------------------------------------------");
	line("RECALL (FTS-layer vs LIKE oracle; trRaw = trigram without `*` native shape; found@50 capped at 50)");
	line(`  class              oracle  u@10   u@50  t@10  t@50  tr@10 tr@50  found@50(u/t/tr)`);
	for (const c of classSummary) {
		line(
			`  ${c.cls.padEnd(18)}  ${String(c.oracleRows).padStart(6)}  ${pct(c.uni_recall10).padStart(6)}  ${pct(c.uni_recall50).padStart(6)}  ${pct(c.tri_recall10).padStart(6)}  ${pct(c.tri_recall50).padStart(6)}  ${pct(c.triRaw_recall10).padStart(6)}  ${pct(c.triRaw_recall50).padStart(6)}  ${String(c.uni_found).padStart(3)}/${String(c.tri_found).padStart(3)}/${String(c.triRaw_found).padStart(3)}`
		);
	}
	line("----------------------------------------------------------------------");
	line("<3-char corner (len 1/2/3): unicode61 found vs trigram found");
	for (const s of shortCorner) {
		line(
			`  "${s.q}" (${s.len})  oracle=${s.oracle}  unicode61=${s.unicode_found}  trigram=${s.trigram_found}${s.trigram_err ? `  ERR: ${s.trigram_err}` : ""}`
		);
	}
	line("----------------------------------------------------------------------");
	line("CJK probes");
	for (const c of cjkNotes) {
		line(
			`  "${c.q}" (${c.len})  oracle=${c.oracle}  uni=${c.uni_found} (${pct(c.uni_recall50)})  tri=${c.tri_found} (${pct(c.tri_recall50)})  triRaw=${c.triRaw_found} (${pct(c.triRaw_recall50)})`
		);
	}
	line("----------------------------------------------------------------------");
	line("Probes (case / diacritic)");
	for (const p of probes) {
		line(`  [${p.label}] "${p.q}"  oracle=${p.oracle}  unicode61=${p.unicode_found}  trigram=${p.trigram_found}`);
	}
	line("----------------------------------------------------------------------");
	line("LATENCY p50/p95 (ms) — unicode61 / trigram / trigramRaw / LIKE");
	for (const l of latency) {
		line(
			`  ${l.name.padEnd(16)}  ${l.unicode_ms.p50.toFixed(3)}/${l.unicode_ms.p95.toFixed(3)}   ${l.trigram_ms.p50.toFixed(3)}/${l.trigram_ms.p95.toFixed(3)}   ${l.trigramRaw_ms.p50.toFixed(3)}/${l.trigramRaw_ms.p95.toFixed(3)}   ${l.like_ms.p50.toFixed(3)}/${l.like_ms.p95.toFixed(3)}   (oracle=${l.oracle})`
		);
	}
	line("----------------------------------------------------------------------");
	line("EXPLAIN QUERY PLAN (detail lines)");
	for (const e of explain) {
		line(`  — ${e.name} "${e.q}"`);
		line(`    unicode61:  ${e.unicode_prod.join(" | ")}`);
		line(`    trigram:    ${e.trigram_prod.join(" | ")}`);
		line(`    trigramRaw: ${e.trigram_raw.join(" | ")}`);
		line(`    LIKE:       ${e.like.join(" | ")}`);
	}
	line("======================================================================");

	fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
	fs.writeFileSync(jsonOut, JSON.stringify(result, null, 2));
	console.log(`\nJSON → ${jsonOut}`);
}

main().catch((err) => {
	console.error("FATAL:", JSON.stringify(err && err.message));
	console.error("CODE:", JSON.stringify(err && err.code));
	process.exit(1);
});
