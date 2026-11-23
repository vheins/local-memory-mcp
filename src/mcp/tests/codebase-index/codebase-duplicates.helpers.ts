import fs from "node:fs";
import path from "node:path";
import { handleCodebaseRead } from "../../tools/codebase.read";
import { data } from "./mcp-tools.integration.shared.js";
import type { SQLiteStore } from "../../storage/sqlite.js";
import type { VectorStore } from "../../types.js";

/** 1-based inclusive line span of a symbol in a fixture file. */
export interface Span {
	start: number;
	end: number;
}

/** Accumulate a file's lines while recording each symbol's exact line span. */
export class FixtureFile {
	readonly lines: string[] = [];

	/** Append a symbol body and return its 1-based inclusive span. */
	add(body: string[]): Span {
		const start = this.lines.length + 1;
		this.lines.push(...body);
		return { start, end: this.lines.length };
	}

	/** Append a blank separator line. */
	gap(): void {
		this.lines.push("");
	}

	toString(): string {
		return this.lines.join("\n") + "\n";
	}
}

export interface FixtureSymbolSpec {
	file: string;
	name: string;
	kind: string;
	span: Span;
	signature?: string;
}

/** Build an `indexFixture` bound to one test store + temp directory. */
export function makeIndexer(store: SQLiteStore, tempDir: string) {
	/** Write a fixture file under tempDir and index it plus its symbols. */
	return function indexFixture(repo: string, filePath: string, file: FixtureFile, symbols: FixtureSymbolSpec[]): void {
		const absolute = path.join(tempDir, filePath);
		fs.mkdirSync(path.dirname(absolute), { recursive: true });
		const content = file.toString();
		fs.writeFileSync(absolute, content, "utf-8");
		store.codebaseFiles.upsertFile({
			repo,
			file_path: filePath,
			language: "typescript",
			checksum: `${repo}:${filePath}:sum`,
			lines: content.split("\n").length,
			size_bytes: Buffer.byteLength(content, "utf-8")
		});
		store.codebaseSymbols.bulkUpsertSymbols(
			symbols.map((symbol) => ({
				repo,
				file_path: symbol.file,
				name: symbol.name,
				kind: symbol.kind,
				exported: true,
				start_line: symbol.span.start,
				end_line: symbol.span.end,
				signature: symbol.signature ?? null,
				source_fingerprint: `${repo}:${symbol.file}:${symbol.name}:${symbol.span.start}`
			}))
		);
	};
}

/** A seven-line function body used by the fixture tests. */
export const BODY = (name: string, params: string, multiply: string): string[] => [
	`export function ${name}(${params}): number {`,
	"\tlet total = 0;",
	"\tfor (const item of items) {",
	`\t\ttotal ${multiply} item * 2;`,
	"\t}",
	"\treturn total;",
	"}"
];

/** Build a `runDuplicates` bound to one test store + temp directory. */
export function makeRunDuplicates(store: SQLiteStore, vectors: VectorStore, tempDir: string) {
	/** Run DUPLICATES through the real dispatcher (mode inference included). */
	return async function runDuplicates(repo: string, extra: Record<string, unknown> = {}) {
		const resp = await handleCodebaseRead(
			{ owner: "vheins", json: true, repo, repoPath: tempDir, action: "duplicates", ...extra },
			store,
			vectors
		);
		return { resp, d: data(resp) };
	};
}
