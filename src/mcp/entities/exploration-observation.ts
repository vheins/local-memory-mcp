import { createHash, randomUUID } from "node:crypto";
import { BaseEntity } from "../storage/base";
import type {
	ExplorationEvidence,
	ExplorationEvidenceInput,
	ExplorationObservation,
	ExplorationObservationInput,
	ExplorationObservationRow
} from "../types";

interface EvidenceRow {
	id: string;
	observation_id: string;
	file_path: string;
	symbol_id: string | null;
	start_line: number | null;
	end_line: number | null;
	created_at: string;
}

export interface ObservationQuery {
	owner: string;
	repo: string;
	subject?: string;
	task_id?: string;
	file_path?: string;
	symbol_id?: string;
	min_confidence?: number;
	limit?: number;
	offset?: number;
}

export interface ObservationWriteResult {
	observation: ExplorationObservation;
	created: boolean;
}

function normalizeIdentityText(value: string): string {
	return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function evidenceIdentity(evidence: ExplorationEvidenceInput): string {
	return [
		evidence.file_path.trim(),
		evidence.symbol_id?.trim() ?? "",
		evidence.start_line ?? "",
		evidence.end_line ?? ""
	].join("\u001f");
}

export function observationIdentity(input: ExplorationObservationInput): string {
	const normalizedEvidence = [...new Set(input.evidence.map(evidenceIdentity))].sort();
	return createHash("sha256")
		.update(
			[normalizeIdentityText(input.subject), normalizeIdentityText(input.fact), ...normalizedEvidence].join("\u001e")
		)
		.digest("hex");
}

export class ExplorationObservationEntity extends BaseEntity {
	upsertMany(
		owner: string,
		repo: string,
		inputs: ExplorationObservationInput[],
		updateId?: string
	): ObservationWriteResult[] {
		return this.transaction(() => inputs.map((input) => this.upsert(owner, repo, input, updateId)));
	}

	private upsert(
		owner: string,
		repo: string,
		input: ExplorationObservationInput,
		updateId?: string
	): ObservationWriteResult {
		const identityHash = observationIdentity(input);
		const existing = updateId
			? this.get<ExplorationObservationRow>(
					"SELECT *, 0 AS evidence_count FROM exploration_observations WHERE id = ? AND owner = ? AND repo = ?",
					[updateId, owner, repo]
				)
			: this.get<ExplorationObservationRow>(
					"SELECT *, 0 AS evidence_count FROM exploration_observations WHERE owner = ? AND repo = ? AND identity_hash = ?",
					[owner, repo, identityHash]
				);

		const now = new Date().toISOString();
		if (existing) {
			// A hash match without an explicit id is an idempotent retry: return the
			// existing row byte-for-byte instead of churning updated_at/evidence.
			if (!updateId) {
				return { observation: this.getById(owner, repo, existing.id, true)!, created: false };
			}
			this.run(
				`UPDATE exploration_observations
				 SET subject = ?, fact = ?, confidence = ?, task_id = ?, agent = ?, identity_hash = ?, updated_at = ?
				 WHERE id = ? AND owner = ? AND repo = ?`,
				[
					input.subject,
					input.fact,
					input.confidence,
					input.task_id ?? null,
					input.agent ?? null,
					identityHash,
					now,
					existing.id,
					owner,
					repo
				]
			);
			this.replaceEvidence(existing.id, input.evidence, now);
			return { observation: this.getById(owner, repo, existing.id, true)!, created: false };
		}

		if (updateId) throw new Error(`Exploration observation not found: ${updateId}`);
		const id = randomUUID();
		this.run(
			`INSERT INTO exploration_observations
			 (id, owner, repo, subject, fact, confidence, task_id, agent, identity_hash, freshness, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'valid', ?, ?)`,
			[
				id,
				owner,
				repo,
				input.subject,
				input.fact,
				input.confidence,
				input.task_id ?? null,
				input.agent ?? null,
				identityHash,
				now,
				now
			]
		);
		this.replaceEvidence(id, input.evidence, now);
		return { observation: this.getById(owner, repo, id, true)!, created: true };
	}

	private replaceEvidence(observationId: string, evidence: ExplorationEvidenceInput[], now: string): void {
		this.run("DELETE FROM exploration_evidence WHERE observation_id = ?", [observationId]);
		const unique = new Map(evidence.map((item) => [evidenceIdentity(item), item]));
		for (const item of unique.values()) {
			this.run(
				`INSERT INTO exploration_evidence
				 (id, observation_id, file_path, symbol_id, start_line, end_line, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`,
				[
					randomUUID(),
					observationId,
					item.file_path,
					item.symbol_id ?? null,
					item.start_line ?? null,
					item.end_line ?? null,
					now
				]
			);
		}
	}

	getById(owner: string, repo: string, id: string, hydrateEvidence = false): ExplorationObservation | null {
		const row = this.get<ExplorationObservationRow>(
			`SELECT o.*, COUNT(e.id) AS evidence_count
			 FROM exploration_observations o
			 LEFT JOIN exploration_evidence e ON e.observation_id = o.id
			 WHERE o.id = ? AND o.owner = ? AND o.repo = ?
			 GROUP BY o.id`,
			[id, owner, repo]
		);
		return row ? this.hydrate(row, hydrateEvidence) : null;
	}

	list(query: ObservationQuery, hydrateEvidence = false): ExplorationObservation[] {
		const conditions = ["o.owner = ?", "o.repo = ?", "o.confidence >= ?"];
		const values: unknown[] = [query.owner, query.repo, query.min_confidence ?? 0];
		if (query.subject) {
			conditions.push("o.subject LIKE ?");
			values.push(`%${query.subject}%`);
		}
		if (query.task_id) {
			conditions.push("o.task_id = ?");
			values.push(query.task_id);
		}
		if (query.file_path) {
			conditions.push(
				"EXISTS (SELECT 1 FROM exploration_evidence ef WHERE ef.observation_id = o.id AND ef.file_path = ?)"
			);
			values.push(query.file_path);
		}
		if (query.symbol_id) {
			conditions.push(
				"EXISTS (SELECT 1 FROM exploration_evidence es WHERE es.observation_id = o.id AND es.symbol_id = ?)"
			);
			values.push(query.symbol_id);
		}
		values.push(query.limit ?? 20, query.offset ?? 0);
		const rows = this.all<ExplorationObservationRow>(
			`SELECT o.*, COUNT(e.id) AS evidence_count
			 FROM exploration_observations o
			 LEFT JOIN exploration_evidence e ON e.observation_id = o.id
			 WHERE ${conditions.join(" AND ")}
			 GROUP BY o.id
			 ORDER BY o.confidence DESC, o.updated_at DESC, o.id ASC
			 LIMIT ? OFFSET ?`,
			values
		);
		return rows.map((row) => this.hydrate(row, hydrateEvidence));
	}

	private hydrate(row: ExplorationObservationRow, includeEvidence: boolean): ExplorationObservation {
		const observation: ExplorationObservation = { ...row, evidence_count: Number(row.evidence_count ?? 0) };
		if (includeEvidence) {
			observation.evidence = this.all<EvidenceRow>(
				`SELECT id, observation_id, file_path, symbol_id, start_line, end_line, created_at
				 FROM exploration_evidence WHERE observation_id = ? ORDER BY file_path, start_line, id`,
				[row.id]
			) as ExplorationEvidence[];
		}
		return observation;
	}
}
