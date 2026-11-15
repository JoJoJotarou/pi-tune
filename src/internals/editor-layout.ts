/**
 * Pi internals this module relies on, verified against Pi 1.4.0:
 *
 * - Pi's `Editor` renders its rows as: top border, content, bottom border, then the autocomplete list. The top
 *   border carries the working status between dashes.
 * - `renderBottomBorder` is the protected hook that draws the bottom border row, so a zero-width tag at its start
 *   (`BOTTOM_MARK`) marks where the content rows end.
 *
 * The shape is checked at runtime. Rows without that tag return an `Error`, and the caller keeps Pi's own look.
 */
export const BOTTOM_MARK = "\u001b_pi:tune-bottom\u0007";

export interface EditorRows {
  /** Pi's top border: the working status is drawn between its dashes. */
  top: string;
  /** The draft rows between Pi's two borders. */
  content: string[];
  /** Rows below Pi's bottom border: the autocomplete list. */
  below: string[];
}

export function editorRows(lines: readonly string[]): EditorRows | Error {
  const bottom = lines.findIndex((line) => line.startsWith(BOTTOM_MARK));
  // Pi draws its top border first, so a tag on row 0 means the rows below it are shifted.
  if (bottom < 1) return new Error("Pi's editor rows have no bottom border marker");
  return { top: lines[0], content: lines.slice(1, bottom), below: lines.slice(bottom + 1) };
}
