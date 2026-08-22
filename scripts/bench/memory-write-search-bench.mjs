#!/usr/bin/env node
import fs from "fs";
import os from "os";
import path from "path";
import { execSync } from "child_process";
import { createRequire } from "module";
import Database from "better-sqlite3";

import { buildMemoryCorpus } from "./memory-eval/corpus.mjs";
import { QUERY_SETS } from "./memory-eval/queries.mjs";
import { percentiles, throughput } from "./memory-eval/metrics.mjs";
import { printReport, writeResult } from "./memory-eval/report.mjs";

const require = createRequire(import.meta.url);

function computeVector(text) {
	const tokens = text
		.toLowerCase()
		.replace(/[^\w\s\u00C0-\u017F]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.split(/\s+/)
		.filter((w) => w.length > 2);
	const STOP = new Set([
		"the",
		"and",
		"for",
		"are",
		"with",
		"this",
		"that",
		"from",
		"have",
		"has",
		"was",
		"were",
		"been",
		"will",
		"would",
		"can",
		"could",
		"should",
		"about",
		"into",
		"through",
		"using",
		"before",
		"after",
		"yang",
		"dan",
		"untuk",
		"dari",
		"dengan",
		"adalah",
		"pada",
		"dalam",
		"akan",
		"oleh",
		"karena",
		"sebagai",
		"juga",
		"tidak",
		"telah"
	]);
	const filtered = tokens.filter((w) => !STOP.has(w));
	const vec = Object.create(null);
	for (const tok of filtered) vec[tok] = (vec[tok] || 0) + 1;
	return vec;
}

function cosineSimilarity(v1, v2) {
	const k1 = Object.keys(v1);
	const k2 = Object.keys(v2);
	if (!k1.length || !k2.length) return 0;
	let dot = 0;
	for (const k of k1) if (Object.hasOwn(v2, k)) dot += v1[k] * v2[k];
	let m1 = 0;
	for (const k of k1) m1 += v1[k] * v1[k];
	let m2 = 0;
	for (const k of k2) m2 += v2[k] * v2[k];
	const mag = Math.sqrt(m1) * Math.sqrt(m2);
	return mag === 0 ? 0 : dot / mag;
}

function buildFtsMatchQuery(raw) {
	if (!raw) return "";
	const trimmed = raw.trim();
	if (!trimmed) return "";
	const phrases = [];
	const phraseRanges = [];
	const re = /"([^"]+)"/g;
	let m;
	while ((m = re.exec(trimmed)) !== null) {
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

function createBenchDb(dbPath) {
	if (dbPath !== ":memory:") {
		const dir = path.dirname(dbPath);
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	}
	const db = new Database(dbPath);
	db.pragma("journal_mode = WAL");
	db.pragma("synchronous = NORMAL");
	db.pragma("busy_timeout = 5000");
	db.pragma("wal_autocheckpoint = 1000");
	db.exec(`
		CREATE TABLE IF NOT EXISTS memories (
			id TEXT PRIMARY KEY, code TEXT, repo TEXT NOT NULL, owner TEXT NOT NULL DEFAULT '',
			type TEXT NOT NULL, title TEXT, content TEXT NOT NULL, importance INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 5),
			folder TEXT, language TEXT, branch TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
			hit_count INTEGER NOT NULL DEFAULT 0, recall_count INTEGER NOT NULL DEFAULT 0, last_used_at TEXT,
			agent TEXT NOT NULL DEFAULT 'unknown', role TEXT NOT NULL DEFAULT 'unknown', model TEXT NOT NULL DEFAULT 'unknown',
			completed_at TEXT, expires_at TEXT, supersedes TEXT, status TEXT NOT NULL DEFAULT 'active',
			is_global INTEGER NOT NULL DEFAULT 0, tags TEXT, metadata TEXT
		);
		CREATE TABLE IF NOT EXISTS memory_vectors (memory_id TEXT PRIMARY KEY, vector TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE);
		CREATE TABLE IF NOT EXISTS memory_tags (memory_id TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY (memory_id, tag), FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE);
		CREATE INDEX IF NOT EXISTS idx_memory_tags_tag ON memory_tags(tag COLLATE NOCASE);
		CREATE INDEX IF NOT EXISTS idx_memories_repo ON memories(repo);
		CREATE INDEX IF NOT EXISTS idx_memories_owner_repo ON memories(owner, repo);
	`);
	const ftsExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts'").get();
	if (!ftsExists) {
		db.exec(`
			CREATE VIRTUAL TABLE memories_fts USING fts5(title, content, tags, content='memories', content_rowid='rowid', tokenize='unicode61');
			CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN INSERT INTO memories_fts(rowid, title, content, tags) VALUES (new.rowid, new.title, new.content, new.tags); END;
			CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN INSERT INTO memories_fts(memories_fts, rowid, title, content, tags) VALUES('delete', old.rowid, old.title, old.content, old.tags); END;
			CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN INSERT INTO memories_fts(memories_fts, rowid, title, content, tags) VALUES('delete', old.rowid, old.title, old.content, old.tags); INSERT INTO memories_fts(rowid, title, content, tags) VALUES (new.rowid, new.title, new.content, new.tags); END;
		`);
	}
	return db;
}

function searchFts(db, query, owner, repo, limit = 10) {
	try {
		const safeQuery = buildFtsMatchQuery(query);
		if (!safeQuery) return [];
		const rows = db
			.prepare(
				`SELECT m.* FROM memories_fts fts JOIN memories m ON m.rowid = fts.rowid WHERE memories_fts MATCH ? AND m.owner = ? AND m.repo = ? AND m.status = 'active' AND (m.expires_at IS NULL OR m.expires_at > ?) ORDER BY bm25(memories_fts), m.importance DESC, m.created_at DESC LIMIT ?`
			)
			.all(safeQuery, owner, repo, new Date().toISOString(), limit);
		return rows;
	} catch {
		return [];
	}
}

function searchSemantic(db, query, owner, repo, limit = 10, tfCache = new Map()) {
	const queryVector = computeVector(query);
	const now = new Date();
	const candidates = db
		.prepare(
			`SELECT * FROM memories WHERE owner = ? AND repo = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > ?) ORDER BY importance DESC, created_at DESC LIMIT ?`
		)
		.all(owner, repo, now.toISOString(), Math.max(limit * 3, 100));
	const scored = candidates
		.map((row) => {
			let vec = tfCache.get(row.id);
			if (!vec || tfCache.get(row.id + ":updated") !== row.updated_at) {
				vec = computeVector(row.content);
				tfCache.set(row.id, vec);
				tfCache.set(row.id + ":updated", row.updated_at);
				if (tfCache.size > 2048) {
					const keys = [...tfCache.keys()].slice(0, 1024);
					for (const k of keys) tfCache.delete(k);
				}
			}
			const sim = cosineSimilarity(queryVector, vec) || 0;
			return { row, sim: sim || 0.16 };
		})
		.filter((r) => r.sim > 0)
		.sort((a, b) => b.sim - a.sim)
		.slice(0, limit);
	return scored.map((s) => s.row);
}

function hybridSearch(db, query, owner, repo, limit = 10, tfCache) {
	const ftsRows = searchFts(db, query, owner, repo, 100);
	const ftsScoreMap = new Map();
	if (ftsRows.length > 0) {
		const bm25Rows = (() => {
			try {
				const safeQuery = buildFtsMatchQuery(query);
				if (!safeQuery) return [];
				return db
					.prepare(
						`SELECT m.*, bm25(memories_fts) AS bm25_score FROM memories_fts fts JOIN memories m ON m.rowid = fts.rowid WHERE memories_fts MATCH ? AND ((m.owner = ? AND m.repo = ?) OR m.is_global = 1) AND m.status = 'active' AND (m.expires_at IS NULL OR m.expires_at > ?) ORDER BY bm25_score LIMIT ?`
					)
					.all(safeQuery, owner, repo, new Date().toISOString(), 100);
			} catch {
				return [];
			}
		})();
		if (bm25Rows.length > 0) {
			let minB = Infinity,
				maxB = -Infinity;
			for (const r of bm25Rows) {
				if (r.bm25_score < minB) minB = r.bm25_score;
				if (r.bm25_score > maxB) maxB = r.bm25_score;
			}
			const range = maxB - minB;
			for (const r of bm25Rows) {
				const norm = range === 0 ? 1.0 : 1 - (r.bm25_score - minB) / range;
				ftsScoreMap.set(r.id, norm);
			}
		}
	}
	const semRows = searchSemantic(db, query, owner, repo, 100, tfCache);
	const candidates = new Map();
	for (const r of semRows)
		candidates.set(r.id, { row: r, sim: cosineSimilarity(computeVector(query), computeVector(r.content)) || 0.16 });
	for (const r of ftsRows) if (!candidates.has(r.id)) candidates.set(r.id, { row: r, sim: 0 });
	const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);
	const scored = [...candidates.values()]
		.map(({ row, sim }) => {
			const keyword = ftsScoreMap.get(row.id) ?? 0;
			const recency = Math.pow(2, -(Date.now() - new Date(row.created_at).getTime()) / (30 * 24 * 60 * 60 * 1000));
			const domain = row.tags
				? (() => {
						try {
							const tags = JSON.parse(row.tags);
							const qSet = new Set(queryTerms);
							return tags.filter((t) => qSet.has(String(t).toLowerCase())).length / Math.max(tags.length, 1);
						} catch {
							return 0;
						}
					})()
				: 0;
			const final = sim * 0.4 + keyword * 0.3 + recency * 0.15 + domain * 0.15;
			return { row, final };
		})
		.sort((a, b) => b.final - a.final);
	const threshold = scored.length <= 5 ? 0.1 : 0.4;
	let eligible = scored.filter((s) => s.final >= threshold);
	if (eligible.length === 0 && scored.length > 0) eligible = [scored[0]];
	return eligible.slice(0, limit).map((s) => s.row);
}

async function main() {
	const argv = process.argv.slice(2);
	const argVal = (name, dflt) => {
		const i = argv.indexOf(name);
		return i >= 0 ? argv[i + 1] : dflt;
	};
	const scalesArg = argVal("--scales", "1000,10000,100000");
	const scales = scalesArg
		.split(",")
		.map((s) => parseInt(s.trim(), 10))
		.filter((n) => Number.isFinite(n) && n > 0);
	const ITERS = parseInt(argVal("--iter", "100"), 10);
	const jsonOut = argVal(
		"--json-out",
		path.resolve(".agents/documents/analysis/memory-write-search-bench-results.json")
	);
	const markdownOut = argVal("--markdown-out", path.resolve(".agents/documents/analysis/memory-write-search-bench.md"));
	const seed = 0x478;
	const owner = "bench";
	const repo = "bench-repo";
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-write-search-bench-"));
	let hardwareLimit = null;
	const scaleResults = [];

	try {
		const betterSqlite3Version = require("better-sqlite3/package.json").version;

		for (const rows of scales) {
			const scaleTmpDir = path.join(tmpDir, `scale-${rows}`);
			fs.mkdirSync(scaleTmpDir, { recursive: true });
			const dbPath = path.join(scaleTmpDir, "bench.db");
			let db = null;
			try {
				db = createBenchDb(dbPath);
				const sqliteVersion = db.prepare("SELECT sqlite_version()").pluck().get();
				const pageSize = db.pragma("page_size", { simple: true });
				const corpus = buildMemoryCorpus(rows, seed + rows, owner, repo);

				const insertStmt = db.prepare(
					`INSERT INTO memories (id, code, repo, owner, type, title, content, importance, folder, language, branch, created_at, updated_at, hit_count, recall_count, last_used_at, agent, role, model, completed_at, expires_at, supersedes, status, is_global, tags, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
				);
				const vectorStmt = db.prepare(
					`INSERT INTO memory_vectors (memory_id, vector, updated_at) VALUES (?, ?, ?) ON CONFLICT(memory_id) DO UPDATE SET vector = excluded.vector, updated_at = excluded.updated_at`
				);
				const tagStmt = db.prepare(`INSERT OR IGNORE INTO memory_tags (memory_id, tag) VALUES (?, ?)`);

				const writeSamples = [];
				let writeErrors = 0;
				const writeStart = process.hrtime.bigint();
				const tx = db.transaction((entries) => {
					for (const entry of entries) {
						const t0 = process.hrtime.bigint();
						try {
							insertStmt.run(
								entry.id,
								entry.code || null,
								entry.scope.repo,
								entry.scope.owner,
								entry.type,
								entry.title || null,
								entry.content,
								entry.importance,
								entry.scope.folder || null,
								entry.scope.language || null,
								entry.scope.branch || null,
								entry.created_at,
								entry.updated_at,
								entry.agent || "unknown",
								entry.role || "unknown",
								entry.model || "unknown",
								entry.completed_at || null,
								entry.expires_at ?? null,
								entry.supersedes ?? null,
								entry.status || "active",
								entry.is_global ? 1 : 0,
								entry.tags ? JSON.stringify(entry.tags) : null,
								entry.metadata ? JSON.stringify(entry.metadata) : null
							);
							const text = `${entry.title} ${entry.content} ${entry.tags.join(" ")}`;
							const freq = computeVector(text);
							vectorStmt.run(entry.id, JSON.stringify(freq), new Date().toISOString());
							for (const tag of entry.tags) tagStmt.run(entry.id, tag);
						} catch {
							writeErrors++;
						}
						writeSamples.push(Number(process.hrtime.bigint() - t0) / 1e6);
					}
				});
				tx(corpus);
				const writeElapsedMs = Number(process.hrtime.bigint() - writeStart) / 1e6;
				const writeLatency = percentiles(writeSamples);
				const writeThroughput = throughput(corpus.length, writeElapsedMs);

				let dbBytes = null;
				try {
					db.pragma("wal_checkpoint(TRUNCATE)");
					let bytes = fs.statSync(dbPath).size;
					const wal = `${dbPath}-wal`;
					if (fs.existsSync(wal)) bytes += fs.statSync(wal).size;
					dbBytes = bytes;
				} catch {
					dbBytes = null;
				}
				let heapBytes = null;
				try {
					heapBytes = process.memoryUsage().heapUsed;
				} catch {
					heapBytes = null;
				}

				const tfCache = new Map();
				const searchModes = ["fts", "semantic", "hybrid"];
				const searchResults = {};

				for (const mode of searchModes) {
					const samples = [];
					let errors = 0;
					let totalResults = 0;
					let totalOps = 0;
					const modeStart = process.hrtime.bigint();
					for (let iter = 0; iter < ITERS; iter++) {
						for (const { query } of QUERY_SETS) {
							const t0 = process.hrtime.bigint();
							try {
								let results = [];
								if (mode === "fts") results = searchFts(db, query, owner, repo, 10);
								else if (mode === "semantic") results = searchSemantic(db, query, owner, repo, 10, tfCache);
								else results = hybridSearch(db, query, owner, repo, 10, tfCache);
								totalResults += Array.isArray(results) ? results.length : 0;
							} catch {
								errors++;
							}
							samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
							totalOps++;
						}
					}
					const elapsedMs = Number(process.hrtime.bigint() - modeStart) / 1e6;
					const latency = percentiles(samples);
					const tp = throughput(totalOps, elapsedMs);
					const avgResults = totalOps > 0 ? totalResults / totalOps : 0;
					searchResults[mode] = { latency, throughput: tp, errors, total: totalOps, avgResults, elapsedMs };
				}

				const perQueryBreakdown = [];
				for (const { kind, query } of QUERY_SETS) {
					const qSamples = [];
					let qErrors = 0;
					let qTotalResults = 0;
					const iters = Math.min(ITERS, 20);
					for (let iter = 0; iter < iters; iter++) {
						const t0 = process.hrtime.bigint();
						try {
							const results = hybridSearch(db, query, owner, repo, 10, tfCache);
							qTotalResults += Array.isArray(results) ? results.length : 0;
						} catch {
							qErrors++;
						}
						qSamples.push(Number(process.hrtime.bigint() - t0) / 1e6);
					}
					const lat = percentiles(qSamples);
					perQueryBreakdown.push({
						kind,
						query: query || "(empty)",
						p50: lat.p50,
						p95: lat.p95,
						p99: lat.p99,
						mean: lat.mean,
						avgResults: qSamples.length ? qTotalResults / qSamples.length : 0,
						errors: qErrors
					});
				}

				scaleResults.push({
					rows,
					dbBytes,
					heapBytes,
					pageSize,
					sqliteVersion,
					write: {
						latency: writeLatency,
						throughput: writeThroughput,
						errors: writeErrors,
						total: corpus.length,
						elapsedMs: writeElapsedMs
					},
					search: searchResults,
					queryBreakdown: perQueryBreakdown
				});
				db.close();
				db = null;
			} catch (err) {
				if (db?.open) {
					try {
						db.close();
					} catch {}
					db = null;
				}
				const msg = String(err?.message || err);
				if (/ENOMEM|heap|memory|allocation/i.test(msg) || rows >= 100000) {
					hardwareLimit = `scale ${rows} failed: ${msg.slice(0, 200)}`;
					break;
				}
				throw err;
			} finally {
				if (db?.open) {
					try {
						db.close();
					} catch {}
				}
			}
		}

		let commitShaFinal = null;
		try {
			commitShaFinal = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim() || null;
		} catch {
			commitShaFinal = null;
		}
		let referencePageSize = null;
		let referenceSqliteVersion = null;
		if (scaleResults.length > 0) {
			referencePageSize = scaleResults[0].pageSize;
			referenceSqliteVersion = scaleResults[0].sqliteVersion;
		} else {
			try {
				const probe = createBenchDb(path.join(tmpDir, "probe.db"));
				referenceSqliteVersion = probe.prepare("SELECT sqlite_version()").pluck().get();
				referencePageSize = probe.pragma("page_size", { simple: true });
				probe.close();
			} catch {}
		}

		const lastScale = scaleResults[scaleResults.length - 1];
		const result = {
			meta: {
				task: "TASK-478",
				seed,
				commitSha: commitShaFinal,
				date: new Date().toISOString(),
				node: process.version,
				betterSqlite3: require("better-sqlite3/package.json").version,
				sqliteVersion: referenceSqliteVersion,
				pageSize: referencePageSize,
				owner,
				repo,
				scales: scales.slice(0, scaleResults.length),
				requestedScales: scales,
				iterations: ITERS,
				vectorBackend: "stub (TF cosine, no ONNX)",
				queryKinds: [...new Set(QUERY_SETS.map((q) => q.kind))],
				queryCount: QUERY_SETS.length,
				...(hardwareLimit ? { hardwareLimit } : {}),
				...(lastScale ? { memory: { heapUsed: lastScale.heapBytes, dbBytes: lastScale.dbBytes } } : {})
			},
			scales: scaleResults
		};
		printReport(result);
		writeResult(jsonOut, result, markdownOut);
	} finally {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
}

main().catch((err) => {
	console.error("FATAL:", JSON.stringify(err && err.message));
	console.error("CODE:", JSON.stringify(err && err.code));
	process.exit(1);
});
