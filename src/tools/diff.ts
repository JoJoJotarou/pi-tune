import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  backgroundAnsi,
  type Color,
  foregroundAnsi,
  mixColors,
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

const ROW_TINT = 0.22;
const WORD_TINT = 0.5;
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
  fg: Record<RowKind | "number", string>;
  marker: Record<"added" | "removed", string>;
}

/** Row and word tints mixed from the theme's diff colors over the surface the rows sit on. */
function palette(theme: Theme, surface: Color): Palette {
  const mode = theme.getColorMode();
  const colors = theme.colors;
  const tint = (token: "toolDiffAdded" | "toolDiffRemoved", amount: number) =>
    backgroundAnsi(mixColors(surface, colors[token], amount, "srgb"), mode);
  return {
    rowBg: { added: tint("toolDiffAdded", ROW_TINT), removed: tint("toolDiffRemoved", ROW_TINT) },
    wordBg: { added: tint("toolDiffAdded", WORD_TINT), removed: tint("toolDiffRemoved", WORD_TINT) },
    fg: {
      context: theme.getFgAnsi("toolDiffContext"),
      added: foregroundAnsi(colors.text, mode),
      removed: foregroundAnsi(colors.text, mode),
      number: theme.getFgAnsi("dim"),
    },
    marker: { added: theme.getFgAnsi("toolDiffAdded"), removed: theme.getFgAnsi("toolDiffRemoved") },
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
  /** The background the rows are drawn on; tints are mixed over it. */
  surface: Color;
  /** Wrap long lines instead of cutting them. */
  wrap: boolean;
}

/**
 * Pi's diff text as one row per line: line number, marker, text. Added and removed rows are tinted across the
 * whole width and the changed words of a removed/added pair are tinted stronger.
 */
export function renderDiffRows(diffText: string, width: number, theme: Theme, options: DiffRenderOptions): string[] {
  const rows = parse(diffText);
  const spans = wordSpans(rows);
  const colors = palette(theme, options.surface);
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
    const text =
      span && changed
        ? `${row.text.slice(0, span[0])}${colors.wordBg[changed]}${row.text.slice(span[0], span[1])}${rowBg}${row.text.slice(span[1])}`
        : row.text;
    const styled = `${rowBg}${colors.fg[kind]}${text}`;
    const lines = options.wrap ? wrapTextWithAnsi(styled, textWidth) : [truncateToWidth(styled, textWidth, "…")];
    const marker = changed ? `${colors.marker[changed]}${changed === "added" ? "+" : "-"}` : " ";

    return lines.map((line, part) => {
      const number = part === 0 ? row.number.padStart(numberWidth) : " ".repeat(numberWidth);
      const head = `${rowBg}${colors.fg.number}${number} ${part === 0 ? marker : " "} `;
      const fill = " ".repeat(Math.max(0, textWidth - visibleWidth(line)));
      return `${head}${rowBg}${colors.fg[kind]}${line}${rowBg}${fill}${RESET}`;
    });
  });
}
