/**
 * kg-archivist — knowledge-graph persistence and query layer.
 *
 * Backward-compatible re-exporter. The implementation now lives in
 * the `kg-archivist/` directory, split into focused modules:
 *
 *   extract.ts   — NLP entity extraction + saveExtractions
 *   relations.ts — saveTaskRelations + saveStandardRelations
 *   query.ts     — kgQuery, fetchKgContext, fetchAggregatedKgContext,
 *                  fetchTaskKgContext, fetchAggregatedTaskKgContext
 */

export {
	// extract
	extractEntities,
	saveExtractions,
	ExtractedEntity,
	// observation-text contract (TASK-045)
	observationText,
	KgObservationDomain,
	// relations
	saveTaskRelations,
	saveStandardRelations,
	// query
	kgQuery,
	fetchKgContext,
	fetchAggregatedKgContext,
	fetchTaskKgContext,
	fetchAggregatedTaskKgContext,
	KgResult,
	KgEntityResult,
	KgRelationResult
} from "./kg-archivist/index";
