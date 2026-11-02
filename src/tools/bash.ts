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

/** Pi's placeholder when a command printed nothing; the header already says `exit N`. */
const NO_OUTPUT = "(no output)";

/**
 * The output of a bash result: trailing blanks and Pi's own trailer (the line that states the exit
 * code) are not part of it, and a command that printed nothing has no output at all.
 */
export function outputLines(resultText: string): string[] {
  const lines = resultText.split("\n");
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (lines.length > 0 && /^Command exited with code \d+$/.test(lines[lines.length - 1])) lines.pop();
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  if (lines.length === 1 && lines[0] === NO_OUTPUT) return [];
  return lines;
}

/** The last `limit` output lines, and how many lines before them are hidden. */
export function failureTail(resultText: string, limit: number): { lines: string[]; hidden: number } {
  const lines = outputLines(resultText);
  if (lines.length <= limit) return { lines, hidden: 0 };
  return { lines: lines.slice(-limit), hidden: lines.length - limit };
}
