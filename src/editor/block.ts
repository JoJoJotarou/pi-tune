import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Color, truncateToWidth } from "@earendil-works/pi-tui";

/** `❯` and the spaces either side of it: the first column of text starts after this gutter. */
export const BLOCK_GUTTER = 3;
/** The half-row edge above the draft; the matching one below is drawn by `blockEdgeRow`. */
export const BLOCK_PADDING = 1;

/** Columns left for the draft inside the block. The block spans the editor's full width. */
export function blockContentWidth(width: number): number {
  return width - BLOCK_GUTTER;
}

/**
 * The block: every row is one line of background, margined on both sides. The first row leads with
 * `glyph`; the rest indent under the text so a wrapped draft reads as one paragraph. `rows` are the
 * editor's own rows, already padded to `blockContentWidth`.
 */
export function blockRows(
  rows: readonly string[],
  width: number,
  glyph: string,
  paint: (text: string) => string,
): string[] {
  const inner = blockContentWidth(width);
  return rows.map((row, index) => {
    const gutter = index === 0 ? ` ${glyph} ` : "   ";
    return paint(gutter + truncateToWidth(row, inner, "", true));
  });
}

/**
 * Half a row of block colour: the top edge paints the lower half of its cell, the bottom edge the upper
 * half. The other half of the cell stays the terminal's own background, so the box gets a soft edge and
 * half a row of air on each side without spending the whole row.
 */
export function blockEdgeRow(width: number, edge: "top" | "bottom", fill: Color, theme: Theme): string {
  const glyph = edge === "top" ? "▄" : "▀";
  return theme.style(glyph.repeat(Math.max(0, width)), { fg: fill });
}

/** A plain line above the block: Pi's working status, a pi-tune warning, or the btw mode name. */
export function statusLine(label: string, width: number): string {
  return ` ${truncateToWidth(label, Math.max(0, width - 1), "…")}`;
}
