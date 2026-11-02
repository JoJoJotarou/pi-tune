/** First line of the command, and how many further lines follow (a trailing newline does not count). */
export function summarizeCommand(command: string): { first: string; extraLines: number } {
  const lines = command.replace(/\n$/, "").split("\n");
  return { first: lines[0] ?? "", extraLines: lines.length - 1 };
}

/** Exit code from the error result text that Pi's bash tool produces for a non-zero exit; undefined if absent. */
export function exitCodeOf(resultText: string): number | undefined {
  const match = /Command exited with code (\d+)/.exec(resultText);
  return match ? Number(match[1]) : undefined;
}

/**
 * Lines to show for a failed command. Output with at most 6 lines is returned whole.
 * Longer output: the first 2 lines, one marker line `┄ {n} lines folded · {expandKey}`, the last 3 lines.
 * Pi's own trailer (the line that states the exit code) is not part of the output.
 */
export function failureExcerpt(output: string, expandKey: string): string[] {
  const lines = output.split("\n");
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (lines.length > 0 && /^Command exited with code \d+$/.test(lines[lines.length - 1])) lines.pop();
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  if (lines.length <= 6) return lines;
  return [
    lines[0],
    lines[1],
    `┄ ${lines.length - 5} lines folded · ${expandKey}`,
    lines[lines.length - 3],
    lines[lines.length - 2],
    lines[lines.length - 1],
  ];
}
