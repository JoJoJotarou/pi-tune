import { highlightCode, type Theme } from "@earendil-works/pi-coding-agent";
import {
  backgroundAnsi,
  type Color,
  foregroundAnsi,
  mixColors,
  sliceByColumn,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

type RowKind = "context" | "added" | "removed";

interface DiffRow {
  kind: RowKind | "gap";
  number: string;
  text: string;
}

/** Pi's diff text: a marker (` `, `+`, `-`), the line number padded to a common width, a space, the line. */
const ROW = /^([ +-])\s*(\d+) (.*)$/;
const GAP = /^\s*\.\.\.$/;
const KIND: Record<string, RowKind> = { " ": "context", "+": "added", "-": "removed" };

/** How far added rows and words lift the success block toward the added color; removed words toward red. */
const ADDED_ROW = 0.16;
const ADDED_WORD = 0.38;
const REMOVED_WORD = 0.3;
const RESET = "\x1b[0m";

function parse(diffText: string): DiffRow[] {
  return diffText.split("\n").map((line) => {
    const match = ROW.exec(line);
    if (match) return { kind: KIND[match[1]], number: match[2], text: match[3] };
    if (GAP.test(line)) return { kind: "gap", number: "", text: "" };
    return { kind: "context", number: "", text: line };
  });
}

/**
 * The changed middle of a removed/added pair: everything between their common prefix and suffix, widened to word
 * boundaries so a highlight never splits a word.
 */
export function changedSpan(before: string, after: string): { start: number; endBefore: number; endAfter: number } {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let tail = 0;
  while (
    tail < before.length - start &&
    tail < after.length - start &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  )
    tail++;
  const isWord = (char: string | undefined) => char !== undefined && /\w/.test(char);
  while (start > 0 && isWord(before[start - 1]) && (isWord(before[start]) || isWord(after[start]))) start--;
  let endBefore = before.length - tail;
  let endAfter = after.length - tail;
  while (
    endBefore < before.length &&
    endAfter < after.length &&
    isWord(before[endBefore]) &&
    isWord(before[endBefore - 1])
  ) {
    endBefore++;
    endAfter++;
  }
  return { start, endBefore, endAfter };
}

/** Pair each removed line with the added line at the same position in its change block. */
function wordSpans(rows: DiffRow[]): Map<number, [number, number]> {
  const spans = new Map<number, [number, number]>();
  let index = 0;
  while (index < rows.length) {
    const removed: number[] = [];
    while (rows[index]?.kind === "removed") removed.push(index++);
    const added: number[] = [];
    while (rows[index]?.kind === "added") added.push(index++);
    if (removed.length === 0 && added.length === 0) index++;
    for (let pair = 0; pair < Math.min(removed.length, added.length); pair++) {
      const before = rows[removed[pair]].text;
      const after = rows[added[pair]].text;
      const span = changedSpan(before, after);
      // A rewritten line is all change; highlighting all of it says nothing the row tint does not.
      const changed = Math.max(span.endBefore - span.start, span.endAfter - span.start);
      if (changed === 0 || changed > 0.6 * Math.max(before.length, after.length)) continue;
      spans.set(removed[pair], [span.start, span.endBefore]);
      spans.set(added[pair], [span.start, span.endAfter]);
    }
  }
  return spans;
}

interface Palette {
  rowBg: Record<"added" | "removed", string>;
  wordBg: Record<"added" | "removed", string>;
  fg: Record<RowKind, string>;
  /** Number and marker: the change color on added and removed rows, dim on context. */
  gutter: Record<RowKind, string>;
}

/**
 * Tints for a diff inside the success block. Removed rows take the theme's own error background; added rows lift
 * the success background toward the added color, since the same green would make them vanish.
 */
function palette(theme: Theme): Palette {
  const mode = theme.getColorMode();
  const colors = theme.colors;
  const bg = (color: Color) => backgroundAnsi(color, mode);
  const toward = (base: Color, token: "toolDiffAdded" | "toolDiffRemoved", amount: number) =>
    mixColors(base, colors[token], amount, "srgb");
  return {
    rowBg: { added: bg(toward(colors.toolSuccessBg, "toolDiffAdded", ADDED_ROW)), removed: bg(colors.toolErrorBg) },
    wordBg: {
      added: bg(toward(colors.toolSuccessBg, "toolDiffAdded", ADDED_WORD)),
      removed: bg(toward(colors.toolErrorBg, "toolDiffRemoved", REMOVED_WORD)),
    },
    fg: {
      context: theme.getFgAnsi("toolDiffContext"),
      added: foregroundAnsi(colors.text, mode),
      removed: foregroundAnsi(colors.text, mode),
    },
    gutter: {
      context: theme.getFgAnsi("dim"),
      added: theme.getFgAnsi("toolDiffAdded"),
      removed: theme.getFgAnsi("toolDiffRemoved"),
    },
  };
}

/**
 * The lines a collapsed diff shows: from the first change, with the removed and added lines of that change paired
 * up (`-b`, `+B`, `-c`, …) so a short preview shows what a line became, not only what was removed. A change near
 * the end starts earlier so the preview still fills `count` rows.
 */
export function previewLines(diffText: string, count: number): string[] {
  const lines = diffText.split("\n");
  const start = lines.findIndex((line) => line.startsWith("+") || line.startsWith("-"));
  if (start < 0) return lines.slice(0, count);
  let end = start;
  const removed: string[] = [];
  while (lines[end]?.startsWith("-")) removed.push(lines[end++]);
  const added: string[] = [];
  while (lines[end]?.startsWith("+")) added.push(lines[end++]);
  const paired: string[] = [];
  for (let index = 0; index < Math.max(removed.length, added.length); index++) {
    if (index < removed.length) paired.push(removed[index]);
    if (index < added.length) paired.push(added[index]);
  }
  const rows = [...paired, ...lines.slice(end)].slice(0, count);
  return [...lines.slice(Math.max(0, start - (count - rows.length)), start), ...rows];
}

export interface DiffRenderOptions {
  /** Wrap long lines instead of cutting them. */
  wrap: boolean;
}

export interface PreparedDiff {
  rows: DiffRow[];
  /** The changed middle of each removed/added pair, in plain-text offsets. */
  spans: Map<number, [number, number]>;
  /** Each row's text with syntax colors, `undefined` where there is no language or highlighting failed. */
  highlighted: (string | undefined)[];
}

/**
 * Syntax colors for each row's text. A diff interleaves two files, so the code is highlighted once per side — context
 * and removed rows against the old file, context and added rows against the new one — and a context row keeps the new
 * side's colors. Highlighting row by row would restart on every line and break block comments and template strings.
 */
function highlightSides(rows: DiffRow[], language: string | undefined): (string | undefined)[] {
  const highlighted: (string | undefined)[] = rows.map(() => undefined);
  if (language === undefined) return highlighted;

  const highlightSide = (indexes: number[]) => {
    const lines = highlightCode(indexes.map((index) => rows[index].text).join("\n"), language);
    // A language the highlighter cannot split one line per row is left plain rather than colored out of step.
    if (lines.length !== indexes.length) return;
    indexes.forEach((index, line) => {
      highlighted[index] = lines[line];
    });
  };

  highlightSide(rows.flatMap((row, index) => (row.kind === "added" || row.kind === "gap" ? [] : [index])));
  highlightSide(rows.flatMap((row, index) => (row.kind === "removed" || row.kind === "gap" ? [] : [index])));
  return highlighted;
}

/** A diff's rows, word spans and highlighted code, ready to be rendered at any width. */
export function prepareDiff(diffText: string, language: string | undefined): PreparedDiff {
  const rows = parse(diffText);
  return { rows, spans: wordSpans(rows), highlighted: highlightSides(rows, language) };
}

/** The changed words of a row, tinted stronger on top of the already highlighted text. */
function tintSpan(text: string, plain: string, span: [number, number], resetTo: string, bg: string): string {
  const start = visibleWidth(plain.slice(0, span[0]));
  const end = visibleWidth(plain.slice(0, span[1]));
  const width = visibleWidth(plain);
  return [
    sliceByColumn(text, 0, start),
    bg,
    sliceByColumn(text, start, Math.max(0, end - start)),
    resetTo,
    sliceByColumn(text, end, Math.max(0, width - end)),
  ].join("");
}

/**
 * Pi's diff text as one row per line: line number, marker, text. Added and removed rows are tinted across the
 * whole width, their numbers and markers take the change color, and the changed words of a removed/added pair are
 * tinted stronger.
 */
export function renderDiffRows(diff: PreparedDiff, width: number, theme: Theme, options: DiffRenderOptions): string[] {
  const { rows, spans, highlighted } = diff;
  const colors = palette(theme);
  const numberWidth = Math.max(1, ...rows.map((row) => row.number.length));
  const gutter = numberWidth + 3;
  const textWidth = Math.max(1, width - gutter);

  return rows.flatMap((row, index) => {
    if (row.kind === "gap")
      return [truncateToWidth(`${" ".repeat(numberWidth + 1)}${theme.fg("dim", "⋯")}`, width, "")];

    const kind = row.kind;
    const changed = kind === "added" || kind === "removed" ? kind : undefined;
    const rowBg = changed ? colors.rowBg[changed] : "";
    const span = spans.get(index);
    const text = highlighted[index] ?? row.text;
    const tinted = span && changed ? tintSpan(text, row.text, span, rowBg, colors.wordBg[changed]) : text;
    const styled = `${rowBg}${colors.fg[kind]}${tinted}`;
    const lines = options.wrap ? wrapTextWithAnsi(styled, textWidth) : [truncateToWidth(styled, textWidth, "…")];
    const marker = changed ? `${colors.gutter[changed]}${changed === "added" ? "+" : "-"}` : " ";

    return lines.map((line, part) => {
      const number = part === 0 ? row.number.padStart(numberWidth) : " ".repeat(numberWidth);
      const head = `${rowBg}${colors.gutter[kind]}${number} ${part === 0 ? marker : " "} `;
      const fill = " ".repeat(Math.max(0, textWidth - visibleWidth(line)));
      return `${head}${rowBg}${colors.fg[kind]}${line}${rowBg}${fill}${RESET}`;
    });
  });
}
