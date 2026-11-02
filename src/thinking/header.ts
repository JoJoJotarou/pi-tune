import { formatDuration } from "../shared/format.ts";

export interface HeaderOptions {
  isStreaming: boolean;
  elapsedMs?: number;
  durationMs?: number;
}

const MARKER = "◆";

function lineCount(markdown: string): number {
  return markdown.split("\n").filter((line) => line.trim() !== "").length;
}

/** Prepend one header line to a visible thinking block and keep the full text below it. */
export function thinkingHeader(markdown: string, options: HeaderOptions): string {
  if (markdown.trim() === "") return markdown;

  if (options.isStreaming) {
    const elapsed = options.elapsedMs === undefined ? "" : ` ${formatDuration(options.elapsedMs)}`;
    return `${MARKER} Thinking${elapsed}\n\n${markdown}`;
  }

  const duration = options.durationMs === undefined ? "" : ` ${formatDuration(options.durationMs)}`;
  const count = lineCount(markdown);
  const lines = count === 1 ? "1 line" : `${count} lines`;
  return `${MARKER} Thought${duration} · ${lines}\n\n${markdown}`;
}
