import { formatDuration } from "../shared/format.ts";
import type { WidthFn } from "./window.ts";

const LABEL = "◆ Thought for ";

/**
 * Settled line for a finished thinking block: `◆ Thought for 23s (234 tokens)`.
 * The duration is measured (see timing.ts); the token count is an estimate of
 * ceil(chars / 4) over the original text. Truncated on the right when narrow.
 */
export function buildThoughtSummary(markdown: string, durationMs: number, width: number, widthOf: WidthFn): string {
  const tokens = Math.ceil(markdown.trim().length / 4);
  const line = `${LABEL}${formatDuration(durationMs)} (${tokens} tokens)`;
  if (widthOf(line) <= width) return line;
  const budget = width - 1;
  if (budget <= 0) return "";
  let end = line.length;
  while (end > 0 && widthOf(line.slice(0, end)) > budget) end--;
  return `${line.slice(0, end).replace(/\s+$/, "")}…`;
}
