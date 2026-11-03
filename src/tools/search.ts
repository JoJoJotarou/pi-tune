import type { AgentToolResult, FindToolDetails, GrepToolDetails, LsToolDetails } from "@earendil-works/pi-coding-agent";

/** A grep match row: `path:line: text`. Context rows use `-line-` and do not count as matches. */
const GREP_MATCH = /^(.*?):(\d+):/;

/** The text blocks of a tool result, joined the way Pi's tools print them. */
export function resultText(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n");
}

/**
 * The notes Pi's tools append after a blank line: a read offset/truncation notice, or a limit notice
 * from grep, find, or ls. Only these exact shapes are notes; file content may also start a `[`-block
 * after a blank line.
 */
const NOTES = [
  /^\[\d+ more lines in file\. Use offset=\d+ to continue\.\]$/,
  /^\[Showing lines \d+-\d+ of \d+\. Use offset=\d+ to continue\.\]$/,
  /^\[\d+ (?:matches|results|entries) limit reached\. Use limit=\d+ for more(?:, or refine pattern)?\]$/,
];

/** Splits a tool result into the body and the note Pi appends after a blank line. */
export function splitNote(text: string): { body: string; note: string } {
  const index = text.lastIndexOf("\n\n[");
  if (index < 0) return { body: text, note: "" };
  const note = text.slice(index + 2);
  if (!NOTES.some((pattern) => pattern.test(note))) return { body: text, note: "" };
  return { body: text.slice(0, index), note };
}

/** Lines in a tool result text: a trailing newline does not start another line. */
export function countLines(text: string): number {
  if (text === "") return 0;
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.length;
}

export function plural(count: number, noun: string): string {
  if (count === 1) return `${count} ${noun}`;
  return `${count} ${noun}${/(?:ch|sh|s|x|z)$/.test(noun) ? "es" : "s"}`;
}

interface GrepFile {
  path: string;
  lines: number[];
}

function grepFiles(result: AgentToolResult<GrepToolDetails | undefined>): GrepFile[] {
  const files = new Map<string, number[]>();
  for (const line of splitNote(resultText(result)).body.split("\n")) {
    const match = GREP_MATCH.exec(line);
    if (!match) continue;
    const path = match[1];
    const lines = files.get(path) ?? [];
    lines.push(Number(match[2]));
    files.set(path, lines);
  }
  return [...files].map(([path, lines]) => ({ path, lines }));
}

function withLimit(parts: string[], limitReached: number | undefined): string {
  return limitReached === undefined ? parts.join(" · ") : [...parts, "limit reached"].join(" · ");
}

/** Right side of the grep header: match and file counts, and whether the match limit was reached. */
export function grepMeta(result: AgentToolResult<GrepToolDetails | undefined>): string {
  const files = grepFiles(result);
  const matches = files.reduce((sum, file) => sum + file.lines.length, 0);
  if (matches === 0) return "no matches";
  return withLimit([plural(matches, "match"), plural(files.length, "file")], result.details?.matchLimitReached);
}

/** Right side of the find header: the file count, and whether the result limit was reached. */
export function findMeta(result: AgentToolResult<FindToolDetails | undefined>): string {
  const files = splitNote(resultText(result))
    .body.split("\n")
    .filter((line) => line !== "" && !line.startsWith("No files found"));
  if (files.length === 0) return "no files";
  return withLimit([plural(files.length, "file")], result.details?.resultLimitReached);
}

/** Right side of the ls header: the directory and file counts, and whether the entry limit was reached. */
export function lsMeta(result: AgentToolResult<LsToolDetails | undefined>): string {
  const body = splitNote(resultText(result)).body;
  if (body === "" || body.startsWith("(empty directory)")) return "empty";

  let dirs = 0;
  let files = 0;
  for (const entry of body.split("\n")) {
    if (entry === "") continue;
    if (entry.endsWith("/")) dirs += 1;
    else files += 1;
  }

  const parts: string[] = [];
  if (dirs > 0) parts.push(plural(dirs, "dir"));
  if (files > 0) parts.push(plural(files, "file"));
  return withLimit(parts, result.details?.entryLimitReached);
}
