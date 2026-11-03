import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { splitNote } from "./search.ts";

/** One row of a tree, with its already-styled text and its nested rows. */
export interface TreeItem {
  text: string;
  children?: TreeItem[];
}

/** A grep match row: `path:line: text`. Context rows use `-line-` and are dim. */
const GREP_MATCH = /^(.*?):(\d+):(.*)$/;
const GREP_CONTEXT = /^(.*?)-(\d+)-(.*)$/;

interface GrepRow {
  path: string;
  number: string;
  rest: string;
  context: boolean;
}

/**
 * One grep row. The file of the row before is tried first: a path such as `2024-01-report.md` itself looks like
 * a context separator to the plain pattern.
 */
function parseGrepRow(line: string, knownPath: string | undefined): GrepRow | undefined {
  if (knownPath !== undefined) {
    for (const [separator, context] of [
      [":", false],
      ["-", true],
    ] as const) {
      if (!line.startsWith(`${knownPath}${separator}`)) continue;
      const tail = line.slice(knownPath.length + 1);
      const end = tail.indexOf(separator);
      if (end > 0 && /^\d+$/.test(tail.slice(0, end))) {
        return { path: knownPath, number: tail.slice(0, end), rest: tail.slice(end + 1), context };
      }
    }
  }
  const match = GREP_MATCH.exec(line);
  if (match) return { path: match[1], number: match[2], rest: match[3], context: false };
  const context = GREP_CONTEXT.exec(line);
  if (context) return { path: context[1], number: context[2], rest: context[3], context: true };
  return undefined;
}

/** Text after the `:line:` / `-line-` separator, without Pi's one leading space. */
function rowText(rest: string): string {
  return rest.startsWith(" ") ? rest.slice(1) : rest;
}

/** The rows under `prefix`, each with a connector; a child level is indented under its parent. */
function nestedRows(items: TreeItem[], prefix: string, width: number, theme: Theme): string[] {
  const rows: string[] = [];
  items.forEach((item, index) => {
    const last = index === items.length - 1;
    rows.push(truncateToWidth(`${prefix}${theme.fg("dim", last ? "└─ " : "├─ ")}${item.text}`, width, "…"));
    if (item.children !== undefined && item.children.length > 0) {
      const childPrefix = `${prefix}${last ? "   " : theme.fg("dim", "│  ")}`;
      rows.push(...nestedRows(item.children, childPrefix, width, theme));
    }
  });
  return rows;
}

/** Rows joined to the tree: `├─ ` for each child, `└─ ` for the last one. */
export function treeRows(items: TreeItem[], width: number, theme: Theme): string[] {
  return nestedRows(items, "", width, theme);
}

/** The note Pi appends after the body, after one blank row, dim and without a connector. */
function withNote(rows: string[], note: string, width: number, theme: Theme): string[] {
  if (note === "") return rows;
  return [...rows, "", truncateToWidth(theme.fg("dim", note), width, "…")];
}

/** Whether a list result is a message rather than entries: `(empty directory)`, `No files found …`. */
function isListMessage(line: string): boolean {
  return line.startsWith("(empty directory)") || line.startsWith("No files found");
}

/** Expanded body of ls or find: one tree row per entry, directories in accent, then the note. */
export function listBody(text: string, width: number, theme: Theme): string[] {
  const { body, note } = splitNote(text);
  const lines = body.split("\n").filter((line) => line !== "");

  if (lines.length === 1 && isListMessage(lines[0])) {
    return withNote([truncateToWidth(theme.fg("toolOutput", lines[0]), width, "…")], note, width, theme);
  }

  const items = lines.map((entry) => ({
    text: entry.endsWith("/") ? theme.fg("accent", entry) : theme.fg("toolOutput", entry),
  }));
  return withNote(treeRows(items, width, theme), note, width, theme);
}

/** Expanded body of grep: rows grouped by file, match text in toolOutput, context text dim. */
export function grepBody(text: string, width: number, theme: Theme): string[] {
  const { body, note } = splitNote(text);
  const lines = body.split("\n").filter((line) => line !== "");

  if (lines.length === 1 && lines[0].startsWith("No matches found")) {
    return withNote([truncateToWidth(theme.fg("toolOutput", lines[0]), width, "…")], note, width, theme);
  }

  const files = new Map<string, TreeItem>();
  const top: TreeItem[] = [];
  let current: TreeItem | undefined;
  let currentPath: string | undefined;

  for (const line of lines) {
    const row = parseGrepRow(line, currentPath);
    if (row === undefined) {
      const item = { text: theme.fg("toolOutput", line) };
      if (current === undefined) top.push(item);
      else current.children?.push(item);
      continue;
    }

    const { path, number, rest } = row;
    let file = files.get(path);
    if (file === undefined) {
      file = { text: theme.fg("accent", path), children: [] };
      files.set(path, file);
    }
    current = file;
    currentPath = path;

    const content = rowText(rest);
    const styled = row.context ? theme.fg("dim", content) : theme.fg("toolOutput", content);
    file.children?.push({ text: content === "" ? theme.fg("dim", number) : `${theme.fg("dim", number)}  ${styled}` });
  }

  return withNote(treeRows([...top, ...files.values()], width, theme), note, width, theme);
}
