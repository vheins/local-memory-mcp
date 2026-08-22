import fs from "fs";
import path from "path";

function formatLatency(v) {
	if (!v) return "—";
	return `${v.p50.toFixed(3)} / ${v.p95.toFixed(3)} / ${v.p99.toFixed(3)}`;
}

function formatThroughput(v) {
	if (v == null) return "—";
	return `${v.toFixed(1)} ops/s`;
}

export function printReport(result) {
	const line = (s = "") => console.log(s);
	const { meta, scales } = result;
	line("======================================================================");
	line(`MEMORY WRITE+SEARCH BENCH — TASK-478`);
	line(
		`commit ${meta.commitSha ?? "unknown"} · node ${meta.node} · sqlite ${meta.sqliteVersion} · page ${meta.pageSize}B`
	);
	line(`seed 0x${meta.seed.toString(16)} · owner ${meta.owner} · repo ${meta.repo}`);
	line(`scales: ${meta.scales.join(", ")} · iterations: ${meta.iterations} · stub vectors (no ONNX)`);
	if (meta.hardwareLimit) line(`hardware limit: ${meta.hardwareLimit}`);
	line("----------------------------------------------------------------------");
	for (const s of scales) {
		line(
			`SCALE ${s.rows} rows — db ${(s.dbBytes / 1024).toFixed(0)} KiB · heap ${(s.heapBytes / 1024).toFixed(0)} KiB`
		);
		if (s.write) {
			const w = s.write;
			line(
				`  WRITE  p50/p95/p99 ${formatLatency(w.latency)} ms · mean ${w.latency.mean.toFixed(3)} ms · throughput ${formatThroughput(w.throughput)} · errors ${w.errors}/${w.total}`
			);
		}
		if (s.search) {
			for (const mode of ["fts", "semantic", "hybrid"]) {
				const m = s.search[mode];
				if (!m) continue;
				line(
					`  SEARCH ${mode.padEnd(8)} p50/p95/p99 ${formatLatency(m.latency)} ms · throughput ${formatThroughput(m.throughput)} · errors ${m.errors}/${m.total} · avgResults ${m.avgResults.toFixed(1)}`
				);
			}
		}
		if (s.queryBreakdown && s.queryBreakdown.length) {
			line(`  query breakdown (hybrid):`);
			for (const q of s.queryBreakdown) {
				line(
					`    ${q.kind.padEnd(12)} "${q.query.slice(0, 40)}"  p50 ${q.p50.toFixed(3)} ms  p95 ${q.p95.toFixed(3)} ms  results ${q.avgResults.toFixed(1)}  err ${q.errors}`
				);
			}
		}
		line("----------------------------------------------------------------------");
	}
	line("======================================================================");
}

export function writeResult(jsonOut, result, markdownOut) {
	fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
	fs.writeFileSync(jsonOut, JSON.stringify(result, null, 2));
	console.log(`\nJSON → ${jsonOut}`);
	if (markdownOut) {
		fs.mkdirSync(path.dirname(markdownOut), { recursive: true });
		const { meta, scales } = result;
		const lines = [
			`# Memory Write+Search Benchmark — TASK-478`,
			``,
			`- Task: ${meta.task}`,
			`- Seed: 0x${meta.seed.toString(16)}`,
			`- Commit: ${meta.commitSha ?? "unknown"}`,
			`- Node: ${meta.node}`,
			`- better-sqlite3: ${meta.betterSqlite3}`,
			`- SQLite: ${meta.sqliteVersion}`,
			`- Page size: ${meta.pageSize}`,
			`- Owner/Repo: ${meta.owner} / ${meta.repo}`,
			`- Scales: ${meta.scales.join(", ")}`,
			`- Iterations: ${meta.iterations}`,
			`- Vector backend: stub (TF cosine, no ONNX)`,
			...(meta.hardwareLimit ? [`- Hardware limit: ${meta.hardwareLimit}`] : []),
			`- Date: ${meta.date}`,
			``,
			`## Write Latency (per insert)`,
			``,
			`| Scale | p50 (ms) | p95 (ms) | p99 (ms) | Mean (ms) | Throughput | Errors |`,
			`| --- | ---: | ---: | ---: | ---: | ---: | ---: |`,
			...scales.map((s) => {
				const w = s.write;
				if (!w) return `| ${s.rows} | — | — | — | — | — | — |`;
				return `| ${s.rows} | ${w.latency.p50.toFixed(3)} | ${w.latency.p95.toFixed(3)} | ${w.latency.p99.toFixed(3)} | ${w.latency.mean.toFixed(3)} | ${w.throughput.toFixed(1)} ops/s | ${w.errors}/${w.total} |`;
			}),
			``,
			`## Search Latency (per query)`,
			``,
			`| Scale | Mode | p50 (ms) | p95 (ms) | p99 (ms) | Throughput | Errors | Avg results |`,
			`| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |`,
			...scales.flatMap((s) =>
				["fts", "semantic", "hybrid"].map((mode) => {
					const m = s.search?.[mode];
					if (!m) return `| ${s.rows} | ${mode} | — | — | — | — | — | — |`;
					return `| ${s.rows} | ${mode} | ${m.latency.p50.toFixed(3)} | ${m.latency.p95.toFixed(3)} | ${m.latency.p99.toFixed(3)} | ${m.throughput.toFixed(1)} ops/s | ${m.errors}/${m.total} | ${m.avgResults.toFixed(1)} |`;
				})
			),
			``,
			`## Query Breakdown (hybrid, per-kind)`,
			``,
			`| Scale | Kind | Query | p50 (ms) | p95 (ms) | Avg results | Errors |`,
			`| --- | --- | --- | ---: | ---: | ---: | ---: |`,
			...scales.flatMap((s) =>
				(s.queryBreakdown ?? []).map(
					(q) =>
						`| ${s.rows} | ${q.kind} | \`${q.query.replace(/`/g, "'").slice(0, 48)}\` | ${q.p50.toFixed(3)} | ${q.p95.toFixed(3)} | ${q.avgResults.toFixed(1)} | ${q.errors} |`
				)
			),
			``,
			`## Environment`,
			``,
			`| Key | Value |`,
			`| --- | --- |`,
			`| commitSha | ${meta.commitSha ?? "unknown"} |`,
			`| node | ${meta.node} |`,
			`| better-sqlite3 | ${meta.betterSqlite3} |`,
			`| sqliteVersion | ${meta.sqliteVersion} |`,
			`| pageSize | ${meta.pageSize} |`,
			`| heapUsed (last scale) | ${scales[scales.length - 1]?.heapBytes ?? "—"} |`,
			`| dbBytes (last scale) | ${scales[scales.length - 1]?.dbBytes ?? "—"} |`,
			``
		].join("\n");
		fs.writeFileSync(markdownOut, `${lines}\n`);
		console.log(`Markdown → ${markdownOut}`);
	}
}
