import { formatDuration } from "../shared/format.ts";

export interface FoldOptions {
  isStreaming: boolean;
  elapsedMs?: number;
  durationMs?: number;
}

const MARKER = "◆";

function nonEmptyLines(markdown: string): string[] {
  return markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** Fold a thinking block to a header plus, while streaming, its last two non-empty lines. */
export function foldThinking(markdown: string, options: FoldOptions): string {
  const lines = nonEmptyLines(markdown);
  if (lines.length === 0) return markdown;

  if (options.isStreaming) {
    const elapsed = options.elapsedMs === undefined ? "" : ` ${formatDuration(options.elapsedMs)}`;
    return [`${MARKER} Thinking${elapsed}`, ...lines.slice(-2)].join("\n\n");
  }

  const duration = options.durationMs === undefined ? "" : ` ${formatDuration(options.durationMs)}`;
  const count = lines.length === 1 ? "1 line" : `${lines.length} lines`;
  return `${MARKER} Thought${duration} · ${count}`;
}
