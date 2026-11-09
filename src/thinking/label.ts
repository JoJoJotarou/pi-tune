import { formatDuration } from "../shared/format.ts";

/**
 * The row a settled thinking block folds to: `◆ Thought for 3.4s`. Without a measured run there is no duration to
 * claim, so the label keeps just the verb.
 */
export function buildThoughtLabel(durationMs: number | undefined): string {
  return durationMs === undefined ? "◆ Thought" : `◆ Thought for ${formatDuration(durationMs)}`;
}
