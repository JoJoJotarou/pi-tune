import type { Theme } from "@earendil-works/pi-coding-agent";
import { getLanguageFromPath, highlightCode } from "@earendil-works/pi-coding-agent";
import {
  backgroundAnsi,
  mixColors,
  sliceByColumn,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { StructuredPatchHunk } from "diff";
import { diffWordsWithSpace, parsePatch, structuredPatch } from "diff";

export interface DiffStats {
  added: number;
  removed: number;
}

export interface RenderDiffOptions {
  path: string;
  width: number;
  theme: Theme;
  context?: number;
}

type RowKind = "context" | "removed" | "added";

interface Row {
  kind: RowKind;
  oldNum: number | undefined;
  newNum: number | undefined;
  /** Old line number this row sits at (an added row sits before the old line it follows). */
  oldAt: number;
  code: string;
  styled: string | undefined;
  /** Changed words as visible-column ranges. */
  ranges: Array<[number, number]>;
}

interface RowTints {
  removed: string;
  added: string;
  removedWord: string;
  addedWord: string;
}

interface RenderContext {
  width: number;
  codeWidth: number;
  oldWidth: number;
  newWidth: number;
  theme: Theme;
}

const ROW_TINT = 0.18;
const WORD_TINT = 0.4;
const ESC = String.fromCharCode(27);
const SGR = new RegExp(`${ESC}\\[[0-9;:]*m`, "g");
const RESET = `${ESC}[0m`;

export function hunksFromPatch(patch: string): StructuredPatchHunk[] {
  return parsePatch(patch)[0]?.hunks ?? [];
}

export function hunksFromTexts(oldText: string, newText: string, context = 3): StructuredPatchHunk[] {
  return structuredPatch("a", "b", oldText, newText, undefined, undefined, { context }).hunks;
}

export function diffStats(hunks: StructuredPatchHunk[]): DiffStats {
  let added = 0;
  let removed = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith("+")) added++;
      else if (line.startsWith("-")) removed++;
    }
  }
  return { added, removed };
}

export function renderDiff(hunks: StructuredPatchHunk[], options: RenderDiffOptions): string[] {
  const { path, width, theme, context = 1 } = options;
  const hunkRows = hunks.map(buildRows);
  const rows = hunkRows.flat();
  const shown = shownRows(hunkRows, context);

  const visible = rows.filter((_, index) => shown.has(index));
  const oldWidth = numberColumnWidth(visible.map((row) => row.oldNum));
  const newWidth = numberColumnWidth(visible.map((row) => row.newNum));

  const language = getLanguageFromPath(path);
  for (const hunk of hunkRows) {
    highlightHunk(hunk, language);
    pairChangedRows(hunk);
  }

  const renderContext: RenderContext = {
    width,
    codeWidth: Math.max(1, width - (oldWidth + newWidth + 4)),
    oldWidth,
    newWidth,
    theme,
  };
  const tints = rowTints(theme);

  const lines: string[] = [];
  let previous: Row | undefined;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (!shown.has(index)) continue;
    if (previous !== undefined) {
      const hidden = row.oldAt - oldLineAfter(previous);
      if (hidden > 0) lines.push(hiddenMarker(hidden, theme));
    }
    lines.push(...renderRow(row, renderContext, tints));
    previous = row;
  }
  return lines;
}

function buildRows(hunk: StructuredPatchHunk): Row[] {
  const rows: Row[] = [];
  let oldLine = hunk.oldStart;
  let newLine = hunk.newStart;
  for (const line of hunk.lines) {
    if (line.length === 0) continue;
    const marker = line[0];
    const code = line.slice(1).replace(/\t/g, "   ");
    if (marker === " ") {
      rows.push({
        kind: "context",
        oldNum: oldLine,
        newNum: newLine,
        oldAt: oldLine,
        code,
        styled: undefined,
        ranges: [],
      });
      oldLine++;
      newLine++;
    } else if (marker === "-") {
      rows.push({
        kind: "removed",
        oldNum: oldLine,
        newNum: undefined,
        oldAt: oldLine,
        code,
        styled: undefined,
        ranges: [],
      });
      oldLine++;
    } else if (marker === "+") {
      rows.push({
        kind: "added",
        oldNum: undefined,
        newNum: newLine,
        oldAt: oldLine,
        code,
        styled: undefined,
        ranges: [],
      });
      newLine++;
    }
  }
  return rows;
}

/** Rows to show: every change, plus `context` non-blank lines around it (blank lines are free). */
function shownRows(hunkRows: Row[][], context: number): Set<number> {
  const shown = new Set<number>();
  let offset = 0;
  for (const rows of hunkRows) {
    for (let index = 0; index < rows.length; index++) {
      if (rows[index].kind === "context") continue;
      shown.add(offset + index);
      let budget = context;
      for (let back = index - 1; back >= 0 && budget > 0; back--) {
        if (rows[back].kind !== "context") break;
        shown.add(offset + back);
        if (!isBlank(rows[back].code)) budget--;
      }
      budget = context;
      for (let ahead = index + 1; ahead < rows.length && budget > 0; ahead++) {
        if (rows[ahead].kind !== "context") break;
        shown.add(offset + ahead);
        if (!isBlank(rows[ahead].code)) budget--;
      }
    }
    offset += rows.length;
  }
  return shown;
}

function highlightHunk(rows: Row[], language: string | undefined): void {
  if (language === undefined) return;
  const oldBlock = rows.filter((row) => row.kind !== "added").map((row) => row.code);
  const newBlock = rows.filter((row) => row.kind !== "removed").map((row) => row.code);
  const oldStyled = highlightBlock(oldBlock, language);
  const newStyled = highlightBlock(newBlock, language);

  let oldIndex = 0;
  let newIndex = 0;
  for (const row of rows) {
    if (row.kind === "removed") row.styled = oldStyled?.[oldIndex++];
    else if (row.kind === "added") row.styled = newStyled?.[newIndex++];
    else {
      row.styled = newStyled?.[newIndex] ?? oldStyled?.[oldIndex];
      oldIndex++;
      newIndex++;
    }
  }
}

function highlightBlock(lines: string[], language: string): string[] | undefined {
  if (lines.length === 0) return undefined;
  const highlighted = highlightCode(lines.join("\n"), language);
  return highlighted.length === lines.length ? highlighted : undefined;
}

/** Pairs each removed run with the following added run of equal length and marks changed words. */
function pairChangedRows(rows: Row[]): void {
  let index = 0;
  while (index < rows.length) {
    if (rows[index].kind !== "removed") {
      index++;
      continue;
    }
    const removedStart = index;
    while (index < rows.length && rows[index].kind === "removed") index++;
    const addedStart = index;
    while (index < rows.length && rows[index].kind === "added") index++;
    if (addedStart === index || index - addedStart !== addedStart - removedStart) continue;

    for (let pair = 0; pair < addedStart - removedStart; pair++) {
      const oldRow = rows[removedStart + pair];
      const newRow = rows[addedStart + pair];
      const parts = diffWordsWithSpace(oldRow.code, newRow.code);
      oldRow.ranges = wordRanges(parts, "removed", oldRow.code);
      newRow.ranges = wordRanges(parts, "added", newRow.code);
    }
  }
}

function wordRanges(
  parts: ReturnType<typeof diffWordsWithSpace>,
  side: "removed" | "added",
  code: string,
): Array<[number, number]> {
  const chars: Array<[number, number]> = [];
  let offset = 0;
  for (const part of parts) {
    if (side === "removed" ? part.added : part.removed) continue;
    const start = offset;
    offset += part.value.length;
    if (side === "removed" ? part.removed : part.added) {
      const last = chars.at(-1);
      if (last !== undefined && last[1] === start) last[1] = offset;
      else chars.push([start, offset]);
    }
  }
  return chars.map(([start, end]) => [visibleWidth(code.slice(0, start)), visibleWidth(code.slice(0, end))]);
}

function numberColumnWidth(numbers: Array<number | undefined>): number {
  let width = 0;
  for (const number of numbers) {
    if (number === undefined) continue;
    width = Math.max(width, String(number).length);
  }
  return width;
}

function rowTints(theme: Theme): RowTints {
  const base = theme.colors.toolPendingBg;
  const mode = theme.getColorMode();
  const tint = (color: typeof base, amount: number): string => backgroundAnsi(mixColors(color, base, 1 - amount), mode);
  return {
    removed: tint(theme.colors.toolDiffRemoved, ROW_TINT),
    added: tint(theme.colors.toolDiffAdded, ROW_TINT),
    removedWord: tint(theme.colors.toolDiffRemoved, WORD_TINT),
    addedWord: tint(theme.colors.toolDiffAdded, WORD_TINT),
  };
}

function renderRow(row: Row, context: RenderContext, tints: RowTints): string[] {
  const { width, codeWidth, oldWidth, newWidth, theme } = context;
  const sign = row.kind === "removed" ? "-" : row.kind === "added" ? "+" : " ";
  const rowBg = row.kind === "removed" ? tints.removed : row.kind === "added" ? tints.added : undefined;
  const wordBg = row.kind === "removed" ? tints.removedWord : row.kind === "added" ? tints.addedWord : undefined;

  let code = row.styled ?? row.code;
  if (rowBg !== undefined && wordBg !== undefined) code = markChangedWords(code, row.code, row.ranges, rowBg, wordBg);

  const wrapped = wrapTextWithAnsi(code, codeWidth);
  const pieces = wrapped.length === 0 ? [""] : wrapped;
  const gutterWidth = oldWidth + newWidth + 4;

  return pieces.map((piece, index) => {
    const oldText =
      index === 0 && row.oldNum !== undefined ? String(row.oldNum).padStart(oldWidth) : " ".repeat(oldWidth);
    const newText =
      index === 0 && row.newNum !== undefined ? String(row.newNum).padStart(newWidth) : " ".repeat(newWidth);
    const gutter = `${oldText} ${newText} │${index === 0 ? sign : " "}`;
    const pad = " ".repeat(Math.max(0, width - gutterWidth - visibleWidth(piece)));
    const line =
      rowBg === undefined
        ? `${theme.fg("dim", gutter)}${piece}${pad}`
        : `${rowBg}${theme.fg("dim", gutter)}${paintBackground(piece, rowBg, wordBg ?? rowBg)}${pad}${RESET}`;
    return visibleWidth(line) > width ? truncateToWidth(line, width) : line;
  });
}

/** Splits a styled line at changed-word columns and tints those ranges with `wordBg`. */
function markChangedWords(
  styled: string,
  code: string,
  ranges: Array<[number, number]>,
  rowBg: string,
  wordBg: string,
): string {
  const total = visibleWidth(code);
  let out = "";
  let column = 0;
  for (const [start, end] of ranges) {
    const from = Math.max(start, column);
    const to = Math.min(end, total);
    if (to <= from) continue;
    if (from > column) out += sliceByColumn(styled, column, from - column);
    out += wordBg + sliceByColumn(styled, from, to - from) + rowBg;
    column = to;
  }
  if (column < total) out += sliceByColumn(styled, column, total - column);
  return out;
}

/** Keeps `rowBg` (or `wordBg`) active across the line, including after any reset inside `text`. */
function paintBackground(text: string, rowBg: string, wordBg: string): string {
  let current = rowBg;
  let out = rowBg;
  let cursor = 0;
  for (const match of text.matchAll(SGR)) {
    out += text.slice(cursor, match.index) + match[0];
    if (match[0] === wordBg) current = wordBg;
    else if (match[0] === rowBg) current = rowBg;
    out += current;
    cursor = match.index + match[0].length;
  }
  return out + text.slice(cursor);
}

function hiddenMarker(hidden: number, theme: Theme): string {
  return theme.fg("dim", `┄ ${hidden} unchanged line${hidden === 1 ? "" : "s"}`);
}

function oldLineAfter(row: Row): number {
  return row.oldAt + (row.kind === "added" ? 0 : 1);
}

function isBlank(code: string): boolean {
  return code.trim() === "";
}
