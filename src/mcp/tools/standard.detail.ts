import { SQLiteStore } from "../storage/sqlite";
import { createMcpResponse } from "../utils/mcp-response";
import { UUID_REGEX } from "../utils/uuid";
import { StandardDetailSchema } from "./schemas";

export async function handleStandardDetail(args: Record<string, unknown>, storage: SQLiteStore) {
	const validated = StandardDetailSchema.parse(args);
	const { id, code, owner, repo } = validated;

	let standard;
	if (id) {
		standard = UUID_REGEX.test(id) ? storage.standards.getById(id) : storage.standards.getByCode(id, owner, repo);
	} else if (code) {
		standard = storage.standards.getByCode(code, owner, repo);
	}

	if (!standard) {
		const identifier = id ?? code;
		throw new Error(`Coding standard not found: ${identifier}`);
	}

	storage.standards.incrementHitCounts([standard.id]);

	const lines: string[] = [
		`ID: ${standard.id}`,
		...(standard.code ? [`Code: ${standard.code}`] : []),
		`Title: ${standard.title}`,
		`Parent ID: ${standard.parent_id || "-"}`,
		`Context: ${standard.context}`,
		`Version: ${standard.version}`,
		`Language: ${standard.language || "-"}`,
		`Scope: ${standard.is_global ? "global" : standard.repo || "-"}`,
		`Created: ${standard.created_at}`,
		`Updated: ${standard.updated_at}`
	];

	if (standard.stack.length > 0) lines.push(`Stack: ${standard.stack.join(", ")}`);
	if (standard.tags.length > 0) lines.push(`Tags: ${standard.tags.join(", ")}`);
	if (Object.keys(standard.metadata).length > 0) lines.push(`Metadata: ${JSON.stringify(standard.metadata)}`);
	if (standard.content) {
		lines.push("", "--- Content ---", standard.content);
	}

	const content = lines.join("\n");

	return createMcpResponse(standard, content, {
		contentSummary: content,
		includeSerializedStructuredContent: validated.structured
	});
}
