import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { generateDiffString, getLanguageFromPath, highlightCode } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { diffMeta, PREVIEW_LINES, truncationLine } from "./body.ts";
import { countLines, plural } from "./search.ts";

const MAX_OLD_BYTES = 1024 * 1024;

/** What the target file looked like before a write call. */
export interface WriteRecord {
  existed: boolean;
  /** The old content; absent when the file was over 1 MB or could not be read. */
  oldText?: string;
}

const records = new Map<string, WriteRecord>();

export function rememberWriteRecord(toolCallId: string, record: WriteRecord): void {
  records.set(toolCallId, record);
}

export function writeRecord(toolCallId: string): WriteRecord | undefined {
  return records.get(toolCallId);
}

export function clearWriteRecords(): void {
  records.clear();
}

/** Reads the write target before the tool runs; a missing file records `existed: false`. */
export async function recordWriteTarget(toolCallId: string, cwd: string, path: string): Promise<void> {
  const absolute = resolve(cwd, path);
  try {
    const info = await stat(absolute);
    if (!info.isFile() || info.size > MAX_OLD_BYTES) {
      rememberWriteRecord(toolCallId, { existed: true });
      return;
    }
    rememberWriteRecord(toolCallId, { existed: true, oldText: await readFile(absolute, "utf8") });
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    rememberWriteRecord(toolCallId, { existed: !missing });
  }
}

export interface WritePlan {
  meta: string;
  body: "none" | "lines" | "diff";
  /** Pi's rendered diff text, for an overwrite whose old content is known. */
  diff?: string;
}

/** The header meta and the body kind of a finished write. */
export function planWrite(record: WriteRecord | undefined, content: string): WritePlan {
  const lines = plural(countLines(content), "line");
  if (record === undefined) return { meta: lines, body: "none" };
  if (!record.existed) return { meta: `new · ${lines}`, body: "lines" };
  if (record.oldText === undefined) return { meta: "overwrite", body: "lines" };

  const diff = generateDiffString(record.oldText, content).diff;
  return { meta: diffMeta(diff, "overwrite"), body: "diff", diff };
}

/** Numbered rows for a new file: the first lines while collapsed, all of them expanded. */
export function renderWriteLines(
  path: string,
  content: string,
  expanded: boolean,
  width: number,
  theme: Theme,
): string[] {
  const lines = contentLines(content);
  const total = lines.length;
  if (total === 0) return [];

  const shown = expanded ? total : Math.min(total, PREVIEW_LINES);
  const numberWidth = String(total).length;
  const styled = highlightLines(lines, path);
  const rows: string[] = [];
  for (let index = 0; index < shown; index++) {
    const number = String(index + 1).padStart(numberWidth);
    const row = `${theme.fg("toolDiffAdded", number)}${theme.fg("dim", " │ ")}${styled?.[index] ?? lines[index]}`;
    rows.push(truncateToWidth(row, width, "…"));
  }
  if (total > shown) rows.push(truncateToWidth(truncationLine(total - shown, theme), width, "…"));
  return rows;
}

/** Lines in a written content: a trailing newline does not start another line. */
function contentLines(content: string): string[] {
  if (content === "") return [];
  const lines = content.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function highlightLines(lines: string[], path: string): string[] | undefined {
  const language = getLanguageFromPath(path);
  if (language === undefined) return undefined;
  const highlighted = highlightCode(lines.join("\n"), language);
  return highlighted.length === lines.length ? highlighted : undefined;
}
