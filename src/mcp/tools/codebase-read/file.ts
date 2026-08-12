import type { CodebaseReadInput } from "../schemas/codebase-read";
import { SQLiteStore } from "../../storage/sqlite";
import { createMcpResponse, type McpResponse } from "../../utils/mcp-response";

// ── FILE SYMBOLS ─────────────────────────────────────────────────────────

async function handleFileMode(validated: CodebaseReadInput, db: SQLiteStore): Promise<McpResponse> {
	const repo = validated.repo;
	if (!repo) {
		return createMcpResponse(
			{ error: "Mode 'file' requires a concrete 'repo'", code: "REPO_REQUIRED" },
			"Mode 'file' requires a concrete 'repo'.",
			{ includeJson: true }
		);
	}
	const filePath = validated.filePath!.trim();

	const file = db.codebaseFiles.getFile(repo, filePath);
	if (!file) {
		return createMcpResponse(
			{ error: "File not indexed. Run index_repository first.", code: "FILE_NOT_INDEXED" },
			`File '${filePath}' not found in index`,
			{ includeJson: true }
		);
	}

	const symbols = db.codebaseSymbols.getSymbolsByFile(repo, filePath);

	let symList = "";
	if (symbols.length > 0) {
		symList =
			`\n\n**Symbols**\n` +
			symbols
				.slice(0, 30)
				.map((s) => {
					const lineRange =
						s.start_line != null
							? s.end_line != null && s.end_line !== s.start_line
								? `L${s.start_line}-L${s.end_line}`
								: `L${s.start_line}`
							: "-";
					return `- \`${s.kind}\` ${s.name} ${lineRange}${s.exported ? " [exported]" : ""}`;
				})
				.join("\n");
		if (symbols.length > 30) {
			symList += `\n... and ${symbols.length - 30} more`;
		}
	}

	const contentSummary = `Found ${symbols.length} symbols in ${filePath}${symList}`;

	return createMcpResponse(
		{
			mode: "file",
			file: {
				path: file.file_path,
				language: file.language,
				checksum: file.checksum,
				lines: file.lines,
				sizeBytes: file.size_bytes,
				lastIndexedAt: file.last_indexed_at
			},
			symbols,
			total: symbols.length
		},
		`Found ${symbols.length} symbols in ${filePath}`,
		{ includeJson: true, contentSummary }
	);
}

export { handleFileMode };
