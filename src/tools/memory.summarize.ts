import { MemorySummarizeSchema } from "./schemas.js";
import { SQLiteStore } from "../storage/sqlite.js";

export async function handleMemorySummarize(
  params: any,
  db: SQLiteStore
): Promise<{ success: boolean }> {
  // Validate input
  const validated = MemorySummarizeSchema.parse(params);

  // Create summary from signals
  const summary = validated.signals.join("\n- ");
  const fullSummary = `Project summary:\n- ${summary}`;

  // Store summary
  db.upsertSummary(validated.repo, fullSummary);

  return { success: true };
}
