import type { AgentToolResult, ReadToolDetails, ReadToolInput } from "@earendil-works/pi-coding-agent";
import { countLines, plural, resultText, splitNote } from "./search.ts";

/** Lines Pi's read tool reports as still unread, e.g. `[3298 more lines in file. Use offset=103 to continue.]`. */
const MORE_LINES = /\[(\d+) more lines in file\./;

/** Right side of the read header: the line count, the offset/limit range, or the truncation. */
export function readMeta(args: ReadToolInput, result: AgentToolResult<ReadToolDetails | undefined>): string {
  const text = resultText(result);
  if (text === "") return "";

  const { body, note } = splitNote(text);
  const returned = countLines(body);
  const moreMatch = MORE_LINES.exec(note);
  const more = moreMatch ? Number(moreMatch[1]) : 0;

  const truncation = result.details?.truncation;
  if (truncation?.truncated) {
    return `truncated · ${truncation.outputLines} of ${truncation.totalLines} lines`;
  }

  if (args.offset !== undefined || args.limit !== undefined) {
    const first = args.offset ?? 1;
    const last = first + Math.max(0, returned - 1);
    return `lines ${first}–${last} of ${last + more}`;
  }

  return plural(returned, "line");
}
