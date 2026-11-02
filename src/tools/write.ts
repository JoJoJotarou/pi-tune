import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { getLanguageFromPath, highlightCode, keyText } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { StructuredPatchHunk } from "diff";
import { diffStats, hunksFromTexts } from "./diff.ts";
import { countLines, plural } from "./search.ts";

/** Changed lines above which the diff folds, as for edit. */
export const FOLD_LIMIT = 8;
/** New files show this many lines while collapsed. */
const NEW_FILE_ROWS = 3;
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
  body: "none" | "new" | "diff";
  hunks?: StructuredPatchHunk[];
}

/** The header meta and the body kind of a finished write. */
export function planWrite(record: WriteRecord | undefined, content: string, expanded: boolean): WritePlan {
  const lines = plural(countLines(content), "line");
  if (record === undefined) return { meta: lines, body: "none" };
  if (!record.existed) return { meta: `new file · ${lines}`, body: "new" };
  if (record.oldText === undefined) return { meta: `overwrite · ${lines}`, body: "none" };

  const hunks = hunksFromTexts(record.oldText, content);
  const stats = diffStats(hunks);
  const folded = !expanded && stats.added + stats.removed > FOLD_LIMIT;
  const counts = `overwrite · +${stats.added} −${stats.removed}`;
  if (folded) return { meta: `${counts} · ${keyText("app.tools.expand")}`, body: "none" };
  return { meta: counts, body: "diff", hunks };
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

  const shown = expanded ? total : Math.min(total, NEW_FILE_ROWS);
  const numberWidth = String(total).length;
  const styled = highlightLines(lines, path);
  const rows: string[] = [];
  for (let index = 0; index < shown; index++) {
    const number = String(index + 1).padStart(numberWidth);
    const row = `${theme.fg("dim", `${number} │ `)}${styled?.[index] ?? lines[index]}`;
    rows.push(truncateToWidth(row, width, "…"));
  }
  if (total > shown) {
    const more = total - shown;
    const marker = `┄ ${more} more ${more === 1 ? "line" : "lines"} · ${keyText("app.tools.expand")}`;
    rows.push(truncateToWidth(theme.fg("dim", marker), width, "…"));
  }
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
