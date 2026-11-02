/** First line of the command, and how many further lines follow (a trailing newline does not count). */
export function summarizeCommand(command: string): { first: string; extraLines: number } {
  throw new Error("not implemented");
}

/** Exit code from the error result text that Pi's bash tool produces for a non-zero exit; undefined if absent. */
export function exitCodeOf(resultText: string): number | undefined {
  throw new Error("not implemented");
}

/**
 * Lines to show for a failed command. Output with at most 6 lines is returned whole.
 * Longer output: the first 2 lines, one marker line `┄ {n} lines folded · {expandKey}`, the last 3 lines.
 * Pi's own trailer (the line that states the exit code) is not part of the output.
 */
export function failureExcerpt(output: string, expandKey: string): string[] {
  throw new Error("not implemented");
}
