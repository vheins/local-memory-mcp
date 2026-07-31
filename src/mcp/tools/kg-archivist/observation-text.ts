/**
 * KG observation-text lifecycle contract (TASK-045).
 *
 * The exact observation text is the link between the WRITERS that create
 * observation rows (extract.ts `saveExtractions`, relations.ts
 * `saveStandardRelations` — invoked by the embedding worker) and the
 * DELETERS that remove them (memory/task/standard delete tools). This module
 * is the single source of truth for that text: writers and deleters MUST go
 * through `observationText()` and never inline the format, otherwise a drifted
 * format makes delete-time cleanup a silent no-op and task-derived
 * observations/entities leak in the graph.
 */

export type KgObservationDomain = "memory" | "standard" | "task";

/** Build the observation text linking an entity to the content that mentioned it. */
export function observationText(domain: KgObservationDomain, title: string): string {
	return `Mentioned in ${domain}: ${title}`;
}
