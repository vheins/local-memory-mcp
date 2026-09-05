import type { CodebaseSymbol, CodingStandardEntry, ExplorationObservation, Handoff, MemoryEntry, Task } from "../types";
import { TASK_STATUS_IN_PROGRESS } from "../types";

export const AGENT_CONTEXT_SOURCE_ORDER = [
	"tasks",
	"decisions",
	"handoffs",
	"standards",
	"observations",
	"code",
	"memories"
] as const;
export type AgentContextSource = (typeof AGENT_CONTEXT_SOURCE_ORDER)[number];

export interface ContextCandidate {
	source: AgentContextSource;
	id: string;
	title: string;
	text: string;
	provenance: Record<string, unknown>;
	priority: number;
	critical: boolean;
	estimated_tokens: number;
}

export interface ContextExclusion {
	source: AgentContextSource;
	id: string;
	reason: "token_budget" | "item_budget";
	estimated_tokens: number;
}

function estimateTokens(text: string): number {
	return Math.max(12, Math.ceil(text.length / 4) + 8);
}

function lexicalScore(text: string, objective: string): number {
	const terms = [
		...new Set(
			objective
				.toLocaleLowerCase("en-US")
				.split(/[^a-z0-9_/-]+/)
				.filter((term) => term.length > 1)
		)
	];
	if (terms.length === 0) return 0;
	const normalized = text.toLocaleLowerCase("en-US");
	return terms.filter((term) => normalized.includes(term)).length / terms.length;
}

function candidate(
	source: AgentContextSource,
	id: string,
	title: string,
	text: string,
	priority: number,
	critical: boolean,
	provenance: Record<string, unknown>
): ContextCandidate {
	return {
		source,
		id,
		title,
		text,
		priority,
		critical,
		provenance,
		estimated_tokens: estimateTokens(`${title}: ${text}`)
	};
}

export function rankAndPackContext(
	candidates: ContextCandidate[],
	objective: string,
	budget: { tokens: number; max_items: number }
): { included: ContextCandidate[]; exclusions: ContextExclusion[]; estimatedTokens: number } {
	const sourceRank = new Map(AGENT_CONTEXT_SOURCE_ORDER.map((source, index) => [source, index]));
	const ranked = [...candidates].sort((a, b) => {
		if (a.critical !== b.critical) return a.critical ? -1 : 1;
		const valueA = (a.priority + lexicalScore(`${a.title} ${a.text}`, objective) * 5) / a.estimated_tokens;
		const valueB = (b.priority + lexicalScore(`${b.title} ${b.text}`, objective) * 5) / b.estimated_tokens;
		return (
			valueB - valueA || (sourceRank.get(a.source) ?? 99) - (sourceRank.get(b.source) ?? 99) || a.id.localeCompare(b.id)
		);
	});
	const included: ContextCandidate[] = [];
	const exclusions: ContextExclusion[] = [];
	let estimatedTokens = 0;
	for (const item of ranked) {
		const reason =
			included.length >= budget.max_items
				? "item_budget"
				: estimatedTokens + item.estimated_tokens > budget.tokens
					? "token_budget"
					: null;
		if (reason) {
			exclusions.push({ source: item.source, id: item.id, reason, estimated_tokens: item.estimated_tokens });
			continue;
		}
		included.push(item);
		estimatedTokens += item.estimated_tokens;
	}
	return { included, exclusions, estimatedTokens };
}

export function memoryCandidate(memory: MemoryEntry, source: "memories" | "decisions"): ContextCandidate {
	return candidate(
		source,
		memory.id,
		memory.title,
		memory.content.slice(0, 600),
		memory.importance,
		source === "decisions",
		{
			code: memory.code ?? null,
			type: memory.type,
			updated_at: memory.updated_at
		}
	);
}

export function taskCandidate(task: Task, requestedTaskCode?: string): ContextCandidate {
	return candidate(
		"tasks",
		task.task_code,
		task.title,
		task.description?.slice(0, 500) ?? `${task.phase} · ${task.status}`,
		task.priority + (task.status === TASK_STATUS_IN_PROGRESS ? 2 : 0),
		task.task_code === requestedTaskCode,
		{ task_id: task.id, status: task.status, priority: task.priority, updated_at: task.updated_at }
	);
}

export function handoffCandidate(handoff: Handoff): ContextCandidate {
	return candidate(
		"handoffs",
		handoff.id,
		`Handoff from ${handoff.from_agent}`,
		handoff.summary.slice(0, 500),
		4,
		false,
		{
			task_code: handoff.task_code ?? null,
			to_agent: handoff.to_agent,
			created_at: handoff.created_at
		}
	);
}

export function standardCandidate(standard: CodingStandardEntry): ContextCandidate {
	return candidate(
		"standards",
		standard.code ?? standard.id,
		standard.title,
		standard.content.slice(0, 500),
		3,
		false,
		{
			code: standard.code ?? null,
			language: standard.language,
			version: standard.version
		}
	);
}

export function observationCandidate(observation: ExplorationObservation): ContextCandidate {
	return candidate(
		"observations",
		observation.id,
		observation.subject,
		observation.fact.slice(0, 500),
		observation.confidence * 5,
		false,
		{
			confidence: observation.confidence,
			freshness: observation.freshness,
			task_id: observation.task_id,
			evidence_count: observation.evidence_count
		}
	);
}

export function codeCandidate(symbol: CodebaseSymbol): ContextCandidate {
	return candidate("code", symbol.id, symbol.name, symbol.signature ?? symbol.kind, symbol.exported ? 4 : 2, false, {
		file_path: symbol.file_path,
		kind: symbol.kind,
		start_line: symbol.start_line,
		end_line: symbol.end_line
	});
}
