import { CodingStandardEntry } from "../types";

export function buildStandardVectorText(standard: Pick<
	CodingStandardEntry,
	"title" | "content" | "context" | "version" | "language" | "stack" | "tags" | "metadata"
>): string {
	return [
		standard.title,
		standard.content,
		standard.context,
		standard.version,
		standard.language ?? "",
		...standard.stack,
		...standard.tags,
		JSON.stringify(standard.metadata)
	]
		.filter(Boolean)
		.join("\n");
}
