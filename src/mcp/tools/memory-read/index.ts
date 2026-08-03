/**
 * memory-read sub-module barrel.
 *
 * Re-exports the detail-mode handler for direct imports, mirroring the
 * task-read and standard-read directory layout. The orchestrator
 * (`handleMemoryRead`) lives in ../memory.read.ts.
 */

export { handleDetailMode, formatMemoryDetail, formatBulkDetail } from "./detail";
